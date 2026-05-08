// User submits a UPI transaction id → inserts payment_requests row.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const txn_id = String(body.txn_id || "").trim();
    if (txn_id.length < 6) return json({ error: "Transaction ID must be at least 6 characters" }, 400);

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing } = await adminClient
      .from("payment_requests")
      .select("id")
      .eq("txn_id", txn_id)
      .maybeSingle();
    if (existing) return json({ error: "This transaction ID was already submitted" }, 409);

    const { error } = await adminClient.from("payment_requests").insert({
      user_id: user.id,
      email: user.email,
      txn_id,
      status: "pending",
    });
    if (error) return json({ error: error.message }, 500);

    return json({ success: true });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
