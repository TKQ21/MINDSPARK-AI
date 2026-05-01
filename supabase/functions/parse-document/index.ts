import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const unreadableFileMessage = "File received, but content could not be read. Please try re-uploading.";

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch the file
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) throw new Error("Failed to fetch file");

    const contentType = fileResponse.headers.get("content-type") || "";
    const fileBuffer = await fileResponse.arrayBuffer();
    const base64Data = encodeBase64(new Uint8Array(fileBuffer));

    const ext = (fileName || "").toLowerCase();
    const isImage = contentType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(ext);
    const isPDF = contentType.includes("pdf") || ext.endsWith(".pdf");

    let mimeType = contentType;
    if (isPDF) mimeType = "application/pdf";
    else if (isImage) mimeType = contentType || "image/png";
    else if (ext.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (ext.endsWith(".doc")) mimeType = "application/msword";
    else if (ext.endsWith(".xlsx")) mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    else if (ext.endsWith(".pptx")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    else if (ext.endsWith(".csv")) mimeType = "text/csv";
    else if (ext.endsWith(".txt")) mimeType = "text/plain";
    else if (ext.endsWith(".md")) mimeType = "text/markdown";
    else if (ext.endsWith(".json")) mimeType = "application/json";

    const isTextLike = mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("svg");

    if (isTextLike) {
      const textContent = new TextDecoder().decode(fileBuffer);
      if (!textContent.trim()) throw new Error(unreadableFileMessage);

      return new Response(JSON.stringify({ 
        text: textContent,
        type: mimeType,
        success: true 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract every readable detail from this uploaded file into clean markdown.

Rules:
- Preserve the original order of pages, slides, sheets, or sections.
- Extract headings, paragraphs, bullet points, captions, labels, footnotes, and page numbers.
- Convert tables into markdown tables.
- For dashboards, charts, screenshots, or reports, list every visible metric, legend, axis label, filter, status, and number.
- For images, run OCR on all visible text and describe important visuals as [Image: description].
- Do not summarize and do not invent missing data.
- If nothing readable is present, respond exactly with: NOT_READABLE`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini extraction error:", response.status, errText);
      throw new Error("Failed to extract document content");
    }

    const data = await response.json();
    const extractedText = typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content.trim()
      : "";

    if (!extractedText || extractedText === "NOT_READABLE") {
      throw new Error(unreadableFileMessage);
    }

    return new Response(JSON.stringify({ 
      text: extractedText,
      type: mimeType,
      success: true 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("parse-document error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ 
      error: message,
      success: false 
    }), {
      status: message === unreadableFileMessage ? 422 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
