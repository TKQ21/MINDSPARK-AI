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
const MAX_TEXT_CHARS = 2_000_000;

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

  // FAST PATH: if the PDF already has clean selectable text, skip the slow Gemini vision pass.
  // Vision only runs for scanned PDFs / dashboards / image-only pages.
  if (looksLikeGoodText(selectableText)) {
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

async function parseDocx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name));
  const sections: string[] = [];

  for (const name of files) {
    const xml = await zip.file(name)?.async("text");
    if (!xml) continue;
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
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellText: false, raw: false });
  const output: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false })
      .map((row: any[]) => row.map((cell) => String(cell ?? "").trim()))
      .filter((row: string[]) => row.some(Boolean));
    if (!rows.length) continue;

    const header = rows[0].some(Boolean) ? rows[0].map((h, i) => h || `Column ${i + 1}`) : rows[0].map((_, i) => `Column ${i + 1}`);
    const body = rows.slice(1);
    const summary: string[] = [
      `## Sheet: ${sheetName}`,
      `Total data rows (excluding header): ${body.length}`,
      `Total columns: ${header.length}`,
      `Columns: ${header.join(" | ")}`,
    ];

    const countableColumnLimit = Math.min(header.length, 40);
    const valueCountLines: string[] = [];
    for (let col = 0; col < countableColumnLimit; col++) {
      const counts = new Map<string, number>();
      for (const row of body) {
        const value = (row[col] || "").trim();
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (!entries.length) continue;
      const allOrTop = entries.length <= 50 ? entries : entries.slice(0, 50);
      valueCountLines.push(`- ${header[col]}: ${allOrTop.map(([value, count]) => `${value} = ${count}`).join("; ")}${entries.length > 50 ? "; ..." : ""}`);
    }

    output.push([
      ...summary,
      valueCountLines.length ? `### Exact value counts by column\n${valueCountLines.join("\n")}` : "",
      `### Full row data\n${markdownTable([["Row #", ...header], ...body.map((row, index) => [String(index + 1), ...row])])}`,
    ].filter(Boolean).join("\n\n"));
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
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("VITE_GEMINI_API_KEY");
  const prompt = `Extract every readable detail from ${fileName} into clean markdown. OCR all text. For dashboards/charts, capture every visible metric, label, legend, axis, filter, table row, total, percentage, and number. Do not summarize or invent. If unreadable, respond exactly NOT_READABLE.`;

  if (GEMINI_API_KEY) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: encodeBase64(bytes) } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0, topP: 0.1 },
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
      console.warn("direct image extraction failed, trying gateway fallback:", response.status, await response.text());
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

    if (isTextLike) {
      let raw = new TextDecoder().decode(fileBuffer);
      // Strip RTF control words if it's an RTF file.
      if (/\.rtf$/i.test(lowerName)) raw = raw.replace(/\\[a-z]+-?\d*\s?/gi, " ").replace(/[{}]/g, " ");
      extractedText = raw;
    } else if (isImage) {
      extractedText = await visionExtract(fileBytes, mimeType, fileName);
    } else if (isPDF) {
      extractedText = await parsePdfAccurately(fileBytes, fileName);
    } else if (lowerName.endsWith(".docx")) {
      extractedText = await parseDocx(fileBytes);
    } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) {
      extractedText = await parseXlsx(fileBytes);
    } else if (lowerName.endsWith(".pptx")) {
      extractedText = await parsePptx(fileBytes);
    } else if (/\.(odt|ods|odp)$/i.test(lowerName)) {
      // OpenDocument formats are ZIPs with content.xml
      try {
        const zip = await JSZip.loadAsync(fileBytes);
        const contentXml = await zip.file("content.xml")?.async("text");
        extractedText = contentXml ? extractXmlText(contentXml) : extractBinaryStrings(fileBytes);
      } catch {
        extractedText = extractBinaryStrings(fileBytes);
      }
    } else if (/\.(doc|xls|ppt)$/i.test(lowerName)) {
      // Legacy Office binary — best-effort string extraction.
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
