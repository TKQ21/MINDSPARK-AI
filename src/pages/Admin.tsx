import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lock, Shield, CheckCircle, XCircle, Upload, KeyRound, Settings as SettingsIcon, Inbox, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const ADMIN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(action: string, payload: any = {}) {
  const res = await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

interface PaymentRequest {
  id: string;
  email: string | null;
  txn_id: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  screenshot_url: string | null;
}

interface Settings { upi_id: string; qr_code_url: string; pro_price: number; hasPassword: boolean; }

const Admin: React.FC = () => {
  const [bootChecked, setBootChecked] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("admin_authed") === "true");
  const [passwordHash, setPasswordHash] = useState<string>(() => sessionStorage.getItem("admin_pw_hash") || "");
  const [tab, setTab] = useState<"requests" | "settings" | "password">("requests");

  useEffect(() => {
    api("status").then((s) => {
      setHasPassword(!!s.hasPassword);
      setBootChecked(true);
    }).catch(() => setBootChecked(true));
  }, []);

  if (!bootChecked) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0d1117] text-slate-300">Loading…</div>;
  }

  if (!hasPassword) return <SetupScreen onDone={(hash) => { setHasPassword(true); setPasswordHash(hash); setAuthed(true); sessionStorage.setItem("admin_authed", "true"); sessionStorage.setItem("admin_pw_hash", hash); }} />;
  if (!authed) return <LoginScreen onAuthed={(hash) => { setAuthed(true); setPasswordHash(hash); sessionStorage.setItem("admin_authed", "true"); sessionStorage.setItem("admin_pw_hash", hash); }} />;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <header className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-semibold">MindSpark Admin</h1>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem("admin_authed"); sessionStorage.removeItem("admin_pw_hash"); setAuthed(false); }}
          className="text-xs text-slate-400 hover:text-white"
        >
          Sign out
        </button>
      </header>

      <div className="flex gap-1 border-b border-[#30363d] px-6">
        {[
          { k: "requests", label: "Payment Requests", icon: Inbox },
          { k: "settings", label: "QR & Settings", icon: SettingsIcon },
          { k: "password", label: "Change Password", icon: KeyRound },
        ].map((t: any) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
              tab === t.k ? "border-blue-400 text-white" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      <main className="p-6 max-w-5xl mx-auto">
        {tab === "requests" && <RequestsTab passwordHash={passwordHash} />}
        {tab === "settings" && <SettingsTab passwordHash={passwordHash} />}
        {tab === "password" && <PasswordTab passwordHash={passwordHash} onChanged={(h) => { setPasswordHash(h); sessionStorage.setItem("admin_pw_hash", h); }} />}
      </main>
    </div>
  );
};

/* ---------- Setup ---------- */
const SetupScreen: React.FC<{ onDone: (hash: string) => void }> = ({ onDone }) => {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const hash = await sha256Hex(pw);
      await api("setup-password", { newPasswordHash: hash });
      toast.success("Admin password set");
      onDone(hash);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-2xl border border-[#30363d] bg-[#161b22] p-7">
        <div className="flex items-center gap-2 mb-1"><Shield className="w-5 h-5 text-blue-400" /><h2 className="text-xl font-semibold text-white">Welcome, set your admin password</h2></div>
        <p className="text-sm text-slate-400 mb-5">This password protects your admin panel. Keep it safe — it cannot be recovered.</p>
        <input type="password" placeholder="New password (min 8 chars)" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full mb-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-400" />
        <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="w-full mb-4 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-400" />
        <button disabled={busy} onClick={submit} className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">{busy ? "Saving…" : "Set Password & Enter"}</button>
      </motion.div>
    </div>
  );
};

/* ---------- Login ---------- */
const LoginScreen: React.FC<{ onAuthed: (hash: string) => void }> = ({ onAuthed }) => {
  const [pw, setPw] = useState("");
  const [shake, setShake] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const hash = await sha256Hex(pw);
      const r = await api("verify", { passwordHash: hash });
      if (r.success) onAuthed(hash);
      else { setShake(true); toast.error("Incorrect password"); setTimeout(() => setShake(false), 500); }
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
      <motion.div animate={shake ? { x: [-8, 8, -6, 6, -3, 3, 0] } : {}} transition={{ duration: 0.4 }} className="w-full max-w-sm rounded-2xl border border-[#30363d] bg-[#161b22] p-7">
        <div className="flex items-center gap-2 mb-5"><Lock className="w-5 h-5 text-blue-400" /><h2 className="text-lg font-semibold text-white">MindSpark Admin</h2></div>
        <label className="text-xs text-slate-400 mb-1 block">Password</label>
        <div className="relative mb-4">
          <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 pr-10 text-sm text-white outline-none focus:border-blue-400" />
          <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
        </div>
        <button disabled={busy || !pw} onClick={submit} className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">{busy ? "Checking…" : "Enter Admin Panel"}</button>
      </motion.div>
    </div>
  );
};

