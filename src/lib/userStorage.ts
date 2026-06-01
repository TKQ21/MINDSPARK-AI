const LEGACY_SHARED_KEYS = [
  "mindspark_usage",
  "mindspark_usage_v1",
  "mindspark_local_usage_v2",
  "mindspark_plan",
  "mindspark_plan_v1",
  "mindspark_selected_model",
];

export function clearLegacyMindSparkKeys() {
  try {
    LEGACY_SHARED_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {}
}

export function userScopedKey(baseKey: string, userId?: string | null) {
  return userId ? `${baseKey}_${userId}` : null;
}

export function clearUserMindSparkCache(userId: string) {
  try {
    [
      "mindspark_usage",
      "mindspark_plan",
      "mindspark_selected_model",
      "mindspark_local_usage_v2",
    ].forEach((base) => localStorage.removeItem(`${base}_${userId}`));
  } catch {}
}