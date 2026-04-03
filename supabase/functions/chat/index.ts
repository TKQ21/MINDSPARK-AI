import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STOPWORDS = new Set([
  "the", "is", "are", "was", "were", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "by", "with",
  "from", "what", "which", "who", "when", "where", "why", "how", "can", "could", "should", "would", "please",
  "tell", "me", "about", "this", "that", "into", "than", "then", "have", "has", "had", "your", "their",
  "hai", "ka", "ki", "ke", "ko", "se", "me", "mai", "aur", "kya", "kyu", "kaise", "kis", "ye", "woh",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitDocumentIntoChunks(text: string, chunkSize = 1800, overlap = 250): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];

  const blocks = cleaned.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const source = blocks.length ? blocks : [cleaned];
  const chunks: string[] = [];
  let current = "";

  for (const block of source) {
    if (!current) {
      current = block;
      continue;
    }

    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    chunks.push(current.trim());
    const overlapText = current.slice(Math.max(0, current.length - overlap)).trim();
    current = overlapText ? `${overlapText}\n\n${block}` : block;

    while (current.length > chunkSize) {
      chunks.push(current.slice(0, chunkSize).trim());
      current = current.slice(Math.max(1, chunkSize - overlap)).trim();
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function getQueryTerms(query: string): string[] {
  return [...new Set(normalizeText(query).split(" "))]
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

function scoreChunk(chunk: string, query: string, queryTerms: string[]): number {
  const normalizedChunk = normalizeText(chunk);
  if (!normalizedChunk) return 0;

  const normalizedQuery = normalizeText(query);
  let score = 0;

  if (normalizedQuery && normalizedChunk.includes(normalizedQuery)) score += 30;

  for (const term of queryTerms) {
    const occurrences = normalizedChunk.split(term).length - 1;
    score += occurrences * 5;
  }

  const queryNumbers = query.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of queryNumbers) {
    if (chunk.includes(number)) score += 8;
  }

  if (/table|chart|figure|page|section|dashboard|metric|list|summary|note/i.test(query) && /table|chart|figure|page|section|dashboard|metric|list/i.test(chunk)) {
    score += 6;
  }

  return score;
}

function pickRelevantChunks(documentContext: string, query: string) {
  const chunks = splitDocumentIntoChunks(documentContext);
  if (!chunks.length) return [] as Array<{ chunk: string; index: number; score: number }>;

  const genericDocumentRequest = /summary|summarize|notes|overview|explain|gist|main points|key points/i.test(query);
  const queryTerms = getQueryTerms(query);

  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, query, queryTerms) }))
    .sort((a, b) => b.score - a.score);

  const selected: Array<{ chunk: string; index: number; score: number }> = [];
  let totalChars = 0;

  for (const item of ranked) {
    if (!genericDocumentRequest && item.score <= 0) continue;
    if (totalChars + item.chunk.length > 12000 && selected.length > 0) continue;
    selected.push(item);
    totalChars += item.chunk.length;
    if (selected.length >= 8) break;
  }

  if (!selected.length && genericDocumentRequest) {
    return chunks.slice(0, 5).map((chunk, index) => ({ chunk, index, score: 1 }));
  }

  return selected.sort((a, b) => a.index - b.index);
}

function buildRetrievedContext(chunks: Array<{ chunk: string; index: number; score: number }>): string {
  return chunks
    .map(({ chunk, index }) => `### Excerpt ${index + 1}\n${chunk}`)
    .join("\n\n---\n\n");
}

function streamSingleMessage(content: string) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

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

function getSystemPrompt(intent: string, hasDocContext: boolean): string {
  const base = `You are MINDSPARK AI — a world-class AI assistant with ChatGPT-level intelligence.

CORE RULES:
1. Always respond in clean, well-structured Markdown.
2. Use ## headings, ### subheadings, **bold**, bullet points, numbered lists.
3. For ANY comparison → ALWAYS use a markdown table.
4. For code → ALWAYS use fenced code blocks with language identifier.
5. Break complex topics into clear sections — never dump long paragraphs.
6. For math: show step-by-step solutions with formulas.
7. Be precise, professional, friendly. Use emojis sparingly.
8. If the question is unclear, ask a short clarifying question.
9. Give complete, detailed answers — don't cut short.
10. For programming: provide FULL working code with comments.
11. Support Hindi and English naturally.
12. Always cite sources or reasoning when making claims.
13. Format responses exactly like ChatGPT — structured, clean, readable.`;

  if (hasDocContext) {
    return `${base}

📄 **DOCUMENT ANALYSIS MODE ACTIVE**
A document has been uploaded and only the retrieved excerpts from the latest uploaded document are provided below as context.

CRITICAL RULES FOR DOCUMENT Q&A:
1. Answer questions ONLY from the retrieved excerpts of the latest uploaded document.
2. If the answer is present, use the document's wording as closely as possible and quote key lines.
3. If the answer is missing, incomplete, or uncertain, reply exactly: **Answer not in this document.**
4. Combine multiple excerpts only when they clearly refer to the same answer.
5. If asked for summary or notes, use only the retrieved excerpts and keep the structure clean.
6. Preserve tables, lists, and important numeric values from the document.
7. NEVER use outside knowledge, assumptions, or hallucinations.
8. Mention the excerpt numbers you used when relevant.`;
  }

  const plugins: Record<string, string> = {
    education: `${base}

🎓 **EDUCATION MODULE**
- Break down complex topics step-by-step
- Show every step in math solutions
- Use examples and analogies
- Offer practice questions at the end`,

    entertainment: `${base}

🎮 **ENTERTAINMENT MODULE**
- Be creative, witty, engaging
- Recommend movies, music, games with tables
- Tell jokes, create stories`,

    health: `${base}

💪 **HEALTH MODULE**
- Suggest routines with tables for sets/reps
- Create diet plans with calorie counts
- Always add: "Consult a healthcare professional for medical advice"`,

    ecommerce: `${base}

🛒 **SHOPPING MODULE**
- Compare products with pros/cons tables
- Include specs, prices, ratings
- Suggest best options within budget`,

    career: `${base}

💼 **CAREER MODULE**
- Interview prep with Q&A format
- Resume and portfolio guidance
- Skill roadmaps as tables`,

    general: base,
  };

  return plugins[intent] || plugins.general;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const documentContext = typeof body?.documentContext === "string" ? body.documentContext : "";

    if (!messages.length) {
      return new Response(JSON.stringify({ error: "Messages are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const hasDocContext = documentContext.trim().length > 0;
    const intent = hasDocContext ? "document" : (lastUserMsg ? detectIntent(lastUserMsg.content) : "general");
    const systemPrompt = getSystemPrompt(intent, hasDocContext);

    const apiMessages: any[] = [{ role: "system", content: systemPrompt }];

    if (hasDocContext) {
      const latestQuestion = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
      const relevantChunks = pickRelevantChunks(documentContext, latestQuestion);

      if (!relevantChunks.length) {
        return streamSingleMessage("**Answer not in this document.**");
      }

      apiMessages.push({
        role: "system",
        content: `📄 RETRIEVED EXCERPTS FROM THE LATEST UPLOADED DOCUMENT:\n\n${buildRetrievedContext(relevantChunks)}\n\nUse only these excerpts to answer the user's question. If the answer is not fully supported here, reply exactly with **Answer not in this document.**`,
      });
    }

    apiMessages.push(...messages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: apiMessages,
        temperature: hasDocContext ? 0.1 : 0.7,
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
