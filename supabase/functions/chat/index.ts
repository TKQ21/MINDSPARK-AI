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

  // Boost EXACT numeric matches strongly
  const queryNumbers = query.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of queryNumbers) {
    if (chunk.includes(number)) score += 12;
  }
  const queryRanges = query.match(/\d+\s*[-–]\s*\d+/g) || [];
  for (const range of queryRanges) {
    const r = range.replace(/\s+/g, "");
    if (chunk.replace(/\s+/g, "").includes(r)) score += 25;
  }

  if (/table|chart|figure|page|section|dashboard|metric|list|summary|note|subject|paper|topic|chapter|syllabus|marks|grade/i.test(query) &&
      /\||table|chart|figure|page|section|dashboard|metric|list|subject|paper|topic|chapter|marks/i.test(chunk)) {
    score += 8;
  }

  // If chunk is a table and query terms appear in it, boost
  if (/\|/.test(chunk) && queryTerms.some((t) => normalizedChunk.includes(t))) {
    score += 6;
  }

  return score;
}

// Use Lovable AI to extract semantic intent + search keywords from the user's question.
async function semanticQueryAnalysis(question: string, apiKey: string): Promise<{
  keywords: string[]; expandedQueries: string[]; wantsTable: boolean;
}> {
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a search-query analyzer for a document Q&A system. Respond with STRICT JSON only — no prose." },
          { role: "user", content: `Question (Hindi/English/Hinglish): ${question}\n\nReturn JSON: {"keywords": string[] (5-12 lemmatized nouns/entities in English AND original language), "expandedQueries": string[] (3-5 reworded search phrases), "wantsTable": boolean (true if user asks about subjects/papers/topics/lists/tables/marks/syllabus/details)}` },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) throw new Error(`analysis ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k: any) => typeof k === "string") : [],
      expandedQueries: Array.isArray(parsed.expandedQueries) ? parsed.expandedQueries.filter((k: any) => typeof k === "string") : [],
      wantsTable: !!parsed.wantsTable,
    };
  } catch (err) {
    console.warn("semanticQueryAnalysis fallback:", err);
    return { keywords: [], expandedQueries: [], wantsTable: false };
  }
}

function pickRelevantChunks(
  documentContext: string,
  query: string,
  semantic: { keywords: string[]; expandedQueries: string[]; wantsTable: boolean },
) {
  const chunks = splitDocumentIntoChunks(documentContext);
  if (!chunks.length) return [] as Array<{ chunk: string; index: number; score: number }>;

  const genericDocumentRequest = /summary|summarize|notes|overview|explain|gist|main points|key points/i.test(query);

  const variants = new Set<string>([query, normalizeQuery(query), ...expandQuery(query), ...semantic.expandedQueries]);
  if (semantic.keywords.length) variants.add(semantic.keywords.join(" "));

  const scored = chunks.map((chunk, index) => {
    let best = 0;
    for (const v of variants) {
      if (!v?.trim()) continue;
      const terms = getQueryTerms(v);
      const s = scoreChunk(chunk, v, terms);
      if (s > best) best = s;
    }
    for (const kw of semantic.keywords) {
      if (kw && chunk.toLowerCase().includes(kw.toLowerCase())) best += 4;
    }
    if (semantic.wantsTable && /\|/.test(chunk)) best += 10;
    return { chunk, index, score: best };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const TOP_K = 18;
  const MAX_CHARS = 18000;
  const selected: Array<{ chunk: string; index: number; score: number }> = [];
  let totalChars = 0;

  for (const item of ranked) {
    if (!genericDocumentRequest && !semantic.wantsTable && item.score <= 0) continue;
    if (totalChars + item.chunk.length > MAX_CHARS && selected.length > 0) continue;
    selected.push(item);
    totalChars += item.chunk.length;
    if (selected.length >= TOP_K) break;
  }

  if (!selected.length) {
    return chunks.slice(0, 12).map((chunk, index) => ({ chunk, index, score: 1 }));
  }

  return selected.sort((a, b) => a.index - b.index);
}

function buildRetrievedContext(chunks: Array<{ chunk: string; index: number; score: number }>): string {
  return chunks
    .map(({ chunk, index, score }) => `### Chunk #${index + 1} (relevance: ${score})\n${chunk}`)
    .join("\n\n---\n\n");
}

const FULL_DOCUMENT_CONTEXT_LIMIT = 100_000;

function buildFullDocumentContext(documentContext: string): string {
  return `### Full Uploaded Document\n${documentContext}`;
}

