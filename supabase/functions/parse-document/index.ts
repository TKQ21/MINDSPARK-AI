import { encodeBase64 } from "jsr:@std/encoding@1.0.5/base64";
import { getDocument } from "https://esm.sh/pdfjs-serverless@1.2.3";
import JSZip from "https://esm.sh/jszip@3.10.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const unreadableFileMessage = "File received, but content could not be read. Please try re-uploading.";
const MAX_FILE_MB = 100;
const MAX_TEXT_CHARS = 5_000_000;

function cleanText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function xmlDecode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractXmlText(xml: string) {
  const pieces: string[] = [];
  const textNodePattern = /<(?:w:t|a:t|t|vt:lpstr|vt:lpwstr)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|t|vt:lpstr|vt:lpwstr)>/g;
  let match: RegExpExecArray | null;
  while ((match = textNodePattern.exec(xml))) pieces.push(xmlDecode(match[1]));
  if (pieces.length) return pieces.join(" ").replace(/\s+/g, " ").trim();
  return xmlDecode(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractXmlTextWithBreaks(xml: string) {
  return xmlDecode(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBinaryStrings(bytes: Uint8Array) {
  const latin = new TextDecoder("latin1").decode(bytes);
  const utf16 = new TextDecoder("utf-16le", { fatal: false }).decode(bytes);
  const collect = (value: string) =>
    (value.match(/[\p{L}\p{N}][\p{L}\p{N}\p{P}\p{S} ]{3,}/gu) || [])
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 3 && !/^[A-Z0-9_\-.]{20,}$/.test(s));
  return cleanText([...new Set([...collect(latin), ...collect(utf16)])].join("\n"));
}

async function parsePdf(bytes: Uint8Array) {
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false });
    const rows = new Map<number, Array<{ x: number; text: string }>>();

    for (const rawItem of content.items || []) {
      const item = rawItem as any;
      const text = String(item.str || "").trim();
      if (!text) continue;
      const transform = item.transform || [0, 0, 0, 0, 0, 0];
      const y = Math.round(Number(transform[5] || 0));
      const x = Number(transform[4] || 0);
      const row = rows.get(y) || [];
      row.push({ x, text });
      rows.set(y, row);
    }

    const pageText = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((cell) => cell.text).join(" | "))
      .join("\n");

    pages.push(`## Page ${pageNo}\n${pageText || "[No selectable text found on this page]"}`);
    page.cleanup?.();
  }

  await pdf.destroy?.();
  return cleanText(pages.join("\n\n"));
}

function buildPrecisionParsePrompt(fileName: string, documentText = "") {
  const safeDocumentText = documentText.length <= 100_000
    ? documentText
    : `${documentText.slice(0, 100_000)}\n\n[Selectable text preview truncated here because it exceeded 100,000 characters; still read the attached PDF itself completely.]`;

  return `You are a precise document parser. Extract ALL data from this document with 100% accuracy. Pay special attention to:

ALL numbers, percentages, rates exactly as written
ALL table data row by row
ALL chart values and labels
Do NOT guess or approximate any numbers
If a number is 74.32%, write exactly 74.32%
Extract every single data point you can find

For BI dashboards, charts, image-only pages, graphs, legends, axes, KPI cards, filters, and tables: read the attached PDF visually and extract every visible value with its label.

File name: ${fileName}
Document content: ${safeDocumentText || "[Read the attached PDF directly, including image/chart content.]"}

Return the complete extracted data in a structured markdown format. Preserve exact page numbers, row labels, column labels, percentages, decimals, currency symbols, and units. Do not summarize or invent. If unreadable, respond exactly NOT_READABLE.`;
}

