import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearLegacyMindSparkKeys, userScopedKey } from "@/lib/userStorage";

const KEY = "mindspark_usage";
const PLAN_KEY = "mindspark_plan";
const DAY_MS = 24 * 60 * 60 * 1000;

export const TOKEN_BUDGET = 32000;
export const IMAGE_LIMIT = 5;

export type Plan = "free" | "pro";

interface Usage {
  tokens: number;
  images: number;
  docs: number;
  resetAt: number; // timestamp ms
}

function load(userId: string | null): Usage {
  try {
    const key = userScopedKey(KEY, userId);
    const raw = key ? localStorage.getItem(key) : null;
    if (raw) {
      const u = JSON.parse(raw) as Usage;
      if (Date.now() < u.resetAt) return u;
    }
  } catch {}
  return { tokens: 0, images: 0, docs: 0, resetAt: Date.now() + DAY_MS };
}

function save(u: Usage, userId: string | null) {
  try {
    const key = userScopedKey(KEY, userId);
    if (key) localStorage.setItem(key, JSON.stringify(u));
  } catch {}
}

function loadPlan(userId: string | null): Plan {
  try {
    const key = userScopedKey(PLAN_KEY, userId);
    return ((key ? localStorage.getItem(key) : null) as Plan) || "free";
  } catch { return "free"; }
}

export function useTokenUsage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>(() => load(null));
  const [plan, setPlanState] = useState<Plan>(() => loadPlan(null));

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      clearLegacyMindSparkKeys();
      setUserId(user?.id ?? null);
      setUsage(load(user?.id ?? null));
      setPlanState(loadPlan(user?.id ?? null));
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() >= usage.resetAt) {
        const fresh = { tokens: 0, images: 0, docs: 0, resetAt: Date.now() + DAY_MS };
        setUsage(fresh); save(fresh, userId);
      } else {
        setUsage((u) => ({ ...u })); // re-tick countdown
      }
    }, 30000);
    return () => clearInterval(t);
  }, [usage.resetAt, userId]);

  const addTokens = useCallback((n: number) => {
    setUsage((u) => { const next = { ...u, tokens: u.tokens + n }; save(next, userId); return next; });
  }, [userId]);
  const addImage = useCallback(() => {
    setUsage((u) => { const next = { ...u, images: u.images + 1 }; save(next, userId); return next; });
  }, [userId]);
  const addDoc = useCallback(() => {
    setUsage((u) => { const next = { ...u, docs: u.docs + 1 }; save(next, userId); return next; });
  }, [userId]);

  const setPlan = useCallback((p: Plan) => {
    setPlanState(p);
    try {
      const key = userScopedKey(PLAN_KEY, userId);
      if (key) localStorage.setItem(key, p);
    } catch {}
  }, [userId]);

  const isPro = plan === "pro";
  const tokensExceeded = !isPro && usage.tokens >= TOKEN_BUDGET;
  const imagesExceeded = !isPro && usage.images >= IMAGE_LIMIT;

  const msLeft = Math.max(0, usage.resetAt - Date.now());
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const minutesLeft = Math.floor((msLeft % 3_600_000) / 60_000);

  return {
    usage, plan, isPro, setPlan,
    addTokens, addImage, addDoc,
    tokensExceeded, imagesExceeded,
    hoursLeft, minutesLeft,
    tokenBudget: TOKEN_BUDGET, imageLimit: IMAGE_LIMIT,
  };
}
