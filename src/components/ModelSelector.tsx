import React from "react";
import { ChevronDown, Lock, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODELS, ModelId, ModelMeta } from "@/lib/models";

interface Props {
  value: ModelId;
  onChange: (id: ModelId) => void;
  isPro: boolean;
  onUpgrade: () => void;
}

const groupOrder: ModelMeta["group"][] = ["Google Gemini", "Meta via Groq", "Mistral & Others"];

const ModelSelector: React.FC<Props> = ({ value, onChange, isPro, onUpgrade }) => {
  const current = MODELS.find((m) => m.id === value) || MODELS[0];
  const availableCount = isPro ? MODELS.length : 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-1 flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-white/[0.04] border border-white/10 text-slate-300 hover:bg-white/[0.07] transition-all"
          title="Select model"
        >
          <Sparkles className="w-3 h-3 text-blue-300" />
          <span className="truncate max-w-[140px]">{current.label}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] w-72"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>Select model</span>
          <span className="text-blue-300 normal-case tracking-normal">
            {availableCount} of {MODELS.length} available
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#30363d]" />

        {groupOrder.map((group) => {
          const items = MODELS.filter((m) => m.group === group);
          if (!items.length) return null;
          return (
            <React.Fragment key={group}>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-500">
                {group}
              </DropdownMenuLabel>
              {items.map((m) => {
                const locked = m.pro && !isPro;
                const active = m.id === value;
                return (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (locked) {
                        onUpgrade();
                        return;
                      }
                      onChange(m.id);
                    }}
                    className={`flex items-start gap-2 cursor-pointer text-[#e6edf3] focus:bg-[#161b22] focus:text-white ${
                      active ? "bg-blue-500/10" : ""
                    }`}
                  >
                    <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium truncate">{m.label}</span>
                        {locked && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-400/20 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> Pro
                          </span>
                        )}
                        {active && !locked && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-400 truncate">{m.description}</p>
                    </div>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator className="bg-[#30363d]" />
            </React.Fragment>
          );
        })}

        {!isPro && (
          <button
            onClick={onUpgrade}
            className="w-full text-[11px] font-semibold py-1.5 mt-1 rounded-md text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] transition-all"
          >
            Upgrade to unlock all models →
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ModelSelector;