// Upload a large file to the Gemini Files API (resumable) and return an ACTIVE file_uri.
// This lets us bypass the ~20MB inline_data cap and support PDFs / images up to ~2GB.
async function uploadToGeminiFileApi(bytes: Uint8Array, mimeType: string, displayName: string, apiKey: string) {
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );
  if (!startRes.ok) throw new Error(`Files API start failed: ${startRes.status} ${await startRes.text()}`);
  const uploadUrl = startRes.headers.get("x-goog-upload-url") || startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Files API did not return an upload URL");

  const putRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`Files API upload failed: ${putRes.status} ${await putRes.text()}`);
  const uploaded = await putRes.json();
  let file = uploaded.file;
  if (!file?.uri) throw new Error("Files API did not return a file uri");

  // Poll for ACTIVE state (PDFs need a few seconds of processing).
  for (let i = 0; i < 20 && file.state && file.state !== "ACTIVE"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`);
    if (poll.ok) file = await poll.json();
    if (file.state === "FAILED") throw new Error("Files API processing failed");
  }
  return { uri: file.uri as string, mimeType };
}

async function parsePdfWithGeminiVision(bytes: Uint8Array, fileName: string, selectableText: string) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const models = ["gemini-1.5-pro-latest", "gemini-2.5-pro", "gemini-2.5-flash"];
  let lastError = "";

  // Inline base64 is capped near 20MB per request. For anything larger — or when
  // inline fails — upload via the resumable Files API and reference by URI.
  const INLINE_MAX = 15 * 1024 * 1024;
  let fileRef: { uri: string; mimeType: string } | null = null;
  if (bytes.byteLength > INLINE_MAX) {
    try {
      fileRef = await uploadToGeminiFileApi(bytes, "application/pdf", fileName, GEMINI_API_KEY);
      console.log("parse-document: uploaded large PDF via Files API", fileRef.uri);
    } catch (err) {
      console.warn("Files API upload failed, will still attempt inline:", err);
    }
  }

  for (const model of models) {
    const filePart = fileRef
      ? { file_data: { mime_type: fileRef.mimeType, file_uri: fileRef.uri } }
      : { inline_data: { mime_type: "application/pdf", data: encodeBase64(bytes) } };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [filePart, { text: buildPrecisionParsePrompt(fileName, selectableText) }] }],
          generationConfig: { temperature: 0, topP: 0.1 },
        }),
      },
    );

    if (!response.ok) {
      lastError = await response.text();
      console.error(`Gemini PDF extraction error (${model}):`, response.status, lastError);
      // If inline failed for size reasons, retry the same model via Files API once.
      if (!fileRef && (response.status === 400 || response.status === 413)) {
        try {
          fileRef = await uploadToGeminiFileApi(bytes, "application/pdf", fileName, GEMINI_API_KEY);
          console.log("parse-document: retrying via Files API after inline failure");
        } catch (err) {
          console.warn("Files API fallback also failed:", err);
        }
      }
      continue;
    }

    const data = await response.json();
    const extracted = (data.candidates?.[0]?.content?.parts || [])
      .map((part: any) => typeof part.text === "string" ? part.text : "")
      .join("\n")
      .trim();
    if (!extracted || extracted === "NOT_READABLE") throw new Error(unreadableFileMessage);
    return cleanText(extracted);
  }

  throw new Error(`Failed to extract PDF with vision: ${lastError}`);
}

function looksLikeGoodText(text: string) {
  // Heuristic: enough text and enough alphabetic content → treat as machine-readable PDF.
  if (!text || text.length < 800) return false;
  const alpha = (text.match(/[A-Za-z\u0900-\u097F]/g) || []).length;
  return alpha / text.length > 0.35;
}

async function parsePdfAccurately(bytes: Uint8Array, fileName: string) {
  let selectableText = "";
  try {
    selectableText = await parsePdf(bytes);
  } catch (err) {
    console.warn("Selectable PDF extraction failed, trying vision:", err);
  }

  // FAST PATH: if the PDF already has clean selectable text on every page, skip
  // the slow Gemini vision pass. Vision still runs whenever any page is
  // image-only (scanned pages, dashboards, charts).
  const imageOnlyPages = (selectableText.match(/\[No selectable text found on this page\]/g) || []).length;
  if (looksLikeGoodText(selectableText) && imageOnlyPages === 0) {
    console.log("parse-document: fast path — selectable text is sufficient, skipping vision.");
    return selectableText;
  }


  try {
    const visionText = await parsePdfWithGeminiVision(bytes, fileName, selectableText);
    return cleanText([
      `# Gemini Vision precise extraction for ${fileName}`,
      visionText,
      selectableText ? `# Raw selectable PDF text for verification\n${selectableText}` : "",
    ].filter(Boolean).join("\n\n"));
  } catch (err) {
    console.warn("Vision PDF extraction failed, using selectable text fallback:", err);
    if (selectableText) return selectableText;
    throw err;
  }
}

