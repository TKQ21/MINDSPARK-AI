import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  Activity,
  Cpu,
  Hash,
  Lightbulb,
  Clock,
  Zap,
} from "lucide-react";

interface InsightsPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  messageCount: number;
  documentName?: string | null;
  onSuggestion: (text: string) => void;
  tokensUsed: number;
  tokenBudget: number;
  isPro: boolean;
  hoursLeft: number;
  minutesLeft: number;
  onUpgrade: () => void;
}

const InsightsPanel: React.FC<InsightsPanelProps> = ({
  isOpen,
  onToggle,
  messageCount,
  documentName,
  onSuggestion,
  tokensUsed,
  tokenBudget,
  isPro,
  hoursLeft,
  minutesLeft,
  onUpgrade,
}) => {
  const usedTokens = isPro ? tokensUsed : Math.min(tokenBudget, tokensUsed);
  const usedPct = isPro ? 0 : Math.min(100, Math.round((usedTokens / tokenBudget) * 100));
  const barColor = usedPct >= 90 ? "from-rose-500 to-red-500" : usedPct >= 75 ? "from-amber-500 to-orange-500" : "from-[#3B82F6] to-[#2563EB]";

  const suggestions = [
    "Summarize this conversation in 5 bullets",
    "Translate the last reply to Hindi",
    "Turn the answer into a step-by-step guide",
    "Generate a follow-up question I should ask",
  ];

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-16 rounded-l-xl items-center justify-center bg-white/[0.04] border border-white/10 backdrop-blur text-slate-400 hover:text-blue-300 hover:bg-white/[0.08] transition-all"
        title="Open insights"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="hidden md:flex relative z-20 w-[300px] h-full flex-col border-l overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, hsl(230 30% 7% / 0.94) 0%, hsl(230 35% 5% / 0.97) 100%)",
          borderColor: "hsl(217 91% 60% / 0.12)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-300" />
            <p className="text-sm font-semibold text-white">Insights</p>
          </div>
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
            title="Collapse"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 space-y-4 overflow-y-auto pb-4">
          {/* Token usage */}
          <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5 text-xs text-slate-300" title="Free plan: 10 questions/day">
                <Cpu className="w-3.5 h-3.5 text-blue-300" /> Daily questions
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {isPro ? `${tokensUsed} · ∞` : `${usedTokens} / ${tokenBudget}`}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${isPro ? 12 : usedPct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={`h-full rounded-full bg-gradient-to-r ${isPro ? "from-[#3B82F6] to-[#60A5FA]" : barColor}`}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">
              {isPro ? "Pro · unlimited usage" : `${usedPct}% used · resets in ${hoursLeft}h ${minutesLeft}m`}
            </p>
            {!isPro && usedPct >= 75 && (
              <button onClick={onUpgrade} className="mt-2 w-full text-[11px] py-1.5 rounded-lg bg-blue-500/15 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-all">
                Upgrade to Pro · ₹200/mo
              </button>
            )}
          </div>

          {/* Session stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                <Hash className="w-3 h-3" /> Messages
              </div>
              <p className="text-lg font-semibold text-white">{messageCount}</p>
            </div>
            <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                <Clock className="w-3 h-3" /> Latency
              </div>
              <p className="text-lg font-semibold text-white">~1.2s</p>
            </div>
          </div>

          {/* Active context */}
          <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              Active Context
            </p>
            {documentName ? (
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <Zap className="w-3.5 h-3.5" />
                <span className="truncate">{documentName}</span>
              </div>
            ) : (
              <p className="text-xs text-slate-400">No document attached</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {["Reasoning", "Multimodal", "RAG"].map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-200 border border-blue-400/20"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Suggestions */}
          <div>
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-2 px-1">
              <Lightbulb className="w-3 h-3" /> Suggestions
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onSuggestion(s)}
                  className="w-full text-left text-xs text-slate-300 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-blue-400/30 hover:text-white transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
};

export default InsightsPanel;
