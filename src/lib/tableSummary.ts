/**
 * Client-side table summarizer.
 *
 * Mirrors the aggregation output of the parse-document edge function, but runs
 * in the browser (inside a web worker) where there is no CPU-time limit. Very
 * large spreadsheets/CSVs (200k+ rows) exceed the edge function's CPU budget,
 * so the heavy single pass happens here and only the compact summary is sent
 * to the backend.
 */

const ROW_DUMP_LIMIT = 3000;
const ROW_EDGE_SAMPLE = 300;
const MAX_DISTINCT_TRACKED = 50_000;
const MAX_GROUPS_TRACKED = 200;
const CLASSIFY_SAMPLE = 300;

export function toNumber(value: string) {
  if (!value) return NaN;
  const cleaned = value.replace(/[,\s₹$€£%]/g, "");
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return NaN;
  return Number(cleaned);
}

function cleanText(text: string) {
  return text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

interface ColumnAgg {
  nonEmpty: number;
  counts: Map<string, number>;
  distinctOverflow: boolean;
  numCount: number;
  numSum: number;
  numMin: number;
  numMax: number;
}

function newColumn(): ColumnAgg {
  return { nonEmpty: 0, counts: new Map(), distinctOverflow: false, numCount: 0, numSum: 0, numMin: Infinity, numMax: -Infinity };
}

function mdRow(cells: string[]) {
  return `| ${cells.map((c) => String(c ?? "").replace(/\|/g, "/").trim()).join(" | ")} |`;
}

function markdownTable(rows: string[][]) {
  const useful = rows.filter((r) => r.some((c) => String(c ?? "").trim()));
  if (!useful.length) return "";
  const width = Math.max(...useful.map((r) => r.length));
  const normalized = useful.map((r) => Array.from({ length: width }, (_, i) => r[i] || ""));
  const header = normalized[0].some(Boolean) ? normalized[0] : normalized[0].map((_, i) => `Column ${i + 1}`);
  return [mdRow(header), `| ${header.map(() => "---").join(" | ")} |`, ...normalized.slice(1).map(mdRow)].join("\n");
}

/** Summarize an arbitrarily large table from an iterable of rows (single pass). */
export function summarizeTable(title: string, rowSource: Iterable<string[]>): string {
  let header: string[] = [];
  const columns: ColumnAgg[] = [];
  const head: string[][] = [];
  const tail: string[][] = [];
  const classifySample: string[][] = [];
  let numericCols: number[] = [];
  let categoricalCols: number[] = [];
  let classified = false;
  const groups = new Map<number, Map<string, { count: number; stats: Map<number, { sum: number; min: number; max: number; count: number }> }>>();
  const groupOverflow = new Set<number>();
  let total = 0;

  const accumulateGroups = (row: string[]) => {
    for (const catCol of categoricalCols) {
      if (groupOverflow.has(catCol)) continue;
      const key = (row[catCol] || "").trim();
      if (!key) continue;
      const map = groups.get(catCol)!;
      let entry = map.get(key);
      if (!entry) {
        if (map.size >= MAX_GROUPS_TRACKED) { groupOverflow.add(catCol); continue; }
        entry = { count: 0, stats: new Map() };
        map.set(key, entry);
      }
      entry.count++;
      for (const numCol of numericCols) {
        const num = toNumber((row[numCol] || "").trim());
        if (!Number.isFinite(num)) continue;
        let stat = entry.stats.get(numCol);
        if (!stat) { stat = { sum: 0, min: Infinity, max: -Infinity, count: 0 }; entry.stats.set(numCol, stat); }
        stat.sum += num;
        stat.count++;
        if (num < stat.min) stat.min = num;
        if (num > stat.max) stat.max = num;
      }
    }
  };

  const classify = () => {
    classified = true;
    const sample = classifySample;
    numericCols = [];
    categoricalCols = [];
    for (let col = 0; col < header.length; col++) {
      const values = sample.map((row) => (row[col] || "").trim()).filter(Boolean);
      if (!values.length) continue;
      const numeric = values.filter((value) => Number.isFinite(toNumber(value))).length;
      if (numeric / values.length >= 0.6) numericCols.push(col);
      else if (new Set(values).size <= Math.max(30, values.length * 0.15)) categoricalCols.push(col);
    }
    numericCols = numericCols.slice(0, 20);
    categoricalCols = categoricalCols.slice(0, 8);
    for (const col of categoricalCols) groups.set(col, new Map());
    for (const row of sample) accumulateGroups(row);
  };

  for (const rawRow of rowSource) {
    const row = (rawRow || []).map((cell) => String(cell ?? "").trim());
    if (!row.some(Boolean)) continue;

    if (!header.length) {
      header = row.map((cell, index) => cell || `Column ${index + 1}`);
      continue;
    }

    total++;
    while (columns.length < Math.max(header.length, row.length)) columns.push(newColumn());
    if (row.length > header.length) {
      for (let i = header.length; i < row.length; i++) header.push(`Column ${i + 1}`);
    }

    for (let col = 0; col < row.length; col++) {
      const value = row[col];
      if (!value) continue;
      const agg = columns[col];
      agg.nonEmpty++;
      if (agg.counts.size < MAX_DISTINCT_TRACKED) agg.counts.set(value, (agg.counts.get(value) || 0) + 1);
      else if (agg.counts.has(value)) agg.counts.set(value, agg.counts.get(value)! + 1);
      else agg.distinctOverflow = true;
      const num = toNumber(value);
      if (Number.isFinite(num)) {
        agg.numCount++;
        agg.numSum += num;
        if (num < agg.numMin) agg.numMin = num;
        if (num > agg.numMax) agg.numMax = num;
      }
    }

    if (head.length < ROW_DUMP_LIMIT) head.push(row);
    else {
      tail.push(row);
      if (tail.length > ROW_EDGE_SAMPLE) tail.shift();
    }

    if (!classified) {
      classifySample.push(row);
      if (classifySample.length >= CLASSIFY_SAMPLE) classify();
    } else {
      accumulateGroups(row);
    }
  }

  if (!header.length) return "";
  if (!classified) classify();

  const statsLines: string[] = [];
  const valueCountLines: string[] = [];
  for (let col = 0; col < header.length; col++) {
    const agg = columns[col];
    if (!agg || !agg.nonEmpty) continue;
    if (agg.numCount) {
      const avg = agg.numSum / agg.numCount;
      statsLines.push(`- ${header[col]}: count=${agg.numCount}; min=${agg.numMin}; max=${agg.numMax}; sum=${Number(agg.numSum.toFixed(6))}; average=${Number(avg.toFixed(6))}`);
    }
    const entries = [...agg.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length) {
      const shown = entries.length <= 300 ? entries : entries.slice(0, 300);
      valueCountLines.push(
        `- ${header[col]} (distinct=${agg.distinctOverflow ? `${entries.length}+` : entries.length}, non-empty=${agg.nonEmpty}): ${shown.map(([value, count]) => `${value} = ${count}`).join("; ")}${entries.length > 300 ? "; ...(only the 300 most frequent values listed)" : ""}`,
      );
    }
  }

  const groupLines: string[] = [];
  for (const catCol of categoricalCols) {
    const map = groups.get(catCol);
    if (!map || !map.size) continue;
    const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, MAX_GROUPS_TRACKED);
    const lines = entries.map(([key, entry]) => {
      const parts = [`rows=${entry.count}`];
      for (const numCol of numericCols) {
        const stat = entry.stats.get(numCol);
        if (!stat || !stat.count) continue;
        parts.push(`${header[numCol]}: sum=${Number(stat.sum.toFixed(6))}, avg=${Number((stat.sum / stat.count).toFixed(6))}, min=${stat.min}, max=${stat.max}`);
      }
      return `  - ${key} → ${parts.join("; ")}`;
    });
    groupLines.push(`- Grouped by ${header[catCol]}${groupOverflow.has(catCol) ? " (partial: too many distinct values)" : ""}:\n${lines.join("\n")}`);
  }

  const dumpedAll = total <= ROW_DUMP_LIMIT;
  const rowSection = dumpedAll
    ? `### Full row data — every row of this sheet (${total} rows)\n${markdownTable([["Row #", ...header], ...head.map((row, index) => [`Row ${index + 1}`, ...row])])}`
    : [
        `### Row sample — this sheet has ${total} data rows, too many to list in full.`,
        `The aggregates above (counts, distinct value counts, numeric statistics, grouped breakdowns) are computed over ALL ${total} rows and are exact. Use them for any counting/statistical question instead of counting the sample rows below.`,
        `#### First ${head.length} rows`,
        markdownTable([["Row #", ...header], ...head.map((row, index) => [`Row ${index + 1}`, ...row])]),
        `#### Last ${tail.length} rows`,
        markdownTable([["Row #", ...header], ...tail.map((row, index) => [`Row ${total - tail.length + index + 1}`, ...row])]),
      ].join("\n\n");

  return cleanText([
    `## Sheet: ${title}`,
    `Total data rows (excluding header): ${total}`,
    `Total columns: ${header.length}`,
    `Columns: ${header.join(" | ")}`,
    statsLines.length ? `### Numeric statistics by column (exact, over all ${total} rows)\n${statsLines.join("\n")}` : "",
    valueCountLines.length ? `### Exact value counts by column (exact, over all ${total} rows)\n${valueCountLines.join("\n")}` : "",
    groupLines.length ? `### Grouped breakdowns (exact, over all ${total} rows)\n${groupLines.join("\n")}` : "",
    rowSection,
  ].filter(Boolean).join("\n\n"));
}