function extractWordTextInOrder(xml: string) {
  const pieces: string[] = [];
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    if (match[0].startsWith("<w:tab")) pieces.push("\t");
    else if (match[0].startsWith("<w:br")) pieces.push("\n");
    else pieces.push(xmlDecode(match[1] || ""));
  }
  return pieces.join("").replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim();
}

function getDocxListPrefix(paragraphXml: string, counters: Map<string, number>) {
  const numId = paragraphXml.match(/<w:numId\s+w:val="(\d+)"\s*\/>/)?.[1];
  if (!numId) return "";
  const level = paragraphXml.match(/<w:ilvl\s+w:val="(\d+)"\s*\/>/)?.[1] || "0";
  const key = `${numId}:${level}`;
  const next = (counters.get(key) || 0) + 1;
  counters.set(key, next);
  for (const existing of [...counters.keys()]) {
    const [existingNum, existingLevel] = existing.split(":");
    if (existingNum === numId && Number(existingLevel) > Number(level)) counters.delete(existing);
  }
  return `${next}. `;
}

function buildWordIndex(line: string) {
  const normalized = line.replace(/^\s*(?:Line\s+\d+\s*:\s*)?(?:Q(?:uestion)?\s*)?\(?\d+\)?[.)\-:]?\s*/i, "").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 80) return "";
  return `Word positions: ${words.map((word, index) => `${index + 1}=${word}`).join(" | ")}`;
}

async function parseDocx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name));
  const sections: string[] = [];
  const counters = new Map<string, number>();
  let lineNo = 1;

  for (const name of files) {
    const xml = await zip.file(name)?.async("text");
    if (!xml) continue;

    if (name === "word/document.xml") {
      const blocks = xml.match(/<w:(?:p|tbl)[\s\S]*?<\/w:(?:p|tbl)>/g) || [];
      const lines: string[] = [];
      for (const block of blocks) {
        if (block.startsWith("<w:tbl")) {
          const rowXml = block.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
          for (const row of rowXml) {
            const cells = (row.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [])
              .map((cell) => extractWordTextInOrder(cell).replace(/\s+/g, " ").trim())
              .filter(Boolean);
            if (cells.length) lines.push(`Line ${lineNo++}: | ${cells.join(" | ")} |`);
          }
          continue;
        }
        const text = extractWordTextInOrder(block).replace(/\s+/g, " ").trim();
        if (!text) continue;
        const prefix = getDocxListPrefix(block, counters);
        const line = `Line ${lineNo++}: ${prefix}${text}`;
        lines.push(line);
        const wordIndex = buildWordIndex(line);
        if (wordIndex) lines.push(`  ${wordIndex}`);
      }
      if (lines.length) sections.push(`## Main document text with exact line numbers\n${lines.join("\n")}`);
      continue;
    }

    const text = extractXmlTextWithBreaks(xml);
    if (text) sections.push(`## ${name}\n${text}`);
  }

  return cleanText(sections.join("\n\n"));
}

function columnIndex(ref: string) {
  const letters = (ref.match(/[A-Z]+/i)?.[0] || "A").toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + ch.charCodeAt(0) - 64;
  return index - 1;
}


// ---------------------------------------------------------------------------
// Large tabular data (Excel / CSV) — streaming, aggregation-first summarizer.
// A 200k-row sheet cannot be dumped row-by-row into an LLM context, so we make
// a single pass over the rows and compute EXACT aggregates (counts, distinct
// value counts, numeric stats, category x numeric breakdowns) while keeping a
// verbatim sample of the head and tail rows. Aggregates are exact over ALL
// rows, so questions like "how many rows have rating 5" are answered correctly
// even when the raw rows are too many to include.
// ---------------------------------------------------------------------------
const ROW_DUMP_LIMIT = 3000; // dump every row when the table is this small
const ROW_EDGE_SAMPLE = 300; // otherwise keep this many rows from head and tail
const MAX_DISTINCT_TRACKED = 50_000;
const MAX_GROUPS_TRACKED = 200;
const CLASSIFY_SAMPLE = 300;

