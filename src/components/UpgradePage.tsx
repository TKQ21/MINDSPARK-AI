import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Sparkles, Zap, ArrowLeft, X, Clock, Copy, Upload, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  isPro: boolean;
  status: "free" | "pro" | "pending";
  onBack: () => void;
  onSubmitted?: () => void;
}

const freeFeatures = [
  "10 questions / day",
  "5 image generations / day",
  "3 document uploads / day",
  "Gemini 1.5 Flash only",
  "Standard response speed",
];

const proFeatures = [
  "Unlimited questions & messages",
  "Unlimited image generations",
  "Unlimited document uploads",
  "All 7 AI models (Gemini, Llama, Mixtral, Gemma)",
  "Priority response speed",
  "Advanced Insights panel",
  "Pro badge & support",
];

const SUBMIT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-payment`;

const UpgradePage: React.FC<Props> = ({ isPro, status, onBack, onSubmitted }) => {
  const [showPay, setShowPay] = useState(false);
  const [settings, setSettings] = useState<{ qr_code_url: string | null; upi_id: string | null; pro_price: number }>({ qr_code_url: null, upi_id: null, pro_price: 200 });
  const [txn, setTxn] = useState("");
  const [busy, setBusy] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("admin_settings").select("qr_code_url, upi_id, pro_price").eq("id", 1).maybeSingle()
      .then(({ data }) => { if (data) setSettings(data as any); });
  }, []);

  const onPickFile = (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Please upload an image (PNG/JPG)");
    if (file.size > 5 * 1024 * 1024) return toast.error("Screenshot too large (max 5MB)");
    const fr = new FileReader();
    fr.onload = () => { setScreenshot(fr.result as string); setScreenshotName(file.name); };
    fr.onerror = () => toast.error("Could not read file");
    fr.readAsDataURL(file);
  };

  const submit = async () => {
    if (txn.trim().length < 6) return toast.error("Enter a valid transaction ID (min 6 chars)");
    if (!screenshot) return toast.error("Please upload your payment screenshot as proof");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ txn_id: txn.trim(), screenshot_dataUrl: screenshot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      toast.success("✓ Payment submitted with proof! Pro will be activated within 2-4 hours.");
      setShowPay(false); setTxn(""); setScreenshot(null); setScreenshotName("");
      onSubmitted?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8">
      <div className="max-w-5xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to chat
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.2em] text-blue-300/80 mb-3">
            <Sparkles className="w-3 h-3" /> MindSpark Pro
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">Upgrade to MindSpark Pro</h1>
          <p className="text-slate-400 mt-2 text-sm">Unlimited access for ₹{settings.pro_price}/month</p>
        </motion.div>

        {status === "pending" && (
          <div className="mb-6 rounded-xl p-4 bg-amber-500/10 border border-amber-400/30 text-amber-200 text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" /> Your payment is being verified. Pro will be activated within 2-4 hours.
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-5">
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl p-6 border border-white/10 bg-white/[0.03]">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold text-white">Free</h3>
              {!isPro && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300 border border-slate-400/20">Current Plan</span>}
            </div>
            <div className="flex items-baseline gap-1 mb-5"><span className="text-3xl font-bold text-white">₹0</span><span className="text-sm text-slate-400">/ month</span></div>
            <ul className="space-y-2.5 mb-6">
              {freeFeatures.map((f) => <li key={f} className="flex items-start gap-2 text-[13px] text-slate-300"><Check className="w-4 h-4 text-slate-500 mt-0.5" /> {f}</li>)}
            </ul>
            <button disabled className="w-full py-2.5 rounded-xl text-[13px] font-medium text-slate-500 bg-white/[0.03] border border-white/5 cursor-not-allowed">{isPro ? "Free Plan" : "Current Plan"}</button>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="relative rounded-2xl p-6 border-2 border-blue-400/40 bg-gradient-to-br from-blue-600/15 via-blue-500/5 to-cyan-500/5 shadow-[0_20px_60px_-20px_rgba(37,99,235,0.5)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white shadow-lg">MOST POPULAR</div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold text-white flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-blue-300" /> Pro</h3>
              {isPro && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/20">Active</span>}
            </div>
            <div className="flex items-baseline gap-1 mb-5"><span className="text-3xl font-bold text-white">₹{settings.pro_price}</span><span className="text-sm text-slate-400">/ month</span></div>
            <ul className="space-y-2.5 mb-6">
              {proFeatures.map((f) => <li key={f} className="flex items-start gap-2 text-[13px] text-slate-200"><Check className="w-4 h-4 text-blue-300 mt-0.5" /> {f}</li>)}
            </ul>
            <button onClick={() => setShowPay(true)} disabled={isPro || status === "pending"} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_8px_24px_-8px_rgba(37,99,235,0.7)] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {isPro ? "You're on Pro" : status === "pending" ? <><Clock className="w-3.5 h-3.5" /> Verification pending</> : <><Zap className="w-3.5 h-3.5" /> Pay ₹{settings.pro_price} via UPI →</>}
            </button>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showPay && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1117] p-6 relative">
              <div className="flex items-center justify-between mb-3 sticky top-0 bg-[#0d1117] pb-2 -mx-6 px-6 -mt-6 pt-6 z-10">
                <button onClick={() => setShowPay(false)} className="flex items-center gap-1.5 text-[12px] text-slate-300 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button onClick={() => setShowPay(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <h2 className="text-lg font-semibold text-white mb-1">Complete Your Payment</h2>
              <p className="text-xs text-slate-400 mb-4">Scan the QR with any UPI app to pay ₹{settings.pro_price}</p>

              <div className="rounded-xl border border-white/10 bg-white p-3 aspect-square flex items-center justify-center mb-4">
                {settings.qr_code_url ? (
                  <img src={settings.qr_code_url} alt="UPI QR" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-sm text-slate-500 text-center px-4">QR code not configured yet. Please contact support.</span>
                )}
              </div>

              {settings.upi_id && (
                <div className="flex items-center justify-between bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 mb-3">
                  <div>
                    <p className="text-[10px] uppercase text-slate-500">UPI ID</p>
                    <p className="text-sm text-white font-mono">{settings.upi_id}</p>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(settings.upi_id!); toast.success("UPI ID copied"); }} className="text-blue-300 hover:text-blue-200"><Copy className="w-4 h-4" /></button>
                </div>
              )}
              <div className="flex items-center justify-between bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 mb-4">
                <div><p className="text-[10px] uppercase text-slate-500">Amount</p><p className="text-sm text-white font-semibold">₹{settings.pro_price}</p></div>
              </div>

              <label className="text-xs text-slate-400 block mb-1">After paying, enter UPI Transaction ID</label>
              <input value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. 412345678901" className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-400 mb-3" />

              <label className="text-xs text-slate-400 block mb-1">Payment screenshot (proof) <span className="text-rose-400">*</span></label>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])} />
              {screenshot ? (
                <div className="mb-3 rounded-lg border border-emerald-400/30 bg-emerald-500/5 p-2">
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="text-xs text-emerald-200 flex-1 truncate">{screenshotName}</span>
                    <button onClick={() => { setScreenshot(null); setScreenshotName(""); }} className="text-slate-400 hover:text-rose-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <img src={screenshot} alt="Payment proof preview" className="max-h-40 mx-auto rounded" />
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="w-full mb-3 py-2.5 rounded-lg border border-dashed border-white/20 hover:border-blue-400 text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors">
                  <Upload className="w-3.5 h-3.5" /> Upload payment screenshot (PNG/JPG, max 5MB)
                </button>
              )}

              <button disabled={busy} onClick={submit} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] disabled:opacity-50">
                {busy ? "Submitting…" : "Submit Payment →"}
              </button>
              <p className="text-[10px] text-slate-500 text-center mt-2 flex items-center justify-center gap-1"><Clock className="w-2.5 h-2.5" /> Pro access activated within 2-4 hours after verification</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UpgradePage;
