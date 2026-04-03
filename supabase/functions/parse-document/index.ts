import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileUrl, fileName } = await req.json();
    if (!fileUrl) throw new Error("No file URL provided");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch the file
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) throw new Error("Failed to fetch file");

    const contentType = fileResponse.headers.get("content-type") || "";
    const fileBuffer = await fileResponse.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

    // Use Gemini's multimodal capability to extract text from any document
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

    // For plain text files, just return the content directly
    if (mimeType === "text/plain" || mimeType === "text/csv") {
      const textContent = new TextDecoder().decode(fileBuffer);
      return new Response(JSON.stringify({ 
        text: textContent,
        type: mimeType,
        success: true 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use Gemini multimodal to extract ALL content from the document
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                },
              },
              {
                type: "text",
                text: `Extract ALL text content from this document completely and accurately. Include:
- All text, headings, paragraphs
- All table data (format as markdown tables)
- All lists and bullet points
- All captions and labels
- Any text in images or charts (OCR)
- Page numbers if visible
- Any metadata visible

Preserve the original structure and formatting as much as possible using markdown.
Do NOT summarize. Do NOT skip anything. Extract EVERYTHING verbatim.
If there are images, describe what they show in [Image: description] format.`,
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
    const extractedText = data.choices?.[0]?.message?.content || "";

    if (!extractedText) {
      throw new Error("Could not extract text from document");
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
    return new Response(JSON.stringify({ 
      error: e instanceof Error ? e.message : "Unknown error",
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