function toNumber(value: string) {
  if (!value) return NaN;
  const cleaned = value.replace(/[,\s₹$€£%]/g, "");
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return NaN;
  return Number(cleaned);
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

function numberStats(values: string[]) {
  const nums = values.map(toNumber).filter((value) => Number.isFinite(value));
  if (!nums.length) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return `count=${nums.length}; min=${min}; max=${max}; average=${Number(avg.toFixed(6))}`;
}

/**
 * Summarize an arbitrarily large table from an iterable of rows (single pass).
 */
async function summarizeTable(title: string, rowSource: Iterable<string[]> | AsyncIterable<string[]>): Promise<string> {
  let header: string[] = [];
  const columns: ColumnAgg[] = [];
  const head: string[][] = [];
  const tail: string[][] = [];
  const classifySample: string[][] = [];
  let numericCols: number[] = [];
  let categoricalCols: number[] = [];
  let classified = false;
  // groups[catCol] = Map<value, { count, per numeric col: {sum,min,max,count} }>
  const groups = new Map<number, Map<string, { count: number; stats: Map<number, { sum: number; min: number; max: number; count: number }> }>>();
  const groupOverflow = new Set<number>();
  let total = 0;

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

  for await (const rawRow of rowSource as AsyncIterable<string[]>) {
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

function structuredRowsToMarkdown(title: string, rows: string[][]) {
  return summarizeTable(title, rows);
}

// --- Fast streaming .xlsx reader -------------------------------------------
// XLSX.read() on a 10MB / 200k-row workbook takes ~22s and holds every cell in
// memory. Reading the sheet XML straight out of the zip and streaming rows
// through the summarizer does the same job in ~7s with flat memory, which is
// what makes very large spreadsheets work at all inside the edge function.
function normalizeNumericText(value: string) {
  if (!/^-?\d+\.\d{6,}$/.test(value)) return value;
  const num = Number(value);
  return Number.isFinite(num) ? String(Number(num.toFixed(6))) : value;
}

function excelSerialToDate(serial: number) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
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

function parseRowXml(rowXml: string, shared: string[]): string[] {
  const cells: string[] = [];
  const cellPattern = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPattern.exec(rowXml))) {
    const attrs = cellMatch[1] || "";
    const body = cellMatch[2] || "";
    const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
    const type = attrs.match(/t="([^"]+)"/)?.[1] || "n";
    let value = "";
    if (type === "s") {
      const index = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
      value = shared[index] ?? "";
    } else if (type === "inlineStr" || type === "str") {
      value = xmlDecode(body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    } else {
      value = normalizeNumericText(xmlDecode(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""));
    }
    const index = ref ? columnIndex(ref) : cells.length;
    while (cells.length < index) cells.push("");
    cells[index] = value;
  }
  return cells;
}

// Stream a zip entry as text chunks. A 200k-row sheet decompresses to ~80MB of
// XML; holding that as one JS string exceeds the edge function memory budget,
// so we consume it incrementally instead.
async function* streamZipEntryText(zip: any, name: string): AsyncGenerator<string> {
  const entry = zip.file(name);
  if (!entry) return;
  const queue: string[] = [];
  let finished = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const ping = () => { const fn = wake; wake = null; fn?.(); };

  const stream = entry.internalStream("string");
  stream.on("data", (chunk: string) => { queue.push(chunk); ping(); });
  stream.on("error", (err: unknown) => { failure = err; finished = true; ping(); });
  stream.on("end", () => { finished = true; ping(); });
  stream.resume();

  while (true) {
    if (queue.length) { yield queue.shift()!; continue; }
    if (finished) { if (failure) throw failure; return; }
    await new Promise<void>((resolve) => { wake = resolve; });
  }
}

async function* streamSheetRows(zip: any, sheetPath: string, shared: string[]): AsyncGenerator<string[]> {
  let buffer = "";
  for await (const chunk of streamZipEntryText(zip, sheetPath)) {
    buffer += chunk;
    while (true) {
      const end = buffer.indexOf("</row>");
      if (end === -1) break;
      const start = buffer.indexOf("<row");
      if (start === -1 || start > end) { buffer = buffer.slice(end + 6); continue; }
      const rowXml = buffer.slice(start, end + 6);
      buffer = buffer.slice(end + 6);
      const row = parseRowXml(rowXml, shared);
      if (row.length) yield row;
    }
    // Safety valve: a single row should never be this long.
    if (buffer.length > 4_000_000) buffer = buffer.slice(-500_000);
  }
}

// Excel stores dates as serial numbers; convert them back for date-like columns
// so answers show real dates instead of 45658.
async function* withDateColumns(rows: AsyncIterable<string[]>): AsyncGenerator<string[]> {
  let dateCols: number[] | null = null;
  for await (const row of rows) {
    if (!dateCols) {
      dateCols = row
        .map((cell, index) => (/date|day|time|month|year/i.test(cell) ? index : -1))
        .filter((index) => index >= 0);
      yield row;
      continue;
    }
    for (const col of dateCols) {
      const value = row[col];
      if (!value) continue;
      const num = Number(value);
      if (Number.isFinite(num) && num > 20000 && num < 80000) {
        const converted = excelSerialToDate(num);
        if (converted) row[col] = converted;
      }
    }
    yield row;
  }
}

async function parseXlsxStreaming(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)/)?.[1] || 0) - Number(b.match(/sheet(\d+)/)?.[1] || 0));
  if (!sheetFiles.length) throw new Error("no worksheets in workbook");

  const workbookXml = (await zip.file("xl/workbook.xml")?.async("text")) || "";
  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => xmlDecode(m[1]));

  let shared: string[] = [];
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  if (sharedEntry) {
    let sharedBuffer = "";
    for await (const chunk of streamZipEntryText(zip, "xl/sharedStrings.xml")) {
      sharedBuffer += chunk;
      let end = sharedBuffer.indexOf("</si>");
      while (end !== -1) {
        const start = sharedBuffer.indexOf("<si");
        if (start === -1 || start > end) { sharedBuffer = sharedBuffer.slice(end + 5); }
        else {
          const si = sharedBuffer.slice(start, end + 5);
          const parts = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
          shared.push(xmlDecode(parts.map((part) => part.replace(/<[^>]+>/g, "")).join("")));
          sharedBuffer = sharedBuffer.slice(end + 5);
        }
        end = sharedBuffer.indexOf("</si>");
      }
    }
  }

  const output: string[] = [];
  for (let i = 0; i < sheetFiles.length; i++) {
    const summary = await summarizeTable(
      sheetNames[i] || `Sheet${i + 1}`,
      withDateColumns(streamSheetRows(zip, sheetFiles[i], shared)),
    );
    if (summary) output.push(summary);
  }

  return cleanText(output.join("\n\n"));
}

