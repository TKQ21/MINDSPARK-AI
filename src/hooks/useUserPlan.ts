import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const QUESTION_LIMIT = 10;
export const IMAGE_LIMIT = 5;
export const DOC_LIMIT = 3;

export type PlanStatus = "free" | "pro" | "pending";

export interface UserPlanState {
  plan: "free" | "pro";
  status: PlanStatus; // includes 'pending' if there's a pending payment request
  questionCount: number;
  imageCount: number;
  docCount: number;
  resetAt: number; // ms
  proExpiresAt: number | null;
  loading: boolean;
}

const FALLBACK_KEY = "mindspark_local_usage_v2";

function loadFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (Date.now() < u.resetAt) return u;
    }
  } catch {}
  return {
    questionCount: 0,
    imageCount: 0,
    docCount: 0,
    resetAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}
function saveFallback(u: any) {
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(u)); } catch {}
}

export function useUserPlan() {
  const [state, setState] = useState<UserPlanState>(() => {
    const f = loadFallback();
    return {
      plan: "free",
      status: "free",
      questionCount: f.questionCount,
      imageCount: f.imageCount,
      docCount: f.docCount,
      resetAt: f.resetAt,
      proExpiresAt: null,
      loading: true,
    };
  });

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setState((s) => ({ ...s, loading: false })); return; }

    const [planRes, reqRes] = await Promise.all([
      supabase.from("user_plans").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("payment_requests")
        .select("status,submitted_at")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    let row = planRes.data as any;
    if (!row) {
      // create default
      await supabase.from("user_plans").insert({ user_id: user.id, email: user.email });
      const r = await supabase.from("user_plans").select("*").eq("user_id", user.id).maybeSingle();
      row = r.data;
    }
    const proExpires = row?.pro_expires_at ? new Date(row.pro_expires_at).getTime() : null;
    const isProActive = row?.plan === "pro" && proExpires && proExpires > Date.now();

    let status: PlanStatus = isProActive ? "pro" : "free";
    if (!isProActive && reqRes.data?.status === "pending") status = "pending";

    const resetAt = row?.usage_reset_at ? new Date(row.usage_reset_at).getTime() : Date.now() + 24 * 3600 * 1000;
    const f = loadFallback();

    setState({
      plan: isProActive ? "pro" : "free",
      status,
      questionCount: f.questionCount,
      imageCount: f.imageCount,
      docCount: f.docCount,
      resetAt: Math.min(resetAt, f.resetAt),
      proExpiresAt: proExpires,
      loading: false,
    });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      setState((s) => {
        if (Date.now() >= s.resetAt) {
          const fresh = { questionCount: 0, imageCount: 0, docCount: 0, resetAt: Date.now() + 24 * 3600 * 1000 };
          saveFallback(fresh);
          return { ...s, ...fresh };
        }
        return { ...s };
      });
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const persistCounters = useCallback((next: Partial<UserPlanState>) => {
    setState((s) => {
      const merged = { ...s, ...next };
      saveFallback({
        questionCount: merged.questionCount,
        imageCount: merged.imageCount,
        docCount: merged.docCount,
        resetAt: merged.resetAt,
      });
      return merged;
    });
  }, []);

  const isPro = state.plan === "pro";

  const addQuestion = () => persistCounters({ questionCount: state.questionCount + 1 });
  const addImage = () => persistCounters({ imageCount: state.imageCount + 1 });
  const addDoc = () => persistCounters({ docCount: state.docCount + 1 });

  const questionsExceeded = !isPro && state.questionCount >= QUESTION_LIMIT;
  const imagesExceeded = !isPro && state.imageCount >= IMAGE_LIMIT;
  const docsExceeded = !isPro && state.docCount >= DOC_LIMIT;

  const msLeft = Math.max(0, state.resetAt - Date.now());
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const minutesLeft = Math.floor((msLeft % 3_600_000) / 60_000);

  return {
    ...state,
    isPro,
    addQuestion, addImage, addDoc,
    questionsExceeded, imagesExceeded, docsExceeded,
    hoursLeft, minutesLeft,
    questionLimit: QUESTION_LIMIT, imageLimit: IMAGE_LIMIT, docLimit: DOC_LIMIT,
    refresh,
  };
}
