import React from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, ArrowLeft, Lock } from "lucide-react";

interface Props {
  isPro: boolean;
  onActivateDemo: () => void;
  onBack: () => void;
}

const freeFeatures = [
  "32,000 tokens / day",
  "5 image generations / day",
  "3 document uploads / day",
  "Gemini 1.5 Flash only",
  "Standard response speed",
];

const proFeatures = [
  "Unlimited tokens & messages",
  "Unlimited image generations",
  "Unlimited document uploads",
  "All 7 models (Gemini, Llama, Mixtral, Gemma)",
  "Priority response speed",
  "Advanced Insights panel",
  "Export conversations",
  "Custom AI persona",
];

const UpgradePage: React.FC<Props> = ({ isPro, onActivateDemo, onBack }) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to chat
        </button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.2em] text-blue-300/80 mb-3">
            <Sparkles className="w-3 h-3" /> MindSpark Pro
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Unlock the full power of MindSpark
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Get unlimited access to every model, every feature, every day.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* FREE */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-2xl p-6 border border-white/10 bg-white/[0.03]"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold text-white">Free</h3>
              {!isPro && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300 border border-slate-400/20">
                  Current Plan
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1 mb-5">
              <span className="text-3xl font-bold text-white">₹0</span>
              <span className="text-sm text-slate-400">/ month</span>
            </div>
            <ul className="space-y-2.5 mb-6">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[13px] text-slate-300">
                  <Check className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 rounded-xl text-[13px] font-medium text-slate-500 bg-white/[0.03] border border-white/5 cursor-not-allowed"
            >
              {isPro ? "Free Plan" : "Current Plan"}
            </button>
          </motion.div>

          {/* PRO */}
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative rounded-2xl p-6 border-2 border-blue-400/40 bg-gradient-to-br from-blue-600/15 via-blue-500/5 to-cyan-500/5 shadow-[0_20px_60px_-20px_rgba(37,99,235,0.5)]"
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white shadow-lg">
              MOST POPULAR
            </div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-300" /> Pro
              </h3>
              {isPro && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/20">
                  Active
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1 mb-5">
              <span className="text-3xl font-bold text-white">₹200</span>
              <span className="text-sm text-slate-400">/ month</span>
            </div>
            <ul className="space-y-2.5 mb-6">
              {proFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[13px] text-slate-200">
                  <Check className="w-4 h-4 text-blue-300 mt-0.5 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={onActivateDemo}
              disabled={isPro}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_8px_24px_-8px_rgba(37,99,235,0.7)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPro ? (
                <>You're on Pro</>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> Try Pro (Demo) →
                </>
              )}
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-2 flex items-center justify-center gap-1">
              <Lock className="w-2.5 h-2.5" /> Demo mode — instantly enables Pro locally for testing.
            </p>
          </motion.div>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-8">
          Real billing integration coming soon. For now, "Try Pro (Demo)" instantly unlocks everything in this browser.
        </p>
      </div>
    </div>
  );
};

export default UpgradePage;
