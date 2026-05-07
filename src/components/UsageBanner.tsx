import React, { useEffect, useState } from "react";
import { AlertTriangle, Zap } from "lucide-react";

interface Props {
  isPro: boolean;
  tokensUsed: number;
  tokensLimit: number;
  resetMs: number; // ms until reset
  onUpgrade: () => void;
}

function fmt(ms: number) {
  if (ms <= 0) return "0h 0m 0s";
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3_600_000);
  return `${h}h ${m}m ${s}s`;
}

const UsageBanner: React.FC<Props> = ({ isPro, tokensUsed, tokensLimit, resetMs, onUpgrade }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isPro) return null;

  const pct = Math.min(100, Math.round((tokensUsed / tokensLimit) * 100));
  if (pct < 75) return null;

  const remaining = Math.max(0, tokensLimit - tokensUsed);
  const baseDisplay = resetMs - (now - now); // keep a stable countdown via prop
  const display = resetMs;

  // Determine tone
  const blocked = pct >= 100;
  const critical = pct >= 90 && !blocked;
  const warn = pct >= 75 && !critical && !blocked;

  const palette = blocked
    ? "bg-rose-500/15 border-rose-400/30 text-rose-100"
    : critical
    ? "bg-orange-500/15 border-orange-400/30 text-orange-100"
    : "bg-amber-500/15 border-amber-400/30 text-amber-100";

  return (
    <div className={`mx-4 sm:mx-6 mt-3 rounded-xl border px-3 py-2.5 flex items-center gap-3 backdrop-blur-xl ${palette}`}>
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-[12px] leading-snug">
        {blocked && (
          <span>
            <strong>Daily limit reached.</strong> Resets in <span className="font-mono">{fmt(display)}</span>. Upgrade to Pro for unlimited access.
          </span>
        )}
        {critical && (
          <span>
            Running low — <strong>{remaining.toLocaleString()}</strong> tokens remaining today.
          </span>
        )}
        {warn && (
          <span>
            You've used <strong>{pct}%</strong> of today's free tokens. Resets in <span className="font-mono">{fmt(display)}</span>.
          </span>
        )}
      </div>
      <button
        onClick={onUpgrade}
        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_4px_14px_-4px_rgba(37,99,235,0.7)] transition-all"
      >
        <Zap className="w-3.5 h-3.5" /> Upgrade
      </button>
    </div>
  );
};

export default UsageBanner;
