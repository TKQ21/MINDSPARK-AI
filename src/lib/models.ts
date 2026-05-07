export type ModelId =
  | "gemini-1.5-flash"
  | "gemini-2.0-flash"
  | "gemini-1.5-pro"
  | "llama-3.3-70b-versatile"
  | "llama-3.1-8b-instant"
  | "mixtral-8x7b-32768"
  | "gemma2-9b-it";

export interface ModelMeta {
  id: ModelId;
  label: string;
  emoji: string;
  description: string;
  group: "Google Gemini" | "Meta via Groq" | "Mistral & Others";
  pro: boolean;
}

export const FREE_MODEL: ModelId = "gemini-1.5-flash";

export const MODELS: ModelMeta[] = [
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", emoji: "✨", description: "Fast & efficient", group: "Google Gemini", pro: false },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", emoji: "⚡", description: "Fastest, multimodal", group: "Google Gemini", pro: true },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", emoji: "🧠", description: "Best for long docs & PDFs", group: "Google Gemini", pro: true },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", emoji: "🦙", description: "Smart reasoning & code", group: "Meta via Groq", pro: true },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", emoji: "⚡", description: "Ultra fast responses", group: "Meta via Groq", pro: true },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", emoji: "🌊", description: "Balanced performance", group: "Mistral & Others", pro: true },
  { id: "gemma2-9b-it", label: "Gemma 2 9B", emoji: "💎", description: "Google open model", group: "Mistral & Others", pro: true },
];

export const STORAGE_KEY = "mindspark_selected_model";

export function loadSelectedModel(): ModelId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ModelId | null;
    if (v && MODELS.some((m) => m.id === v)) return v;
  } catch {}
  return FREE_MODEL;
}

export function saveSelectedModel(id: ModelId) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
}

export function resolveModel(id: ModelId, isPro: boolean): ModelId {
  const meta = MODELS.find((m) => m.id === id);
  if (!meta) return FREE_MODEL;
  if (meta.pro && !isPro) return FREE_MODEL;
  return id;
}
