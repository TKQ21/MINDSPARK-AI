import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearLegacyMindSparkKeys, userScopedKey } from "@/lib/userStorage";

export const QUESTION_LIMIT = 10;
export const IMAGE_LIMIT = 5;

export type PlanStatus = "free" | "pro" | "pending";

export interface UserPlanState {
  userId: string | null;
  plan: "free" | "pro";
  status: PlanStatus;
  tokensUsed: number;
  questionCount: number;
  imageCount: number;
  docCount: number;
  resetAt: number;
  proExpiresAt: number | null;
  loading: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_BASE_KEY = "mindspark_usage";
const PLAN_BASE_KEY = "mindspark_plan";

const defaultState: UserPlanState = {
  userId: null,
  plan: "free",
  status: "free",
  tokensUsed: 0,
  questionCount: 0,
  imageCount: 0,
  docCount: 0,
  resetAt: Date.now() + DAY_MS,
  proExpiresAt: null,
  loading: true,
};

function readCache(userId: string): Partial<UserPlanState> | null {
  try {
    const raw = localStorage.getItem(userScopedKey(USAGE_BASE_KEY, userId) || "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.resetAt || Date.now() >= parsed.resetAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(state: UserPlanState) {
  if (!state.userId) return;
  try {
    const usageKey = userScopedKey(USAGE_BASE_KEY, state.userId);
    const planKey = userScopedKey(PLAN_BASE_KEY, state.userId);
    if (usageKey) {
      localStorage.setItem(usageKey, JSON.stringify({
        questionCount: state.questionCount,
        tokensUsed: state.tokensUsed,
        imageCount: state.imageCount,
        docCount: state.docCount,
        resetAt: state.resetAt,
      }));
    }
    if (planKey) localStorage.setItem(planKey, state.plan);
  } catch {}
}

function mapPlanRow(row: any, pending: boolean, userId: string): UserPlanState {
  const proExpiresAt = row?.pro_expires_at ? new Date(row.pro_expires_at).getTime() : null;
  const isPro = row?.plan === "pro" && !!proExpiresAt && proExpiresAt > Date.now();
  const resetAt = row?.usage_reset_at ? new Date(row.usage_reset_at).getTime() : Date.now() + DAY_MS;

  return {
    userId,
    plan: isPro ? "pro" : "free",
    status: isPro ? "pro" : pending ? "pending" : "free",
    tokensUsed: Number(row?.tokens_used || 0),
    questionCount: Number(row?.question_count || 0),
    imageCount: Number(row?.image_gen_count || 0),
    docCount: Number(row?.doc_upload_count || 0),
    resetAt,
    proExpiresAt,
    loading: false,
  };
}

async function ensurePlanRow(userId: string, email?: string | null) {
  const rpcRes = await (supabase as any).rpc("ensure_current_user_plan");
  if (!rpcRes.error && rpcRes.data) return rpcRes.data;

  const resetAt = new Date(Date.now() + DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("user_plans")
    .insert({
      user_id: userId,
      email,
      plan: "free",
      tokens_used: 0,
      question_count: 0,
      image_gen_count: 0,
      doc_upload_count: 0,
      usage_reset_at: resetAt,
    } as any)
    .select("*")
    .single();

  if (error) {
    const retry = await supabase.from("user_plans").select("*").eq("user_id", userId).maybeSingle();
    if (retry.data) return retry.data;
    throw error;
  }

  return data;
}

export function useUserPlan() {
  const [state, setState] = useState<UserPlanState>(defaultState);

  const loadUserPlan = useCallback(async (knownUserId?: string) => {
    const { data: { user } } = knownUserId
      ? { data: { user: { id: knownUserId } as any } }
      : await supabase.auth.getUser();

    if (!user?.id) {
      setState({ ...defaultState, loading: false });
      return null;
    }

    clearLegacyMindSparkKeys();
    const cached = readCache(user.id);
    if (cached) setState((s) => ({ ...s, ...cached, userId: user.id, loading: true }));

    const [planRes, reqRes] = await Promise.all([
      (supabase as any).rpc("ensure_current_user_plan"),
      supabase
        .from("payment_requests")
        .select("status,submitted_at")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    let row = planRes.data || await ensurePlanRow(user.id, user.email);
    const resetAt = row?.usage_reset_at ? new Date(row.usage_reset_at).getTime() : 0;

    if (Date.now() >= resetAt) {
      const nextResetAt = new Date(Date.now() + DAY_MS).toISOString();
      const resetRes = await supabase
        .from("user_plans")
        .update({
          tokens_used: 0,
          question_count: 0,
          image_gen_count: 0,
          doc_upload_count: 0,
          usage_reset_at: nextResetAt,
        } as any)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (resetRes.data) row = resetRes.data;
    }

    const next = mapPlanRow(row, reqRes.data?.status === "pending", user.id);
    writeCache(next);
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    loadUserPlan();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) loadUserPlan(session.user.id);
      else setState({ ...defaultState, loading: false });
    });

    const timer = setInterval(() => {
      setState((current) => {
        if (!current.userId || Date.now() < current.resetAt) return { ...current };
        void loadUserPlan(current.userId);
        return { ...current, loading: true };
      });
    }, 30_000);

    return () => {
      subscription.unsubscribe();
      clearInterval(timer);
    };
  }, [loadUserPlan]);

  const increment = useCallback(async (field: "question_count" | "image_gen_count" | "doc_upload_count", tokenDelta = 0) => {
    if (!state.userId || state.plan === "pro") return;

    const localNext = { ...state };
    if (field === "question_count") localNext.questionCount += 1;
    if (field === "image_gen_count") localNext.imageCount += 1;
    if (field === "doc_upload_count") localNext.docCount += 1;
    if (field === "question_count") localNext.tokensUsed += Math.max(0, tokenDelta);
    setState(localNext);
    writeCache(localNext);

    const usageKind = field === "question_count" ? "question" : field === "image_gen_count" ? "image" : "doc";
    const { data, error } = await (supabase as any).rpc("increment_current_user_usage", {
      usage_kind: usageKind,
      token_delta: tokenDelta,
    });

    if (!error && data) {
      const synced = mapPlanRow(data, state.status === "pending", state.userId);
      setState(synced);
      writeCache(synced);
    }
  }, [state]);

  const isPro = state.plan === "pro";
  const questionsExceeded = !isPro && state.questionCount >= QUESTION_LIMIT;
  const imagesExceeded = !isPro && state.imageCount >= IMAGE_LIMIT;
  const msLeft = Math.max(0, state.resetAt - Date.now());

  return {
    ...state,
    isPro,
    addQuestion: (tokenDelta = 0) => increment("question_count", tokenDelta),
    addImage: () => increment("image_gen_count"),
    addDoc: () => increment("doc_upload_count"),
    questionsExceeded,
    imagesExceeded,
    hoursLeft: Math.floor(msLeft / 3_600_000),
    minutesLeft: Math.floor((msLeft % 3_600_000) / 60_000),
    questionLimit: QUESTION_LIMIT,
    imageLimit: IMAGE_LIMIT,
    refresh: loadUserPlan,
  };
}