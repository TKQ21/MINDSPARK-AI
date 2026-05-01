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

// FIX 3 — Normalize query: expand numeric ranges, drop Hindi/English fillers
function normalizeQuery(q: string): string {
  return q
    .replace(/(\d+)\s*[-–]\s*(\d+)/g, "$1 to $2 age group range")
    .replace(/\b(ka|ki|ke|ko|se|mai|mein|me|aur|ya|toh|hai|hain|tha|thi|the)\b/gi, " ")
    .replace(/\b(kitni|kitna|kitne|kya|kyun|kaise|kaun|kab|kahan)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// FIX 4 — Expand query into multiple search variants
function expandQuery(question: string): string[] {
  const normalized = normalizeQuery(question);
  const variants = new Set<string>([
    question,
    normalized,
    `${normalized} exact value number percentage rate`,
    question.replace(/(\d+)\s*[-–]\s*(\d+)/g, (m) => `${m} age group data point`),
  ]);
  return [...variants].filter((v) => v.trim().length > 0);
}

// Structure-aware chunking: keeps tables intact, groups sections by headings,
// preserves paragraph context. Larger chunks (≈900 chars) with overlap so
// related sentences stay together for semantic matching.
function splitDocumentIntoChunks(text: string, chunkSize = 900, overlap = 150): string[] {
  const cleaned = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];

  // Split on blank lines to keep paragraphs / table blocks together
  const blocks = cleaned.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const isTableBlock = (b: string) =>
    /\|/.test(b) && b.split("\n").filter((l) => /\|/.test(l)).length >= 2;
  const isHeading = (b: string) => /^(#{1,6}\s|[A-Z][A-Z0-9 \-]{4,}$)/m.test(b);

  const chunks: string[] = [];
  let buffer = "";
  let currentHeading = "";

  const flush = () => {
    const t = buffer.trim();
    if (t) chunks.push(t);
    if (overlap > 0 && t.length > overlap) {
      buffer = t.slice(-overlap) + "\n";
    } else {
      buffer = "";
    }
  };

  for (const block of blocks) {
    // Tables and headings: keep whole and never split
    if (isTableBlock(block)) {
      if (buffer.trim()) flush();
      const tableWithCtx = currentHeading ? `${currentHeading}\n\n${block}` : block;
      chunks.push(tableWithCtx);
      buffer = "";
      continue;
    }
    if (isHeading(block) && block.length < 200) {
      if (buffer.trim()) flush();
      currentHeading = block;
      buffer = block + "\n\n";
      continue;
    }
    if ((buffer.length + block.length + 2) > chunkSize && buffer.trim()) {
      flush();
    }
    buffer += block + "\n\n";
  }
  if (buffer.trim()) chunks.push(buffer.trim());

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

  // Boost EXACT numeric matches strongly (ranges, percentages, integers)
  const queryNumbers = query.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of queryNumbers) {
    if (chunk.includes(number)) score += 12;
  }

  // Boost exact range match like "41-50" appearing in chunk
  const queryRanges = query.match(/\d+\s*[-–]\s*\d+/g) || [];
  for (const range of queryRanges) {
    const r = range.replace(/\s+/g, "");
    if (chunk.replace(/\s+/g, "").includes(r)) score += 25;
  }

  if (/table|chart|figure|page|section|dashboard|metric|list|summary|note/i.test(query) && /table|chart|figure|page|section|dashboard|metric|list/i.test(chunk)) {
    score += 6;
  }

  return score;
}

// FIX 4 + FIX 5 — Multi-variant retrieval, top_k=15
function pickRelevantChunks(documentContext: string, query: string) {
  const chunks = splitDocumentIntoChunks(documentContext);
  if (!chunks.length) return [] as Array<{ chunk: string; index: number; score: number }>;

  const genericDocumentRequest = /summary|summarize|notes|overview|explain|gist|main points|key points/i.test(query);
  const variants = expandQuery(query);

  // Score each chunk as MAX score across all query variants
  const scored = chunks.map((chunk, index) => {
    let best = 0;
    for (const v of variants) {
      const terms = getQueryTerms(v);
      const s = scoreChunk(chunk, v, terms);
      if (s > best) best = s;
    }
    return { chunk, index, score: best };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const TOP_K = 15;
  const selected: Array<{ chunk: string; index: number; score: number }> = [];
  let totalChars = 0;

  for (const item of ranked) {
    if (!genericDocumentRequest && item.score <= 0) continue;
    if (totalChars + item.chunk.length > 14000 && selected.length > 0) continue;
    selected.push(item);
    totalChars += item.chunk.length;
    if (selected.length >= TOP_K) break;
  }

  if (!selected.length && genericDocumentRequest) {
    return chunks.slice(0, 8).map((chunk, index) => ({ chunk, index, score: 1 }));
  }

  return selected.sort((a, b) => a.index - b.index);
}

function buildRetrievedContext(chunks: Array<{ chunk: string; index: number; score: number }>): string {
  return chunks
    .map(({ chunk, index, score }) => `### Chunk #${index + 1} (relevance: ${score})\n${chunk}`)
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
    return `You are MINDSPARK AI in **strict document Q&A mode** (NotebookLM-style).

📄 **DOCUMENT ANALYSIS MODE ACTIVE**
Only the retrieved chunks from the user's uploaded document are provided as [Context]. Treat them as the ONLY source of truth.

🚨 CRITICAL ANTI-HALLUCINATION RULES — Follow EXACTLY:
1. Answer ONLY from the [Context] chunks. NEVER use outside knowledge. NEVER guess.
2. If the user asks about a SPECIFIC numeric range (e.g. "41-50"), answer ONLY using chunks that contain that EXACT range. NEVER substitute "71+" or any other range as a stand-in.
3. If the document has multiple values for the same category, list ALL of them with their exact labels.
4. If the exact data is NOT in the context, reply EXACTLY: **This specific information is not in the document.**
5. NEVER estimate, round, or invent any number. Quote values verbatim from the chunks.
6. Keep answers SHORT and precise — 2–4 sentences (unless listing items or producing a table).
7. Use Markdown: tables for tabular data, **bold** for key values, bullet lists for enumerations.
8. Preserve the document's wording for key facts and numbers.

📌 MANDATORY CITATION FORMAT — Every answer MUST end with:
\`\`\`
📌 Source: [filename] | Chunk #[number]
\`\`\`
If multiple chunks were used, list each on a new line. The chunk numbers are shown in the [Context] as "### Chunk #N".`;
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
        return streamSingleMessage("**This specific information is not in the document.**");
      }

      apiMessages.push({
        role: "system",
        content: `[Context — Document Excerpts from the uploaded file]\n\n${buildRetrievedContext(relevantChunks)}\n\n[Instructions]\nAnswer the user's question using ONLY the chunks above. Quote exact numbers verbatim. If the user asked about a specific range/value that does not appear in these chunks, reply exactly: **This specific information is not in the document.** Always end with the mandatory citation block listing the chunk numbers you used.`,
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
        temperature: hasDocContext ? 0 : 0.7,
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
