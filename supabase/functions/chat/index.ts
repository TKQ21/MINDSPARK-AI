const serve = (handler: (req: Request) => Response | Promise<Response>) => Deno.serve(handler);

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

// Structure-aware chunking: keeps sections and normal tables intact, but splits
// huge Excel/CSV-style tables into row windows so 9k+ rows remain searchable.
function splitDocumentIntoChunks(text: string, chunkSize = 2200, overlap = 250): string[] {
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

  const pushTableChunks = (block: string) => {
    const lines = block.split("\n").filter(Boolean);
    if (block.length <= chunkSize * 2 || lines.length <= 30) {
      chunks.push(currentHeading ? `${currentHeading}\n\n${block}` : block);
      return;
    }

    const headerLines = lines.slice(0, Math.min(2, lines.length));
    const dataLines = lines.slice(headerLines.length);
    const rowsPerChunk = 80;
    for (let i = 0; i < dataLines.length; i += rowsPerChunk) {
      const part = [
        currentHeading,
        `Table rows ${i + 1}-${Math.min(i + rowsPerChunk, dataLines.length)} of ${dataLines.length}`,
        ...headerLines,
        ...dataLines.slice(i, i + rowsPerChunk),
      ].filter(Boolean).join("\n");
      chunks.push(part);
    }
  };

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
      pushTableChunks(block);
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

  if (/count|kitn|total|rows?|rating|stars?|frequency|value/i.test(query) && /Exact value counts|Total data rows|Full row data|Sheet:/i.test(chunk)) {
    score += 18;
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
      headers: { "Lovable-API-Key": apiKey, "Content-Type": "application/json" },
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

// ---------- Embedding based semantic retrieval (cosine similarity) ----------
const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_BATCH = 64;
const MAX_EMBED_CHUNKS = 320;

async function embedTexts(texts: string[], apiKey: string): Promise<number[][] | null> {
  try {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.slice(0, 6000));
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: { "Lovable-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
      });
      if (!resp.ok) {
        console.warn("embeddings failed:", resp.status, (await resp.text()).slice(0, 200));
        return null;
      }
      const data = await resp.json();
      const vectors = (data?.data || []).sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
      if (vectors.length !== batch.length) return null;
      out.push(...vectors);
    }
    return out;
  } catch (err) {
    console.warn("embedTexts error:", err);
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
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
  const MAX_CHARS = RETRIEVED_CONTEXT_LIMIT;
  const selected: Array<{ chunk: string; index: number; score: number }> = [];
  let totalChars = 0;

  // Always pin the sheet-level aggregate blocks (they hold the exact totals,
  // counts, numeric stats and grouped breakdowns for very large tables), but
  // never let them eat the whole budget.
  const PINNED_BUDGET = Math.floor(MAX_CHARS * 0.7);
  for (const item of scored) {
    if (/^(## Sheet:|Total data rows|Columns:|### Exact value counts by column|### Numeric statistics by column|### Grouped breakdowns|### Row sample)/im.test(item.chunk)) {
      if (totalChars + item.chunk.length > PINNED_BUDGET && selected.length > 0) continue;
      selected.push({ ...item, score: Math.max(item.score, 50) });
      totalChars += item.chunk.length;
    }
  }


  for (const item of ranked) {
    if (selected.some((s) => s.index === item.index)) continue;
    if (!genericDocumentRequest && !semantic.wantsTable && item.score <= 0) continue;
    if (totalChars + item.chunk.length > MAX_CHARS && selected.length > 0) continue;
    selected.push(item);
    totalChars += item.chunk.length;
    if (selected.length >= TOP_K) break;
  }

  if (!selected.length) {
    return chunks.slice(0, 10).map((chunk, index) => ({ chunk, index, score: 1 }));
  }

  return selected.sort((a, b) => a.index - b.index);
}

// Semantic (embedding) retrieval: chunk the doc, embed chunks + query,
// rank by cosine similarity, and keep the top-k grounded excerpts.
// Falls back to keyword scoring when embeddings are unavailable.
async function pickRelevantChunksSemantic(
  documentContext: string,
  query: string,
  semantic: { keywords: string[]; expandedQueries: string[]; wantsTable: boolean },
  apiKey: string | undefined,
): Promise<Array<{ chunk: string; index: number; score: number }>> {
  const keywordSelection = pickRelevantChunks(documentContext, query, semantic);
  if (!apiKey) return keywordSelection;

  const chunks = splitDocumentIntoChunks(documentContext);
  if (chunks.length < 2) return keywordSelection;

  // Pre-filter with keyword score when the doc is huge, so embedding stays fast.
  let candidates = chunks.map((chunk, index) => ({ chunk, index }));
  if (candidates.length > MAX_EMBED_CHUNKS) {
    const terms = getQueryTerms(query);
    candidates = candidates
      .map((c) => ({ ...c, s: scoreChunk(c.chunk, query, terms) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_EMBED_CHUNKS)
      .map(({ chunk, index }) => ({ chunk, index }));
  }

  const queryText = [query, ...semantic.expandedQueries, semantic.keywords.join(" ")]
    .filter((v) => v && v.trim())
    .join("\n")
    .slice(0, 4000);

  const vectors = await embedTexts([queryText, ...candidates.map((c) => c.chunk)], apiKey);
  if (!vectors || vectors.length !== candidates.length + 1) return keywordSelection;

  const queryVec = vectors[0];
  const ranked = candidates
    .map((c, i) => ({ chunk: c.chunk, index: c.index, score: cosine(queryVec, vectors[i + 1]) }))
    .sort((a, b) => b.score - a.score);

  const selected: Array<{ chunk: string; index: number; score: number }> = [];
  let totalChars = 0;

  // Always keep dataset summary chunks (row counts / value counts) for count questions.
  for (const item of ranked) {
    if (/^(## Sheet:|Total data rows|Columns:|### Exact value counts by column)/im.test(item.chunk)) {
      selected.push(item);
      totalChars += item.chunk.length;
    }
  }

  for (const item of ranked) {
    if (selected.some((s) => s.index === item.index)) continue;
    if (totalChars + item.chunk.length > RETRIEVED_CONTEXT_LIMIT && selected.length > 0) break;
    selected.push(item);
    totalChars += item.chunk.length;
    if (selected.length >= 16) break;
  }

  // Merge top keyword hits so exact literal/number matches are never lost.
  for (const item of keywordSelection.slice(0, 6)) {
    if (selected.some((s) => s.index === item.index)) continue;
    if (totalChars + item.chunk.length > RETRIEVED_CONTEXT_LIMIT) break;
    selected.push({ ...item, score: item.score });
    totalChars += item.chunk.length;
  }

  if (!selected.length) return keywordSelection;
  return selected.sort((a, b) => a.index - b.index);
}

function buildRetrievedContext(chunks: Array<{ chunk: string; index: number; score: number }>): string {
  return chunks
    .map(({ chunk, index, score }) => `### Chunk #${index + 1} (relevance: ${typeof score === "number" ? score.toFixed(3) : score})\n${chunk}`)
    .join("\n\n---\n\n");
}

// Keep prompts well inside provider payload limits — oversized single-shot
// contexts were causing upstream failures that surfaced as "AI service is busy".
const FULL_DOCUMENT_CONTEXT_LIMIT = 60_000;
const RETRIEVED_CONTEXT_LIMIT = 55_000;
const DOCUMENT_OUTPUT_TOKENS = 4096;

function buildFullDocumentContext(documentContext: string): string {
  return `### Full Uploaded Document\n${documentContext}`;
}


function ordinalToNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/(?:st|nd|rd|th)$/i, "");
  const numeric = Number(cleaned.replace(/\D/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  return words[cleaned] || null;
}

function stripLeadingNumbering(line: string) {
  return line
    .replace(/^\s*>?\s*/, "")
    .replace(/^Line\s+\d+\s*:\s*/i, "")
    .replace(/^\s*(?:Q(?:uestion)?\s*)?\(?\d+\)?[.)\-:]\s*/i, "")
    .trim();
}

// Find the line the user means.
// kind = "q"    → only real question numbering (Q3, Q.3, Q-3, Question 3, "3." , "3)")
// kind = "line" → only the explicit "Line N:" marker
function findExplicitDocumentLine(documentContext: string, itemNo: number, kind: "q" | "line" | "any") {
  const lines = documentContext.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const stripLineMarker = (line: string) => line.replace(/^Line\s+\d+\s*:\s*/i, "").trim();

  if (kind === "line") {
    for (const line of lines) {
      const match = line.match(/^Line\s+(\d+)\s*:\s*(.+)$/i);
      if (match && Number(match[1]) === itemNo) return line;
    }
    return null;
  }

  // Strict Q-numbering first: "Q.3", "Q3", "Q - 3", "Question 3", "Ques 3"
  const qPatterns = [
    new RegExp(`^(?:Q(?:uestion|ues|n)?)\\s*[.)\\-:]?\\s*${itemNo}(?![0-9])\\s*[.)\\-:]?\\s*(.*)$`, "i"),
    new RegExp(`^\\(?${itemNo}\\)?\\s*[.)\\-:]\\s+(.+)$`),
  ];
  for (const pass of qPatterns) {
    for (const line of lines) {
      if (/Word positions:/i.test(line)) continue;
      const body = stripLineMarker(line);
      if (pass.test(body)) return line;
    }
  }

  if (kind === "any") {
    for (const line of lines) {
      const match = line.match(/^Line\s+(\d+)\s*:\s*(.+)$/i);
      if (match && Number(match[1]) === itemNo) return line;
    }
  }
  return null;
}

function tryAnswerPositionQuestion(question: string, documentContext: string): string | null {
  if (!/(word|character|char|akshar|shabd|position|line|point|q\s*\d|question\s*\d)/i.test(question)) return null;

  const qMatch = question.match(/(?:q|ques|question|qn|point|para(?:graph)?)\s*\.?\s*#?\s*(\d+)/i);
  const lineMatch = question.match(/(?:line|panti|lain)\s*\.?\s*#?\s*(\d+)/i);
  const kind: "q" | "line" | "any" = lineMatch ? "line" : qMatch ? "q" : "any";
  const itemNo = ordinalToNumber(
    lineMatch?.[1] ||
    qMatch?.[1] ||
    question.match(/(\d+)\s*(?:number|no\.?|wale|waale)/i)?.[1],
  );
  const wordNo = ordinalToNumber(
    question.match(/(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*(?:word|shabd)/i)?.[1] ||
    question.match(/(?:word|shabd)\s*(?:number|no\.?|#)?\s*(\d+(?:st|nd|rd|th)?)/i)?.[1],
  );
  const charNo = ordinalToNumber(
    question.match(/(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*(?:character|char|akshar)/i)?.[1] ||
    question.match(/(?:character|char|akshar)\s*(?:number|no\.?|#)?\s*(\d+(?:st|nd|rd|th)?)/i)?.[1],
  );

  if (!itemNo || (!wordNo && !charNo)) return null;
  const label = kind === "line" ? `Line ${itemNo}` : `Q${itemNo}`;
  const matchedLine = findExplicitDocumentLine(documentContext, itemNo, kind);
  if (!matchedLine) {
    return `**Answer not available in documents.**\n\n${label} document ke uploaded content mein exact numbering ke saath nahi mila.\n\n❌ Confidence: Not found`;
  }

  const sourceTag = matchedLine.match(/^Line\s+\d+/i)?.[0] || label;
  const lineText = stripLeadingNumbering(matchedLine);
  const words = lineText.split(/\s+/).filter(Boolean);
  if (wordNo) {
    if (wordNo > words.length) return `> "${matchedLine}"\n\n**That position does not exist — ${label} has only ${words.length} words.**\n\n✅ Confidence: High — exact line found in document\n\n📌 Source: ${sourceTag}`;
    return `> "${matchedLine}"\n\n${label} ka word number ${wordNo}: **"${words[wordNo - 1]}"**\n\n✅ Confidence: High — exact line found in document\n\n📌 Source: ${sourceTag}`;
  }

  const compact = lineText.replace(/\s/g, "");
  if (charNo && charNo > compact.length) return `> "${matchedLine}"\n\n**That position does not exist — ${label} has only ${compact.length} non-space characters.**\n\n✅ Confidence: High — exact line found in document\n\n📌 Source: ${sourceTag}`;
  return `> "${matchedLine}"\n\n${label} ka character number ${charNo}: **"${compact[(charNo || 1) - 1]}"**\n\n✅ Confidence: High — exact line found in document\n\n📌 Source: ${sourceTag}`;
}


function tryAnswerExactValueCount(question: string, documentContext: string): string | null {
  if (!/(count|kitn|total|rating|stars?|frequency|value|rows?|kitne|kitni)/i.test(question)) return null;
  const query = normalizeText(question);
  const queryNumbers = question.match(/\d+(?:\.\d+)?/g) || [];
  const lines = documentContext.split(/\n+/).filter((line) => /:\s*.*=\s*\d+/.test(line));

  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    const column = normalizeText(line.split(":")[0] || "").replace(/^\s*/, "");
    if (column && !query.split(" ").some((term) => term.length > 2 && column.includes(term))) continue;
    const entries = [...line.matchAll(/([^;:|]+?)\s*=\s*(\d+)/g)];
    for (const entry of entries) {
      const value = entry[1].trim();
      const count = entry[2].trim();
      const valueMatches = queryNumbers.some((num) => normalizeText(value) === normalizeText(num) || normalizeText(value).includes(normalizeText(num)));
      if (valueMatches && normalizedLine.includes(normalizeText(value))) {
        return `**Exact count found:** ${value} = **${count}**\n\n*Matched row:* \`${line.trim()}\`\n\n✅ Confidence: High — exact value count is present in the uploaded document.\n\n📌 Source: Exact value counts by column`;
      }
    }
  }
  return null;
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

function findSourceLocation(documentContext: string, numbers: string[]): string | null {
  // Split doc into paragraphs, tracking page + chunk markers if present.
  const paragraphs = documentContext.split(/\n\s*\n/);
  let currentPage: number | null = null;
  let currentChunk: number | null = null;
  const pageRegex = /(?:^|\n)\s*(?:---\s*)?Page\s+(\d+)/i;
  const chunkRegex = /###\s*Chunk\s*#(\d+)/i;
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const pageMatch = para.match(pageRegex);
    if (pageMatch) currentPage = Number(pageMatch[1]);
    const chunkMatch = para.match(chunkRegex);
    if (chunkMatch) currentChunk = Number(chunkMatch[1]);
    for (const number of numbers) {
      const variants = [number, number.replace(/,/g, ""), number.replace(/[^\d.%-]/g, "")].filter(Boolean);
      if (variants.some((v) => para.includes(v))) {
        const parts: string[] = [];
        if (currentChunk !== null) parts.push(`Chunk #${currentChunk}`);
        if (currentPage !== null) parts.push(`Page ${currentPage}`);
        parts.push(`Paragraph ${i + 1}`);
        return parts.join(", ");
      }
    }
  }
  return null;
}

function buildDocumentVerificationNote(answer: string, documentContext: string): string {
  const numbers = extractMeaningfulNumbers(answer);
  if (!numbers.length) return "";
  const verified = numbers.filter((number) => numberAppearsInDocument(number, documentContext));
  const unverified = numbers.filter((number) => !numberAppearsInDocument(number, documentContext));
  const notes: string[] = [];
  const location = findSourceLocation(documentContext, verified);
  if (location && !/📌\s*Source:/i.test(answer)) notes.push(`📌 Source: ${location}`);
  if (unverified.length) notes.push(`⚠️ Could not verify this number in the document: ${unverified.join(", ")}`);
  return notes.length ? `\n\n${notes.join("\n")}` : "";
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// Line-oriented SSE transform. Using pipeThrough (instead of an async start()
// loop that only resolves at the end) keeps delivery truly incremental, so the
// first tokens reach the browser in ~1s instead of after the full answer.
function sseTransform(options: {
  onData: (data: string, emit: (payload: string) => void) => void;
  onFlush?: (emit: (payload: string) => void) => void;
}) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const emit = (payload: string) => controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          const data = line.replace(/^data:\s?/, "").trim();
          if (data) options.onData(data, emit);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    },
    flush(controller) {
      const emit = (payload: string) => controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      const tail = buffer.trim();
      if (tail.startsWith("data:")) {
        const data = tail.replace(/^data:\s?/, "").trim();
        if (data) options.onData(data, emit);
      }
      options.onFlush?.(emit);
      emit("[DONE]");
    },
  });
}

function streamWithDocumentVerification(upstreamBody: ReadableStream<Uint8Array> | null, documentContext: string) {
  if (!upstreamBody) return streamSingleMessage("**AI service returned an empty response.**");
  let answer = "";

  const transform = sseTransform({
    onData: (data, emit) => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
        if (typeof content === "string") answer += content;
      } catch (_) { /* keepalive / noise frame */ }
      emit(data);
    },
    onFlush: (emit) => {
      const note = buildDocumentVerificationNote(answer, documentContext);
      if (note) emit(JSON.stringify({ choices: [{ delta: { content: note } }] }));
    },
  });

  return new Response(upstreamBody.pipeThrough(transform), {
    headers: { ...corsHeaders, ...SSE_HEADERS },
  });
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
    headers: { ...corsHeaders, ...SSE_HEADERS },
  });
}

function geminiDirectModel(id: string): string {
  // Flash across the board: pro adds several seconds of latency without
  // improving grounded, context-based answers.
  switch (id) {
    case "gemini-1.5-pro": return "gemini-2.5-flash";
    case "gemini-2.0-flash": return "gemini-2.5-flash";
    case "gemini-1.5-flash":
    default: return "gemini-2.5-flash";
  }
}


function transformGeminiStream(upstreamBody: ReadableStream<Uint8Array> | null) {
  if (!upstreamBody) return streamSingleMessage("**AI service returned an empty response.**");

  const transform = sseTransform({
    onData: (data, emit) => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const parts = parsed?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (typeof part?.text === "string" && part.text) {
            emit(JSON.stringify({ choices: [{ delta: { content: part.text } }] }));
          }
        }
      } catch (_) { /* keepalive / noise frame */ }
    },
  });

  return new Response(upstreamBody.pipeThrough(transform), {
    headers: { ...corsHeaders, ...SSE_HEADERS },
  });
}