async function parseXlsx(bytes: Uint8Array) {
  // Fast path: real OOXML workbooks (.xlsx / .xlsm) stream straight from the zip.
  try {
    const streamed = await parseXlsxStreaming(bytes);
    if (streamed && streamed.length > 40) return streamed;
  } catch (err) {
    console.warn("streaming xlsx read failed, falling back to xlsx lib:", err);
  }

  // Fallback for legacy .xls / .xlsb and unusual workbooks. The library keeps
  // every cell in memory, so only use it for smaller files.
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(unreadableFileMessage);
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: false, cellText: false, raw: false, WTF: false } as any);
  const output: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet: any = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
    const summary = await summarizeTable(sheetName, rows.map((row: any[]) => row.map((cell) => String(cell ?? ""))));
    delete workbook.Sheets[sheetName];
    if (summary) output.push(summary);
  }

  return cleanText(output.join("\n\n"));
}

// Parse CSV/TSV text (or a .xls that is actually a CSV) into the same
// summarized structure that parseXlsx produces, so downstream chat retrieval
// gets "Exact value counts" + full row data with accurate totals.
async function csvLikeToStructured(raw: string, fileName: string): Promise<string> {
  const text = raw.replace(/^\uFEFF/, "");
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const candidates = ["\t", ",", ";", "|"];
  const delimiter = candidates
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
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === delimiter) { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  // Stream lines through the summarizer instead of materializing every parsed
  // row, so multi-million-row CSVs stay within memory.
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => line.trim())) return raw.slice(0, MAX_TEXT_CHARS);
  const rowIterator = (function* () {
    for (const line of lines) {
      if (!line.trim()) continue;
      yield parseLine(line);
    }
  })();
  const summary = await summarizeTable(fileName, rowIterator);
  return summary || raw.slice(0, MAX_TEXT_CHARS);
}

