import { useEffect, useState, useCallback } from "react";

const KEY = "mindspark_usage_v1";
const PLAN_KEY = "mindspark_plan_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

export const TOKEN_BUDGET = 32000;
export const IMAGE_LIMIT = 5;
export const DOC_LIMIT = 3;

export type Plan = "free" | "pro";

interface Usage {
  tokens: number;
  images: number;
  docs: number;
  resetAt: number; // timestamp ms
}

function load(): Usage {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const u = JSON.parse(raw) as Usage;
      if (Date.now() < u.resetAt) return u;
    }
  } catch {}
  return { tokens: 0, images: 0, docs: 0, resetAt: Date.now() + DAY_MS };
}

function save(u: Usage) {
  try { localStorage.setItem(KEY, JSON.stringify(u)); } catch {}
}

function loadPlan(): Plan {
  try { return (localStorage.getItem(PLAN_KEY) as Plan) || "free"; } catch { return "free"; }
}

export function useTokenUsage() {
  const [usage, setUsage] = useState<Usage>(load);
  const [plan, setPlanState] = useState<Plan>(loadPlan);

  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() >= usage.resetAt) {
        const fresh = { tokens: 0, images: 0, docs: 0, resetAt: Date.now() + DAY_MS };
        setUsage(fresh); save(fresh);
      } else {
        setUsage((u) => ({ ...u })); // re-tick countdown
      }
    }, 30000);
    return () => clearInterval(t);
  }, [usage.resetAt]);

  const addTokens = useCallback((n: number) => {
    setUsage((u) => { const next = { ...u, tokens: u.tokens + n }; save(next); return next; });
  }, []);
  const addImage = useCallback(() => {
    setUsage((u) => { const next = { ...u, images: u.images + 1 }; save(next); return next; });
  }, []);
  const addDoc = useCallback(() => {
    setUsage((u) => { const next = { ...u, docs: u.docs + 1 }; save(next); return next; });
  }, []);

  const setPlan = useCallback((p: Plan) => {
    setPlanState(p);
    try { localStorage.setItem(PLAN_KEY, p); } catch {}
  }, []);

  const isPro = plan === "pro";
  const tokensExceeded = !isPro && usage.tokens >= TOKEN_BUDGET;
  const imagesExceeded = !isPro && usage.images >= IMAGE_LIMIT;
  const docsExceeded = !isPro && usage.docs >= DOC_LIMIT;

  const msLeft = Math.max(0, usage.resetAt - Date.now());
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const minutesLeft = Math.floor((msLeft % 3_600_000) / 60_000);

  return {
    usage, plan, isPro, setPlan,
    addTokens, addImage, addDoc,
    tokensExceeded, imagesExceeded, docsExceeded,
    hoursLeft, minutesLeft,
    tokenBudget: TOKEN_BUDGET, imageLimit: IMAGE_LIMIT, docLimit: DOC_LIMIT,
  };
}
