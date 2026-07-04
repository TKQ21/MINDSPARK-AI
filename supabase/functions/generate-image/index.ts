import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "A valid prompt is required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("VITE_GEMINI_API_KEY");
    if (!LOVABLE_API_KEY && !GEMINI_API_KEY) throw new Error("Image AI is not configured");

    const enhancedPrompt = `Create a polished, high-resolution image that follows the user's request exactly.

User request:
${prompt.trim()}

Rules:
- Preserve the requested style, medium, mood, lighting, and composition.
- If a specific place, landmark, school, hospital, hotel, or location is mentioned, depict a believable and recognizable real-world style representation of it.
- Do not add text, watermarks, captions, or symbols unless the user explicitly asks for them.
- Keep important faces, hands, and subjects fully visible unless the user requests a crop.
- Output should be visually coherent, detailed, and clean.`;

    const callLovableImage = () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY!,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "edge-function-fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image",
        messages: [
          { role: "user", content: enhancedPrompt },
        ],
        modalities: ["image", "text"],
      }),
    });

    const callGeminiImage = () => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: enhancedPrompt }] }],
          generationConfig: { temperature: 0.8, topP: 0.95 },
        }),
      },
    );

    let response = LOVABLE_API_KEY ? await callLovableImage() : await callGeminiImage();
    if (!response.ok && (response.status === 429 || response.status === 402) && GEMINI_API_KEY) {
      console.warn("Image gateway busy/exhausted, using direct Gemini fallback:", response.status);
      response = await callGeminiImage();
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Image AI is busy right now. Please try again in a moment." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Image AI is temporarily unavailable. Please try again later." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Image gen error:", response.status, t);
      return new Response(JSON.stringify({ error: "Image generation failed. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const gatewayImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const gatewayText = data.choices?.[0]?.message?.content || "";
    const geminiParts = data.candidates?.[0]?.content?.parts || [];
    const inlineImage = geminiParts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
    const inlineData = inlineImage?.inlineData || inlineImage?.inline_data;
    const imageUrl = gatewayImageUrl || (inlineData?.data ? `data:${inlineData.mimeType || inlineData.mime_type || "image/png"};base64,${inlineData.data}` : null);
    const text = gatewayText || geminiParts.map((part: any) => typeof part.text === "string" ? part.text : "").join("\n").trim();

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "Could not generate the image. Please try a different description." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ image_url: imageUrl, text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("image gen error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