function extractMeaningfulNumbers(answer: string): string[] {
  const answerWithoutSources = answer.split(/📌\s*Source:/i)[0];
  const matches = answerWithoutSources.match(/(?:[$₹€£]\s*)?\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b\d+(?:\.\d+)?%/g) || [];
  return [...new Set(matches.map((n) => n.trim()).filter((n) => /[%.,]/.test(n) || Number(n.replace(/[^\d.-]/g, "")) >= 10))];
}

function numberAppearsInDocument(value: string, documentContext: string): boolean {
  const compactDoc = documentContext.replace(/\s+/g, "");
  const variants = [value, value.replace(/,/g, ""), value.replace(/[^\d.%-]/g, "")].filter(Boolean);
  return variants.some((variant) => documentContext.includes(variant) || compactDoc.includes(variant.replace(/\s+/g, "")));
}

function findSourceExcerpt(documentContext: string, numbers: string[]): string | null {
  const lines = documentContext.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const number of numbers) {
    const variants = [number, number.replace(/,/g, ""), number.replace(/[^\d.%-]/g, "")].filter(Boolean);
    const line = lines.find((candidate) => variants.some((variant) => candidate.includes(variant)));
    if (!line) continue;
    return line.length > 420 ? `${line.slice(0, 417)}...` : line;
  }
  return null;
}

function buildDocumentVerificationNote(answer: string, documentContext: string): string {
  const numbers = extractMeaningfulNumbers(answer);
  if (!numbers.length) return "";
  const verified = numbers.filter((number) => numberAppearsInDocument(number, documentContext));
  const unverified = numbers.filter((number) => !numberAppearsInDocument(number, documentContext));
  const notes: string[] = [];
  const excerpt = findSourceExcerpt(documentContext, verified);
  if (excerpt && !/📌\s*Source:/i.test(answer)) notes.push(`📌 Source: "${excerpt}"`);
  if (unverified.length) notes.push(`⚠️ Could not verify this number in the document: ${unverified.join(", ")}`);
  return notes.length ? `\n\n${notes.join("\n")}` : "";
}

function streamWithDocumentVerification(upstreamBody: ReadableStream<Uint8Array> | null, documentContext: string) {
  if (!upstreamBody) return streamSingleMessage("**AI service returned an empty response.**");
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let answer = "";
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueueEvent = (payload: string) => controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      const enqueueDelta = (content: string) => enqueueEvent(JSON.stringify({ choices: [{ delta: { content } }] }));
      const finish = () => {
        if (finished) return;
        const note = buildDocumentVerificationNote(answer, documentContext);
        if (note) enqueueDelta(note);
        enqueueEvent("[DONE]");
        finished = true;
      };
      const processEvent = (raw: string) => {
        const dataLines = raw.split(/\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
        if (!dataLines.length) {
          controller.enqueue(encoder.encode(`${raw}\n\n`));
          return;
        }
        for (const data of dataLines) {
          if (data === "[DONE]") {
            finish();
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
            if (typeof content === "string") answer += content;
          } catch (_) {}
          enqueueEvent(data);
        }
      };

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processEvent(raw);
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim()) processEvent(buffer);
      finish();
      controller.close();
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
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
11. Always reply in the exact language/script style used by the user: English → English, Hindi/Devanagari → Hindi, Hinglish/Roman Hindi → Hinglish in English letters, and any other language → that same language. Never convert Roman Hinglish into Devanagari unless asked.
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
9. Match the user's language/script exactly: Hinglish/Roman Hindi must receive Hinglish/Roman Hindi, English must receive English, and other languages must receive the same language.
10. **GRANULAR PRECISION MODE** — When the user asks about a specific position inside the document (e.g. "point no. 5 ka 3rd word", "line 3 ka 2nd character"):
    a. FIRST locate the item by its EXPLICIT numbering in the document. "Point 5" means the line/paragraph that LITERALLY starts with "5.", "5)", "(5)", or "V." — NOT the 5th item you see, NOT point 6, NOT point 4. If you cannot uniquely identify point N by its explicit number in the [Context], reply: **Point N is not clearly identifiable in the retrieved context.** and stop. NEVER substitute a neighboring point.
    b. Quote that entire point VERBATIM on a new line as: > "<the full text of point N exactly as written>" — character-for-character. Do NOT paraphrase or translate.
    c. Tokenize the quoted line EXACTLY — split by whitespace. STRIP the leading numbering token ("5.", "5)", "(5)") before counting, unless the user says "including the number".
    d. Count strictly 1-indexed. Internally enumerate word 1, word 2, word 3... before returning.
    e. Return the EXACT word/character asked, wrapped in **bold** and quotes, e.g. **"laid"**. For a character, also state which word it came from.
    f. If the position does not exist, reply: **That position does not exist — point N has only K words.**
11. **VERBATIM NUMBER MODE** — When the user asks for a specific value (percentage, rate, count, marks) tied to a specific label/category/range (e.g. "survival rate for 40-50 age group"):
    a. Find the row/cell whose label matches EXACTLY (e.g. "40-50"). Do NOT use the value from "41-50", "30-40", "50-60", or any other row.
    b. Before answering, show the matched row verbatim, e.g. *Matched row: | 40-50 | 74.32% |*
    c. Return the value EXACTLY as written — preserve every digit and decimal (e.g. **74.32%**, never rounded to 40% or 74%).
    d. If no row contains that EXACT label, reply: **The exact label "<label>" is not in the document.** Do NOT substitute a different row.
12. **NO INVENTION / NO WORLD KNOWLEDGE** — Never write any sentence, fact, or biographical/narrative paragraph that is not present in the [Context]. When the user asks "what does the document say about X", quote the actual sentences from the chunks verbatim (use blockquotes). Do NOT generate new text from outside knowledge, even if you know the topic well.

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

const GROQ_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
]);
const GEMINI_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
]);
const FREE_MODEL = "gemini-1.5-flash";