async function parsePptx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => {
    const an = Number(a.match(/slide(\d+)/)?.[1] || 0);
    const bn = Number(b.match(/slide(\d+)/)?.[1] || 0);
    return an - bn;
  });
  const output: string[] = [];

  for (const name of slides) {
    const xml = await zip.file(name)?.async("text");
    if (!xml) continue;
    const slideNo = name.match(/slide(\d+)/)?.[1] || "";
    output.push(`## Slide ${slideNo}\n${extractXmlText(xml)}`);
  }

  return cleanText(output.join("\n\n"));
}

async function visionExtract(bytes: Uint8Array, mimeType: string, fileName: string) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("VITE_GEMINI_API_KEY");
  const prompt = `Extract every readable detail from ${fileName} into clean markdown. This may be a SCANNED page, photo of a document, handwritten note, receipt, form, screenshot or BI dashboard.
- OCR every character of text, including small print, headers, footers, stamps, handwriting and rotated/skewed text.
- Reproduce every table as a markdown table, row by row, with all cells (never summarize a table).
- For dashboards/charts capture every visible metric, KPI card, label, legend, axis tick, filter and total.
- Write numbers exactly as printed (74.32% stays 74.32%). Never round, guess or invent.
- Number the lines you read as "Line 1:", "Line 2:", ... in reading order, so exact positions can be cited later.
If truly nothing is readable, respond exactly NOT_READABLE.`;

  if (GEMINI_API_KEY) {
    // Scanned pages benefit from a stronger model; fall back down the list on
    // error/quota. Large images go through the Files API instead of inline base64.
    let fileRef: { uri: string; mimeType: string } | null = null;
    if (bytes.byteLength > 15 * 1024 * 1024) {
      try {
        fileRef = await uploadToGeminiFileApi(bytes, mimeType, fileName, GEMINI_API_KEY);
      } catch (err) {
        console.warn("Files API upload for image failed, trying inline:", err);
      }
    }

    for (const model of ["gemini-2.5-pro", "gemini-2.5-flash"]) {
      const filePart = fileRef
        ? { file_data: { mime_type: fileRef.mimeType, file_uri: fileRef.uri } }
        : { inline_data: { mime_type: mimeType, data: encodeBase64(bytes) } };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [filePart, { text: prompt }] }],
            generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 8192 },
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const extracted = (data.candidates?.[0]?.content?.parts || [])
          .map((part: any) => typeof part.text === "string" ? part.text : "")
          .join("\n")
          .trim();
        if (extracted && extracted !== "NOT_READABLE") return cleanText(extracted);
      } else {
        console.warn(`direct image extraction failed (${model}):`, response.status, await response.text());
      }
    }
  }


  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "edge-function-fetch",
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${encodeBase64(bytes)}` } },
        ],
      }],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("vision extraction error:", response.status, errText);
    throw new Error("Failed to extract document content");
  }

  const data = await response.json();
  const extracted = typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content.trim() : "";
  if (!extracted || extracted === "NOT_READABLE") throw new Error(unreadableFileMessage);
  return cleanText(extracted);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null);
    const fileUrl = typeof body?.fileUrl === "string" ? body.fileUrl : "";
    const fileName = typeof body?.fileName === "string" ? body.fileName : "file";
    if (!fileUrl) {
      return new Response(JSON.stringify({ error: "No file URL provided", success: false }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) throw new Error("Failed to fetch file");

    const contentType = fileResponse.headers.get("content-type") || "";
    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBytes = new Uint8Array(fileBuffer);
    const fileSizeMB = fileBytes.byteLength / (1024 * 1024);
    console.log(`parse-document: ${fileName} size=${fileSizeMB.toFixed(2)}MB type=${contentType}`);

    if (fileSizeMB > MAX_FILE_MB) {
      return new Response(JSON.stringify({ error: `File too large (max ${MAX_FILE_MB}MB).`, success: false }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lowerName = fileName.toLowerCase();
    const isImage = contentType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|tiff?)$/i.test(lowerName);
    const isPDF = contentType.includes("pdf") || lowerName.endsWith(".pdf");
    const isTextLike =
      contentType.startsWith("text/") ||
      contentType.includes("json") ||
      contentType.includes("xml") ||
      contentType.includes("csv") ||
      contentType.includes("javascript") ||
      /\.(txt|md|markdown|csv|tsv|json|jsonl|ndjson|xml|html?|log|yaml|yml|ini|conf|env|rtf|py|js|ts|tsx|jsx|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|sql|sh|bash|zsh)$/i.test(lowerName);

    let mimeType = contentType || "application/octet-stream";
    if (isPDF) mimeType = "application/pdf";
    else if (isImage && !mimeType.startsWith("image/")) mimeType = "image/png";

    let extractedText = "";

    const isCsvLike = /\.(csv|tsv)$/i.test(lowerName) || contentType.includes("csv") || contentType.includes("tab-separated");
    const isXlsLike = /\.(xlsx|xlsm|xls|xlsb)$/i.test(lowerName) || contentType.includes("spreadsheet") || contentType.includes("excel");

    if (isXlsLike) {
      // xlsx library handles .xlsx/.xlsm/.xls/.xlsb. If a .xls is actually a
      // mislabeled CSV, fall back to CSV parsing so we still get the
      // "Exact value counts" summary and full row data.
      try {
        extractedText = await parseXlsx(fileBytes);
        if (!extractedText || extractedText.length < 20) throw new Error("empty xlsx");
      } catch (err) {
        console.warn("XLSX parse failed, retrying as CSV text:", err);
        const raw = new TextDecoder().decode(fileBuffer);
        extractedText = await csvLikeToStructured(raw, fileName);
      }
    } else if (isCsvLike) {
      const raw = new TextDecoder().decode(fileBuffer);
      extractedText = await csvLikeToStructured(raw, fileName);
    } else if (isImage) {
      extractedText = await visionExtract(fileBytes, mimeType, fileName);
    } else if (isPDF) {
      extractedText = await parsePdfAccurately(fileBytes, fileName);
    } else if (lowerName.endsWith(".docx")) {
      extractedText = await parseDocx(fileBytes);
    } else if (lowerName.endsWith(".pptx")) {
      extractedText = await parsePptx(fileBytes);
    } else if (isTextLike) {
      let raw = new TextDecoder().decode(fileBuffer);
      if (/\.rtf$/i.test(lowerName)) raw = raw.replace(/\\[a-z]+-?\d*\s?/gi, " ").replace(/[{}]/g, " ");
      extractedText = raw;
    } else if (/\.(odt|ods|odp)$/i.test(lowerName)) {
      try {
        const zip = await JSZip.loadAsync(fileBytes);
        const contentXml = await zip.file("content.xml")?.async("text");
        extractedText = contentXml ? extractXmlText(contentXml) : extractBinaryStrings(fileBytes);
      } catch {
        extractedText = extractBinaryStrings(fileBytes);
      }
    } else if (/\.(doc|ppt)$/i.test(lowerName)) {
      extractedText = extractBinaryStrings(fileBytes);
    } else {
      extractedText = extractBinaryStrings(fileBytes);
    }

    extractedText = cleanText(extractedText);
    if (!extractedText || extractedText.length < 8) throw new Error(unreadableFileMessage);

    const truncated = extractedText.length >= MAX_TEXT_CHARS;
    return new Response(JSON.stringify({ text: extractedText, type: mimeType, success: true, truncated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-document error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message, success: false }), {
      status: message === unreadableFileMessage ? 422 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