/* ---------- Requests Tab ---------- */
const RequestsTab: React.FC<{ passwordHash: string }> = ({ passwordHash }) => {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { requests } = await api("list-requests", { passwordHash });
      setRequests(requests);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const review = async (id: string, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !confirm("Reject this payment request?")) return;
    try {
      await api("review-request", { passwordHash, id, decision });
      toast.success(decision === "approved" ? "User upgraded to Pro" : "Request rejected");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs capitalize border ${filter === f ? "bg-blue-500/20 border-blue-400/50 text-blue-200" : "bg-[#161b22] border-[#30363d] text-slate-400 hover:text-white"}`}>
              {f}{f === "pending" && pendingCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold">{pendingCount}</span>}
            </button>
          ))}
        </div>
        <button onClick={load} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className="rounded-xl border border-[#30363d] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#161b22] text-slate-400 text-xs uppercase">
            <tr><th className="text-left p-3">Email</th><th className="text-left p-3">Transaction ID</th><th className="text-center p-3">Proof</th><th className="text-left p-3">Submitted</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">No requests</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-t border-[#30363d]">
                <td className="p-3 text-slate-200">{r.email || "—"}</td>
                <td className="p-3 font-mono text-blue-300">{r.txn_id}</td>
                <td className="p-3 text-slate-400">{new Date(r.submitted_at).toLocaleString()}</td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${
                    r.status === "pending" ? "bg-amber-500/20 text-amber-300" :
                    r.status === "approved" ? "bg-emerald-500/20 text-emerald-300" :
                    "bg-rose-500/20 text-rose-300"
                  }`}>{r.status}</span>
                </td>
                <td className="p-3 text-center">
                  {r.status === "pending" ? (
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => review(r.id, "approved")} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Approve</button>
                      <button onClick={() => review(r.id, "rejected")} className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Reject</button>
                    </div>
                  ) : <span className="text-slate-500 text-xs">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------- Settings Tab ---------- */
const SettingsTab: React.FC<{ passwordHash: string }> = ({ passwordHash }) => {
  const [s, setS] = useState<Settings>({ upi_id: "", qr_code_url: "", pro_price: 200, hasPassword: true });
  const [upi, setUpi] = useState("");
  const [price, setPrice] = useState(200);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await api("status");
    setS(r); setUpi(r.upi_id || ""); setPrice(r.pro_price || 200);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api("update-settings", { passwordHash, upi_id: upi, pro_price: Number(price) });
      toast.success("Settings saved");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error("Max 2MB");
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      await api("upload-qr", { passwordHash, dataUrl });
      toast.success("QR code updated");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h3 className="text-sm font-semibold mb-4">💳 Payment Settings</h3>
        <label className="text-xs text-slate-400 block mb-1">UPI ID</label>
        <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourupi@bank" className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-400 mb-3" />
        <label className="text-xs text-slate-400 block mb-1">Pro Plan Price (₹)</label>
        <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-400 mb-4" />
        <button disabled={busy} onClick={save} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">Save Settings</button>
      </div>

      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h3 className="text-sm font-semibold mb-4">📱 UPI QR Code Image</h3>
        <div className="rounded-lg border border-[#30363d] bg-[#0d1117] aspect-square flex items-center justify-center mb-3 overflow-hidden">
          {s.qr_code_url ? (
            <img src={s.qr_code_url} alt="QR" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-xs text-slate-500">No QR uploaded</span>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button disabled={busy} onClick={() => fileRef.current?.click()} className="w-full py-2 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-blue-400 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50">
          <Upload className="w-4 h-4" /> Upload new QR (PNG/JPG, max 2MB)
        </button>
      </div>
    </div>
  );
};

/* ---------- Password Tab ---------- */
const PasswordTab: React.FC<{ passwordHash: string; onChanged: (h: string) => void }> = ({ passwordHash, onChanged }) => {
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (n1.length < 8) return toast.error("New password must be at least 8 chars");
    if (n1 !== n2) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const curHash = await sha256Hex(cur);
      if (curHash !== passwordHash) { toast.error("Current password is incorrect"); setBusy(false); return; }
      const newHash = await sha256Hex(n1);
      await api("change-password", { passwordHash: curHash, newPasswordHash: newHash });
      toast.success("Password updated");
      onChanged(newHash);
      setCur(""); setN1(""); setN2("");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const strength = n1.length >= 12 ? "Strong" : n1.length >= 8 ? "OK" : "Weak";
  const sColor = strength === "Strong" ? "text-emerald-400" : strength === "OK" ? "text-amber-400" : "text-rose-400";

  return (
    <div className="max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Change Admin Password</h3>
      <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-400 mb-3" />
      <input type="password" placeholder="New password" value={n1} onChange={(e) => setN1(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-400 mb-1" />
      {n1 && <p className={`text-[10px] mb-2 ${sColor}`}>Strength: {strength}</p>}
      <input type="password" placeholder="Confirm new password" value={n2} onChange={(e) => setN2(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-400 mb-4" />
      <button disabled={busy} onClick={submit} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">Update Password</button>
    </div>
  );
};

export default Admin;
