/**
 * Browser-side spreadsheet / delimited-text reader.
 *
 * Reads .xlsx sheet XML straight out of the zip and streams rows through the
 * summarizer. Runs in a worker so a 200k-row workbook never blocks the UI.
 */
import { unzipSync, strFromU8 } from "fflate";
import { summarizeTable } from "./tableSummary";

const XLSX_EXT = /\.(xlsx|xlsm)$/i;
const CSV_EXT = /\.(csv|tsv)$/i;

export function isClientParsableTable(fileName: string) {
  return XLSX_EXT.test(fileName) || CSV_EXT.test(fileName);
}

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string) {
  let index = 0;
  for (const char of ref) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function normalizeNumericText(value: string) {
  if (!/^-?\d+\.\d{6,}$/.test(value)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? String(Number(num.toFixed(6))) : value;
}

function excelSerialToDate(serial: number) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseSharedStrings(xml: string) {
  const out: string[] = [];
  const pattern = /<si>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const parts = match[1].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
    out.push(xmlDecode(parts.map((part) => part.replace(/<[^>]+>/g, "")).join("")));
  }
  return out;
}

function* streamSheetRows(sheetXml: string, shared: string[]): Generator<string[]> {
  const rowPattern = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(sheetXml))) {
    const inner = rowMatch[1];
    if (!inner) continue;
    const cells: string[] = [];
    const cellPattern = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(inner))) {
      const attrs = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1] || "n";
      let value = "";
      if (type === "s") {
        value = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? "";
      } else if (type === "inlineStr" || type === "str") {
        value = xmlDecode(body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      } else {
        value = normalizeNumericText(xmlDecode(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""));
      }
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    yield cells;
  }
}

// Excel stores dates as serial numbers; convert them back for date-like columns.
function* withDateColumns(rows: Generator<string[]>): Generator<string[]> {
  let dateCols: number[] | null = null;
  for (const row of rows) {
    if (!dateCols) {
      dateCols = row.map((cell, i) => (/date|day|time|month|year/i.test(cell) ? i : -1)).filter((i) => i >= 0);
      yield row;
      continue;
    }
    for (const col of dateCols) {
      const num = Number(row[col]);
      if (row[col] && Number.isFinite(num) && num > 20000 && num < 80000) {
        const converted = excelSerialToDate(num);
        if (converted) row[col] = converted;
      }
    }
    yield row;
  }
}

function parseXlsxBytes(bytes: Uint8Array) {
  const files = unzipSync(bytes, {
    filter: (file) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(file.name) ||
      file.name === "xl/workbook.xml" ||
      file.name === "xl/sharedStrings.xml",
  });

  const sheetPaths = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)/)?.[1] || 0) - Number(b.match(/sheet(\d+)/)?.[1] || 0));
  if (!sheetPaths.length) throw new Error("no worksheets in workbook");

  const workbookXml = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => xmlDecode(m[1]));
  const shared = files["xl/sharedStrings.xml"] ? parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"])) : [];

  const output: string[] = [];
  for (let i = 0; i < sheetPaths.length; i++) {
    const xml = strFromU8(files[sheetPaths[i]]);
    const summary = summarizeTable(sheetNames[i] || `Sheet${i + 1}`, withDateColumns(streamSheetRows(xml, shared)));
    if (summary) output.push(summary);
  }
  return output.join("\n\n");
}

function parseDelimited(raw: string, fileName: string) {
  const text = raw.replace(/^\uFEFF/, "");
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const delimiter = ["\t", ",", ";", "|"]
    .map((candidate) => ({ candidate, score: sample.split(candidate).length - 1 }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || ",";

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => line.trim())) return "";
  const rows = (function* () {
    for (const line of lines) {
      if (line.trim()) yield parseLine(line);
    }
  })();
  return summarizeTable(fileName, rows);
}

export function parseTableFile(bytes: Uint8Array, fileName: string): string {
  if (XLSX_EXT.test(fileName)) return parseXlsxBytes(bytes);
  return parseDelimited(strFromU8(bytes), fileName);
}
