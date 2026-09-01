// Admin operations endpoint. Uses a shared SHA-256 password hash stored in admin_settings.
// All actions require the client to send the hex sha256 of the password.
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

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSettings() {
  const { data } = await admin().from("admin_settings").select("*").eq("id", 1).maybeSingle();
  return data;
}

async function verifyPassword(passwordHash: string): Promise<boolean> {
  const s = await getSettings();
  if (!s?.admin_password_hash) return false;
  return s.admin_password_hash === passwordHash;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "status") {
      const s = await getSettings();
      return json({
        hasPassword: !!s?.admin_password_hash,
        upi_id: s?.upi_id || "",
        qr_code_url: s?.qr_code_url || "",
        pro_price: s?.pro_price || 200,
      });
    }

    if (action === "setup-password") {
      // Only allowed if no password set yet
      const s = await getSettings();
      if (s?.admin_password_hash) return json({ error: "Password already set" }, 400);
      const newHash = String(body.newPasswordHash || "");
      if (newHash.length !== 64) return json({ error: "Invalid hash" }, 400);
      await admin().from("admin_settings").update({ admin_password_hash: newHash }).eq("id", 1);
      return json({ success: true });
    }

    if (action === "verify") {
      const ok = await verifyPassword(String(body.passwordHash || ""));
      return json({ success: ok });
    }

    // All actions below require a valid password hash
    if (!(await verifyPassword(String(body.passwordHash || "")))) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (action === "change-password") {
      const newHash = String(body.newPasswordHash || "");
      if (newHash.length !== 64) return json({ error: "Invalid hash" }, 400);
      await admin().from("admin_settings").update({ admin_password_hash: newHash }).eq("id", 1);
      return json({ success: true });
    }

    if (action === "update-settings") {
      const updates: any = {};
      if (typeof body.upi_id === "string") updates.upi_id = body.upi_id;
      if (typeof body.pro_price === "number") updates.pro_price = body.pro_price;
      if (Object.keys(updates).length === 0) return json({ error: "Nothing to update" }, 400);
      await admin().from("admin_settings").update(updates).eq("id", 1);
      return json({ success: true });
    }

    if (action === "upload-qr") {
      const dataUrl = String(body.dataUrl || "");
      const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!m) return json({ error: "Invalid image data" }, 400);
      const contentType = m[1];
      const ext = contentType.split("/")[1].split("+")[0];
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bin.length > 2 * 1024 * 1024) return json({ error: "File too large (max 2MB)" }, 400);
      const path = `qr-code-${Date.now()}.${ext}`;
      const { error: upErr } = await admin().storage.from("qr-codes").upload(path, bin, {
        contentType,
        upsert: true,
      });
      if (upErr) return json({ error: upErr.message }, 500);
      const { data: pub } = admin().storage.from("qr-codes").getPublicUrl(path);
      await admin().from("admin_settings").update({ qr_code_url: pub.publicUrl }).eq("id", 1);
      return json({ success: true, url: pub.publicUrl });
    }

    if (action === "list-users") {
      const db = admin();
      const users: any[] = [];
      let page = 1;
      while (page <= 20) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        users.push(...(data?.users || []));
        if (!data?.users || data.users.length < 200) break;
        page++;
      }

      const [{ data: plans }, { data: convos }] = await Promise.all([
        db.from("user_plans").select("*"),
        db.from("conversations").select("id,user_id"),
      ]);

      const convoOwner = new Map<string, string>();
      (convos || []).forEach((c: any) => convoOwner.set(c.id, c.user_id));

      const queryCounts = new Map<string, number>();
      const lastQueryAt = new Map<string, string>();
      const convoIds = (convos || []).map((c: any) => c.id);
      for (let i = 0; i < convoIds.length; i += 100) {
        const slice = convoIds.slice(i, i + 100);
        if (!slice.length) break;
        const { data: msgs } = await db
          .from("messages")
          .select("conversation_id,created_at")
          .eq("role", "user")
          .in("conversation_id", slice);
        (msgs || []).forEach((m: any) => {
          const uid = convoOwner.get(m.conversation_id);
          if (!uid) return;
          queryCounts.set(uid, (queryCounts.get(uid) || 0) + 1);
          const prev = lastQueryAt.get(uid);
          if (!prev || m.created_at > prev) lastQueryAt.set(uid, m.created_at);
        });
      }

      const planByUser = new Map<string, any>();
      (plans || []).forEach((p: any) => planByUser.set(p.user_id, p));
      const now = Date.now();

      const rows = users.map((u) => {
        const p = planByUser.get(u.id);
        const expires = p?.pro_expires_at ? new Date(p.pro_expires_at).getTime() : null;
        const isPro = p?.plan === "pro" && !!expires && expires > now;
        return {
          user_id: u.id,
          email: u.email || p?.email || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          plan: isPro ? "pro" : "free",
          pro_expires_at: p?.pro_expires_at || null,
          question_count: p?.question_count ?? 0,
          image_gen_count: p?.image_gen_count ?? 0,
          usage_reset_at: p?.usage_reset_at || null,
          total_queries: queryCounts.get(u.id) || 0,
          last_query_at: lastQueryAt.get(u.id) || null,
        };
      }).sort((a, b) => String(b.last_sign_in_at || "").localeCompare(String(a.last_sign_in_at || "")));

      return json({
        users: rows,
        totals: {
          users: rows.length,
          pro: rows.filter((r) => r.plan === "pro").length,
          free: rows.filter((r) => r.plan === "free").length,
          queries: rows.reduce((s, r) => s + r.total_queries, 0),
        },
      });
    }

    if (action === "user-queries") {
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "userId required" }, 400);
      const db = admin();
      const { data: convos } = await db.from("conversations").select("id,title").eq("user_id", userId);
      const ids = (convos || []).map((c: any) => c.id);
      if (!ids.length) return json({ queries: [] });
      const titleById = new Map<string, string>();
      (convos || []).forEach((c: any) => titleById.set(c.id, c.title));
      const { data: msgs } = await db
        .from("messages")
        .select("id,conversation_id,content,file_name,created_at")
        .eq("role", "user")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      return json({
        queries: (msgs || []).map((m: any) => ({
          id: m.id,
          content: m.content,
          file_name: m.file_name,
          created_at: m.created_at,
          chat_title: titleById.get(m.conversation_id) || "Chat",
        })),
      });
    }

    if (action === "list-requests") {
      const { data } = await admin()
        .from("payment_requests")
        .select("*")
        .order("submitted_at", { ascending: false });
      return json({ requests: data || [] });
    }


    if (action === "review-request") {
      const id = String(body.id || "");
      const decision = String(body.decision || ""); // 'approved' | 'rejected'
      if (!id || !["approved", "rejected"].includes(decision)) {
        return json({ error: "Invalid input" }, 400);
      }
      const { data: pr } = await admin()
        .from("payment_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!pr) return json({ error: "Not found" }, 404);

      await admin()
        .from("payment_requests")
        .update({ status: decision, reviewed_at: new Date().toISOString() })
        .eq("id", id);

      if (decision === "approved") {
        const now = new Date();

        // Pro must run a full 30 calendar days INCLUDING the purchase day, so it
        // never expires early even if the payment was made just before midnight.
        // Base = existing unexpired expiry (stacking), else today (IST day start).
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const { data: existing } = await admin()
          .from("user_plans")
          .select("pro_expires_at")
          .eq("user_id", pr.user_id)
          .maybeSingle();

        const existingExpiry = existing?.pro_expires_at ? new Date(existing.pro_expires_at) : null;
        let expires: Date;
        if (existingExpiry && existingExpiry.getTime() > now.getTime()) {
          expires = new Date(existingExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);
        } else {
          const istNow = new Date(now.getTime() + IST_OFFSET_MS);
          const istDayStart = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
          // 30 full days including today → end of the 30th day (IST).
          expires = new Date(istDayStart - IST_OFFSET_MS + 30 * 24 * 60 * 60 * 1000 - 1000);
        }

        await admin()
          .from("user_plans")
          .upsert(
            {
              user_id: pr.user_id,
              email: pr.email,
              plan: "pro",
              pro_activated_at: now.toISOString(),
              pro_expires_at: expires.toISOString(),
            },
            { onConflict: "user_id" }
          );
      }

      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