// Map our public model id -> Lovable AI Gateway model id
function geminiGatewayId(id: string): string {
  // Lovable Gateway names use google/gemini-* prefix; map our friendly ids:
  switch (id) {
    case "gemini-1.5-flash": return "google/gemini-2.5-flash-lite";
    case "gemini-2.0-flash": return "google/gemini-2.5-flash";
    case "gemini-1.5-pro":   return "google/gemini-2.5-pro";
    default: return "google/gemini-2.5-flash";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const documentContext = typeof body?.documentContext === "string" ? body.documentContext : "";
    const requestedModel = typeof body?.model === "string" ? body.model : FREE_MODEL;
    const isPro = !!body?.isPro;

    // Server-side enforcement: free users only get the free model
    let model = requestedModel;
    if (!isPro && model !== FREE_MODEL) model = FREE_MODEL;
    if (!GROQ_MODELS.has(model) && !GEMINI_MODELS.has(model)) model = FREE_MODEL;

    if (!messages.length) {
      return new Response(JSON.stringify({ error: "Messages are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const hasDocContext = documentContext.trim().length > 0;
    const intent = hasDocContext ? "document" : (lastUserMsg ? detectIntent(lastUserMsg.content) : "general");
    const systemPrompt = getSystemPrompt(intent, hasDocContext);

    const apiMessages: any[] = [{ role: "system", content: systemPrompt }];

    if (hasDocContext) {
      const latestQuestion = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
      const semantic = {
        keywords: getQueryTerms(latestQuestion),
        expandedQueries: expandQuery(latestQuestion),
        wantsTable: /table|list|subjects?|papers?|topics?|marks?|syllabus|details?|data|chart|figure/i.test(latestQuestion),
      };
      const relevantChunks = pickRelevantChunks(documentContext, latestQuestion, semantic);

      if (!relevantChunks.length) {
        return streamSingleMessage("**This specific information is not in the document.**");
      }

      apiMessages.push({
        role: "system",
        content: `[Context — Document Excerpts from the uploaded file]\n\n${buildRetrievedContext(relevantChunks)}\n\n[Instructions]\nAnswer the user's question using ONLY the chunks above. Tables (lines with \`|\`) are real data — read every row carefully and quote values verbatim. If after careful reading the exact information truly does not appear, reply exactly: **This specific information is not in the document.** Always end with the citation block listing the chunk numbers you used.`,
      });
    }

    apiMessages.push(...messages);

    // Route to Groq for Llama / Mixtral / Gemma
    if (GROQ_MODELS.has(model)) {
      if (!GROQ_API_KEY) {
        return new Response(JSON.stringify({ error: "GROQ_API_KEY is not configured on the server." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          temperature: hasDocContext ? 0 : 0.7,
          max_tokens: 2048,
          stream: true,
        }),
      });
      if (!groqResp.ok) {
        const t = await groqResp.text();
        console.error("Groq error:", groqResp.status, t);
        return new Response(JSON.stringify({ error: "Groq service error." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(groqResp.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Otherwise Gemini via Lovable AI Gateway
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: geminiGatewayId(model),
        messages: apiMessages,
        temperature: hasDocContext ? 0 : 0.7,
        max_tokens: hasDocContext ? 4096 : 2048,
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