function toGeminiPayload(apiMessages: any[], hasDocContext: boolean) {
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const message of apiMessages) {
    const text = typeof message?.content === "string" ? message.content.trim() : "";
    if (!text) continue;
    if (message.role === "system") {
      systemParts.push({ text });
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  // Latency: disable Gemini "thinking" so the first token arrives in ~1s.
  // Grounded document answers come from the provided context, not from reasoning.
  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
    generationConfig: {
      // Grounded, deterministic answers in document mode.
      temperature: hasDocContext ? 0 : 0.7,
      topP: hasDocContext ? 0 : 0.95,
      topK: hasDocContext ? 1 : 40,
      maxOutputTokens: hasDocContext ? DOCUMENT_OUTPUT_TOKENS : 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },

  };
}


async function callDirectGemini(apiMessages: any[], model: string, hasDocContext: boolean) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("VITE_GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiDirectModel(model)}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toGeminiPayload(apiMessages, hasDocContext)),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Primary AI route is busy." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const t = await response.text();
    console.error("Direct Gemini error:", response.status, t);
    return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return transformGeminiStream(response.body);
}

async function callGatewayChat(apiMessages: any[], model: string, hasDocContext: boolean) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "AI service is temporarily unavailable." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fast models first — slow pro models are not worth the extra seconds.
  const models = hasDocContext
    ? ["google/gemini-3-flash-preview", "google/gemini-2.5-flash"]
    : [geminiGatewayId(model), "google/gemini-3-flash-preview", "google/gemini-2.5-flash"];

  let lastError = "";

  for (const gatewayModel of [...new Set(models)]) {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "edge-function-fetch",
      },
      body: JSON.stringify({
        model: gatewayModel,
        messages: apiMessages,
        temperature: hasDocContext ? 0 : 0.7,
        max_tokens: hasDocContext ? DOCUMENT_OUTPUT_TOKENS : 4096,
        stream: true,
      }),
    });

    if (response.ok) {
      return new Response(response.body, {
        headers: { ...corsHeaders, ...SSE_HEADERS },
      });
    }

    lastError = `${response.status} ${await response.text()}`;
    console.warn(`Gateway chat fallback failed (${gatewayModel}):`, lastError);
  }

  return new Response(JSON.stringify({ error: "AI service is busy right now. Please try again in a moment." }), {
    status: 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Advisory / consultative questions about an uploaded document (e.g. "resume ke
// basis par kitni salary expect karun?"). These need reasoning ON TOP of the
// document facts, so strict "answer not available" grounding must not block them.
function isAdvisoryQuery(message: string): boolean {
  const m = (message || "").toLowerCase();
  return /(salary|package|ctc|lpa|stipend|expect|negotiat|interview|hire|hiring|recruit|resume|cv|cover letter|profile|career|job role|which role|suitable|fit for|eligib|improve|improvement|better|weak(ness)?|strength|suggest|suggestion|advice|advise|recommend|opinion|should i|kitni|kitna|kaise|batao ki|bata do|kya bolu|kya kahu|kya karu|sudhar|behtar|tips|roadmap|strategy|plan|prepare|preparation|chance|scope|worth|review|rate my|score my|compare me|next step)/.test(m);
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
The user's uploaded document is provided as [Context]. Treat it as the ONLY source of truth.

🚨 CRITICAL ANTI-HALLUCINATION RULES — Follow EXACTLY:
1. Answer ONLY from the [Context]. NEVER use outside knowledge. NEVER guess.
2. If the user asks about a SPECIFIC numeric range (e.g. "41-50"), answer ONLY using chunks that contain that EXACT range. NEVER substitute "71+" or any other range as a stand-in.
3. If the document has multiple values for the same category, list ALL of them with their exact labels.
4. If the exact data is NOT in the context, reply EXACTLY: **Maine is document mein yeh data nahi paaya. Document mein jo data hai wo hai:** then list the closest explicit rows/labels actually present in the document.
5. NEVER estimate, round, or invent any number. Quote values verbatim from the chunks.
6. Give DEEP, DETAILED answers — explain thoroughly using every relevant detail from the [Context]. Never truncate. Use as many sections, bullets, tables, and quoted excerpts as needed. Only be short when the user explicitly asks for a one-liner (e.g. "in one word", "just the number").
7. Use Markdown: tables for tabular data, **bold** for key values, bullet lists for enumerations.
8. Preserve the document's wording for key facts and numbers.
9. Match the user's language/script exactly: Hinglish/Roman Hindi must receive Hinglish/Roman Hindi, English must receive English, and other languages must receive the same language.
10. **GRANULAR PRECISION MODE** — When the user asks about a specific position inside the document (e.g. "point no. 5 ka 3rd word", "line 3 ka 2nd character"):
    a. FIRST locate the item by its EXPLICIT numbering in the document. "Point 5" means the line/paragraph that LITERALLY starts with "5.", "5)", "(5)", or "V." — NOT the 5th item you see, NOT point 6, NOT point 4. If you cannot uniquely identify point N by its explicit number in the [Context], reply: **Point N is not clearly identifiable in the retrieved context.** and stop. NEVER substitute a neighboring point.
    b. Quote that entire point VERBATIM on a new line as: > "<the full text of point N exactly as written>" — character-for-character. Do NOT paraphrase or translate.
    c. Tokenize the quoted line EXACTLY — split by whitespace. STRIP the leading numbering token ("5.", "5)", "(5)") before counting, unless the user says "including the number".
    d. Count strictly 1-indexed. Internally enumerate word 1, word 2, word 3... before returning.
    e. Return the EXACT word/character asked, wrapped in **bold** and quotes, e.g. **"laid"**. For a character, also state which word it came from.
    f. If the position or the asked item number does not exist, reply: **Answer not available in documents.**
    g. "Q3" means the item labelled Q3/Q.3/"3." — never the 3rd line, never Q2. "Line 3" means the "Line 3:" marker only.
11. **VERBATIM NUMBER MODE** — When the user asks for a specific value (percentage, rate, count, marks) tied to a specific label/category/range (e.g. "survival rate for 40-50 age group"):
    a. Find the row/cell whose label matches EXACTLY (e.g. "40-50"). Do NOT use the value from "41-50", "30-40", "50-60", or any other row.
    b. Before answering, show the matched row verbatim, e.g. *Matched row: | 40-50 | 74.32% |*
    c. Return the value EXACTLY as written — preserve every digit and decimal (e.g. **74.32%**, never rounded to 40% or 74%).
    d. If no row contains that EXACT label, reply: **Answer not available in documents.** Do NOT substitute a different row.
12. **NO INVENTION / NO WORLD KNOWLEDGE** — Never write any sentence, fact, or biographical/narrative paragraph that is not present in the [Context]. When the user asks "what does the document say about X", quote the actual sentences from the context verbatim (use blockquotes). Do NOT generate new text from outside knowledge, even if you know the topic well. If it is not in the context, reply **Answer not available in documents.**
13. Before final answer, double-check every number against the [Context]. If the number is not visibly present, do not state it as fact.

📌 MANDATORY CITATION FORMAT — Every answer with a factual/numeric claim MUST end with a LOCATION-ONLY citation (NEVER re-quote the answer text; NEVER paste the excerpt again):
\`\`\`
📌 Source: Chunk #<n>, Page <n>, Paragraph <n>
\`\`\`
Use only the fields you can identify from the [Context] markers (e.g. "### Chunk #3" or "Page 4"). Always include Paragraph number (1-indexed within the context). Do NOT include the quoted line — location numbers only.`;
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
    void body?.isPro;
    const hasDocContext = documentContext.trim().length > 0;

    // IMPORTANT: All responses (free & pro) are answered by the same Gemini backend
    // for consistent quality. The user-facing model selector is cosmetic only —
    // pro users can "choose" any model but the backend always serves Gemini.
    void requestedModel;
    let model = FREE_MODEL;
    if (hasDocContext) model = "gemini-1.5-pro";
    if (!GEMINI_MODELS.has(model)) model = FREE_MODEL;


    if (!messages.length) {
      return new Response(JSON.stringify({ error: "Messages are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const latestUserText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
    const advisoryMode = hasDocContext && isAdvisoryQuery(latestUserText);
    const intent = hasDocContext ? "document" : (lastUserMsg ? detectIntent(lastUserMsg.content) : "general");
    const systemPrompt = getSystemPrompt(intent, hasDocContext, advisoryMode);

    const apiMessages: any[] = [{ role: "system", content: systemPrompt }];

    if (hasDocContext) {
      const latestQuestion = latestUserText;
      const deterministicAnswer = advisoryMode
        ? null
        : (tryAnswerPositionQuestion(latestQuestion, documentContext) ||
          tryAnswerExactValueCount(latestQuestion, documentContext));
      if (deterministicAnswer) return streamSingleMessage(deterministicAnswer);


      // For follow-ups like "explain in hindi" or "aur detail do", combine
      // the last few user turns so retrieval reuses prior topic keywords.
      const recentUserTurns = messages
        .filter((m: any) => m?.role === "user" && typeof m?.content === "string")
        .slice(-3)
        .map((m: any) => m.content)
        .join("\n");
      const retrievalQuery = recentUserTurns || latestQuestion;
      const useFullDocument = documentContext.length <= FULL_DOCUMENT_CONTEXT_LIMIT;
      const contextForPrompt = useFullDocument
        ? buildFullDocumentContext(documentContext)
        : buildRetrievedContext(await pickRelevantChunksSemantic(documentContext, retrievalQuery, {
          keywords: getQueryTerms(retrievalQuery),
          expandedQueries: expandQuery(retrievalQuery),
          wantsTable: /table|list|subjects?|papers?|topics?|marks?|syllabus|details?|data|chart|figure/i.test(retrievalQuery),
        }, Deno.env.get("LOVABLE_API_KEY")));


      apiMessages.push({
        role: "system",
        content: `[Context — ${useFullDocument ? "FULL uploaded document text" : "Relevant document excerpts because the full text is very large"}]\n\n${contextForPrompt}\n\n[Instructions]\nAnswer using ONLY the current uploaded document context above. Current upload fully replaces older documents. Never use outside/world knowledge and never invent sentences.\n\nSTRICT GROUNDING: If the requested information is NOT present in the context above, your entire reply must be exactly:\n**Answer not available in documents.**\n(optionally followed by one short line listing the closest labels/rows that ARE present). Never guess, never substitute a nearby item.\n\nNUMBERING RULE: "Q3" / "question 3" means the item labelled Q3 / Q.3 / "3." in the document — NOT the 3rd line and NOT Q2. If the user says "line 3", use the "Line 3:" marker. If the exact asked item number does not exist in the document, reply **Answer not available in documents.** instead of answering a different number.\n\nOther rules: answer deeply, accurately, in the user's language. Tables with \`|\` are real data — read row labels and values verbatim. For numeric/count questions use "Exact value counts by column" and "Numeric statistics by column". For word/character/line-position questions use explicit "Line N" and "Word positions" markers. End with confidence (✅ High / ⚠️ Medium / ❌ Not found) and a location-only citation like "📌 Source: Chunk #3, Page 4, Paragraph 7".`,
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
          max_tokens: hasDocContext ? DOCUMENT_OUTPUT_TOKENS : 4096,
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
        headers: { ...corsHeaders, ...SSE_HEADERS },
      });
    }

    // App plan limits stay controlled per Gmail in user_plans. If the primary
    // Gemini route is temporarily busy, fall back to Lovable AI instead of
    // surfacing a shared provider limit to the user.
    try {
      const directGemini = await callDirectGemini(apiMessages, model, hasDocContext);
      if (directGemini.status === 200) {
        if (hasDocContext && directGemini.body) return streamWithDocumentVerification(directGemini.body, documentContext);
        return directGemini;
      }
      console.warn("Direct Gemini route failed, using gateway fallback:", directGemini.status);
    } catch (err) {
      console.warn("Direct Gemini route unavailable, using gateway fallback:", err);
    }

    const gatewayChat = await callGatewayChat(apiMessages, model, hasDocContext);
    if (gatewayChat.status !== 200) return gatewayChat;
    if (hasDocContext && gatewayChat.body) return streamWithDocumentVerification(gatewayChat.body, documentContext);
    return gatewayChat;
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
