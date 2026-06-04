import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { getDocument } from "https://esm.sh/pdfjs-serverless@1.2.3";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const unreadableFileMessage = "File received, but content could not be read. Please try re-uploading.";
const MAX_FILE_MB = 100;
const MAX_TEXT_CHARS = 650_000;

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

    for (const item of content.items || []) {
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

async function parsePdfWithGeminiVision(bytes: Uint8Array, fileName: string, selectableText: string) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const models = ["gemini-1.5-pro-latest", "gemini-2.5-pro", "gemini-2.5-flash"];
  let lastError = "";

  for (const model of models) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "application/pdf", data: encodeBase64(bytes) } },
              { text: buildPrecisionParsePrompt(fileName, selectableText) },
            ],
          }],
          generationConfig: { temperature: 0, topP: 0.1 },
        }),
      },
    );

    if (!response.ok) {
      lastError = await response.text();
      console.error(`Gemini PDF extraction error (${model}):`, response.status, lastError);
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

async function parsePdfAccurately(bytes: Uint8Array, fileName: string) {
  let selectableText = "";
  try {
    selectableText = await parsePdf(bytes);
  } catch (err) {
    console.warn("Selectable PDF extraction failed, trying vision:", err);
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

async function parseDocx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
  const sections: string[] = [];

  for (const name of files) {
    const xml = await zip.file(name)?.async("text");
    if (!xml) continue;
    const paragraphized = xml
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n");
    sections.push(`## ${name}\n${extractXmlText(paragraphized)}`);
  }

  return cleanText(sections.join("\n\n"));
}

function columnIndex(ref: string) {
  const letters = (ref.match(/[A-Z]+/i)?.[0] || "A").toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + ch.charCodeAt(0) - 64;
  return index - 1;
}

function markdownTable(rows: string[][]) {
  const useful = rows.filter((r) => r.some((c) => c.trim()));
  if (!useful.length) return "";
  const width = Math.min(40, Math.max(...useful.map((r) => r.length)));
  const normalized = useful.map((r) => Array.from({ length: width }, (_, i) => (r[i] || "").replace(/\|/g, "/").trim()));
  const header = normalized[0].some(Boolean) ? normalized[0] : normalized[0].map((_, i) => `Column ${i + 1}`);
  const body = normalized.slice(1);
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

async function parseXlsx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)].map((m) => extractXmlText(m[0])) : [];
  const sheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
  const output: string[] = [];

  for (const sheetName of sheetFiles) {
    const xml = await zip.file(sheetName)?.async("text");
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const ref = attrs.match(/r="([A-Z]+\d+)"/i)?.[1] || `A${rows.length + 1}`;
        const type = attrs.match(/t="([^"]+)"/)?.[1] || "";
        const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        const resolved = type === "s" ? shared[Number(value)] || "" : xmlDecode(value);
        row[columnIndex(ref)] = resolved;
      }
      rows.push(row);
    }
    const sheetNo = sheetName.match(/sheet(\d+)/)?.[1] || "";
    output.push(`## Sheet ${sheetNo}\n${markdownTable(rows)}`);
  }

  return cleanText(output.join("\n\n"));
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
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract every readable detail from ${fileName} into clean markdown. OCR all text. For dashboards/charts, capture every visible metric, label, legend, axis, filter, table row, total, percentage, and number. Do not summarize or invent. If unreadable, respond exactly NOT_READABLE.`,
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

serve(async (req) => {
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
    const isImage = contentType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(lowerName);
    const isPDF = contentType.includes("pdf") || lowerName.endsWith(".pdf");
    const isTextLike = contentType.startsWith("text/") || /\.(txt|md|csv|json|xml|html|log|tsv)$/i.test(lowerName);

    let mimeType = contentType || "application/octet-stream";
    if (isPDF) mimeType = "application/pdf";
    else if (isImage && !mimeType.startsWith("image/")) mimeType = "image/png";

    let extractedText = "";

    if (isTextLike) extractedText = new TextDecoder().decode(fileBuffer);
    else if (isImage) extractedText = await visionExtract(fileBytes, mimeType, fileName);
    else if (isPDF) extractedText = await parsePdfAccurately(fileBytes, fileName);
    else if (lowerName.endsWith(".docx")) extractedText = await parseDocx(fileBytes);
    else if (lowerName.endsWith(".xlsx")) extractedText = await parseXlsx(fileBytes);
    else if (lowerName.endsWith(".pptx")) extractedText = await parsePptx(fileBytes);
    else extractedText = extractBinaryStrings(fileBytes);

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
