import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function detectIntent(message: string): string {
  const msg = message.toLowerCase();
  if (/solve|math|equation|integral|derivative|calculus|algebra|geometry|trigonometry|formula/.test(msg)) return "education";
  if (/learn|study|explain|tutor|exam|quiz|homework|assignment|notes|chapter/.test(msg)) return "education";
  if (/joke|story|fun|meme|movie|music|song|entertainment|riddle|game/.test(msg)) return "entertainment";
  if (/diet|workout|exercise|health|fitness|yoga|meditation|nutrition|weight|calories/.test(msg)) return "health";
  if (/order|product|price|buy|shop|recommend|compare|budget|smartphone|laptop/.test(msg)) return "ecommerce";
  if (/career|interview|resume|job|salary|hire|linkedin|portfolio/.test(msg)) return "career";
  if (/file|document|pdf|summarize|summary|notes|analyze|uploaded/.test(msg)) return "document";
  return "general";
}

function getPluginSystemPrompt(intent: string): string {
  const base = `You are MINDSPARK AI, a ChatGPT-level general intelligence assistant.

Your behavior must strictly match ChatGPT quality.

RULES:
1. Always give clean, structured, and well-formatted answers.
2. Use headings (##, ###), bullet points, and tables whenever appropriate.
3. For comparisons, ALWAYS use markdown tables.
4. Explanations must be easy to understand, professional, and exam-oriented when academic.
5. Never give messy or long paragraphs — break everything into structured sections.
6. Always format output in proper Markdown: tables, **bold**, lists, \`code\`, code blocks with language identifiers.
7. If a user uploads a file: automatically analyze it, summarize key points, explain in simple language.
8. If the question is unclear, ask a short clarifying question.
9. Use bullet points and numbered lists for step-by-step explanations.
10. For code: always use fenced code blocks with the correct language identifier.
11. Be friendly, patient, and informative. Use emojis sparingly for engagement.`;

  const plugins: Record<string, string> = {
    education: `${base}

🎓 **EDUCATION MODULE ACTIVE**
You are now in Tutor Mode. Focus on teaching and explaining concepts step-by-step.
- Break down complex topics into simple parts
- Use examples, analogies, and diagrams (described in text)
- For math: show every step of the solution
- For science: explain underlying principles
- Offer practice questions at the end
- Support Hindi and English explanations`,

    entertainment: `${base}

🎮 **ENTERTAINMENT MODULE ACTIVE**
You are now in Fun Mode. Be creative, witty, and engaging.
- Tell jokes, stories, riddles
- Recommend movies, music, games
- Create fun quizzes
- Generate creative writing prompts
- Be playful and humorous in tone`,

    health: `${base}

💪 **HEALTH & FITNESS MODULE ACTIVE**
You are now in Health Advisor Mode. Provide helpful wellness guidance.
- Suggest workout routines with sets/reps
- Create diet plans with calorie counts
- Offer mental health tips and meditation guidance
- Always add disclaimer: "Consult a healthcare professional for medical advice"
- Use tables for meal plans and workout schedules`,

    ecommerce: `${base}

🛒 **SHOPPING MODULE ACTIVE**
You are now in Shopping Assistant Mode.
- Compare products with pros/cons tables
- Suggest best options within budget
- Provide specifications and features
- Include price ranges and value-for-money ratings
- Recommend based on user needs`,

    career: `${base}

💼 **CAREER MODULE ACTIVE**
You are now in Career Advisor Mode.
- Help with interview preparation (common questions + answers)
- Resume and portfolio tips
- Career path guidance
- Skill roadmaps for different roles
- Salary negotiation tips`,

    document: `${base}

📄 **DOCUMENT MODULE ACTIVE**
A file has been uploaded or referenced. Focus on:
- Summarizing the content clearly
- Extracting key points
- Creating study notes if educational
- Answering questions about the content
- Generating Q&A or flashcards from the material
Never display raw/binary file content. Only work with readable text.`,

    general: base,
  };

  return plugins[intent] || plugins.general;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Detect intent from the last user message
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const intent = lastUserMsg ? detectIntent(lastUserMsg.content) : "general";
    const systemPrompt = getPluginSystemPrompt(intent);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
