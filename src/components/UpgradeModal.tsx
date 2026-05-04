import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, Check, Zap } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hoursLeft: number;
  minutesLeft: number;
  reason?: string;
  onUpgrade: () => void;
}

const proFeatures = [
  "Unlimited tokens & messages",
  "Unlimited image generations",
  "Unlimited document uploads (up to 100MB each)",
  "Access to all models (Gemini 3 Pro, GPT-5, Claude)",
  "Priority response queue",
  "Advanced analytics in Insights panel",
  "Export conversations",
  "Custom AI persona",
  "Priority email support",
];

const UpgradeModal: React.FC<Props> = ({ open, onOpenChange, hoursLeft, minutesLeft, reason, onUpgrade }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[hsl(230_30%_7%)] border-blue-400/20 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5 text-blue-400" />
            Upgrade to MINDSPARK Pro
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {reason || "You've reached your free daily limit."} Resets in{" "}
            <span className="text-blue-300 font-mono">{hoursLeft}h {minutesLeft}m</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl p-4 bg-gradient-to-br from-blue-600/15 to-cyan-500/5 border border-blue-400/25">
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-3xl font-bold text-white">₹200</span>
            <span className="text-sm text-slate-400">/ month</span>
          </div>
          <ul className="space-y-2">
            {proFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-slate-200">
                <Check className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onUpgrade}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_8px_24px_-8px_rgba(37,99,235,0.7)] transition-all"
        >
          <Zap className="w-4 h-4" />
          Activate Pro Plan
        </button>
        <p className="text-[10px] text-slate-500 text-center">
          Tap "Activate" to enable Pro features in this session. Real billing coming soon.
        </p>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
