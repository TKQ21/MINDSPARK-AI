// User submits a UPI transaction id + payment screenshot → inserts payment_requests row.
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
    const screenshotDataUrl = String(body.screenshot_dataUrl || "");

    if (txn_id.length < 6) return json({ error: "Transaction ID must be at least 6 characters" }, 400);
    if (!screenshotDataUrl) return json({ error: "Payment screenshot is required as proof" }, 400);

    const m = screenshotDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m) return json({ error: "Invalid screenshot image" }, 400);
    const contentType = m[1];
    const ext = contentType.split("/")[1].split("+")[0];
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bin.length > 5 * 1024 * 1024) return json({ error: "Screenshot too large (max 5MB)" }, 400);

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing } = await adminClient
      .from("payment_requests")
      .select("id")
      .eq("txn_id", txn_id)
      .maybeSingle();
    if (existing) return json({ error: "This transaction ID was already submitted" }, 409);

    // Upload screenshot to public chat-uploads bucket under payment-proofs/ prefix
    const path = `payment-proofs/${user.id}/${Date.now()}-${txn_id}.${ext}`;
    const { error: upErr } = await adminClient.storage
      .from("chat-uploads")
      .upload(path, bin, { contentType, upsert: false });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const { data: pub } = adminClient.storage.from("chat-uploads").getPublicUrl(path);
    const screenshot_url = pub.publicUrl;

    const { error } = await adminClient.from("payment_requests").insert({
      user_id: user.id,
      email: user.email,
      txn_id,
      status: "pending",
      screenshot_url,
    });
    if (error) return json({ error: error.message }, 500);

    return json({ success: true });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
