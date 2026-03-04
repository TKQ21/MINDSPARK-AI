import React from "react";
import { Sparkles, Code, Calculator, Lightbulb, Image, Globe, GraduationCap, Gamepad2, Heart, ShoppingBag, Briefcase, FileText } from "lucide-react";

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

const suggestions = [
  { icon: Code, text: "Write a Python function to find prime numbers", borderColor: "border-neon-cyan/40", glowColor: "shadow-[0_0_8px_hsl(180_100%_50%/0.12)]", iconColor: "text-neon-cyan" },
  { icon: Calculator, text: "Solve the integral of x²·sin(x) step by step", borderColor: "border-neon-pink/40", glowColor: "shadow-[0_0_8px_hsl(330_100%_71%/0.12)]", iconColor: "text-neon-pink" },
  { icon: Lightbulb, text: "Give me 5 creative startup ideas for 2025", borderColor: "border-neon-green/40", glowColor: "shadow-[0_0_8px_hsl(120_100%_55%/0.12)]", iconColor: "text-neon-green" },
  { icon: Image, text: "Generate an image of a futuristic city at night", borderColor: "border-neon-purple/40", glowColor: "shadow-[0_0_8px_hsl(270_100%_60%/0.12)]", iconColor: "text-neon-purple" },
  { icon: Globe, text: "Explain quantum computing in simple Hindi", borderColor: "border-neon-yellow/40", glowColor: "shadow-[0_0_8px_hsl(55_100%_50%/0.12)]", iconColor: "text-neon-yellow" },
  { icon: Code, text: "Build a responsive navbar with HTML and CSS", borderColor: "border-neon-red/40", glowColor: "shadow-[0_0_8px_hsl(0_100%_55%/0.12)]", iconColor: "text-neon-red" },
];

const pluginModules = [
  { icon: GraduationCap, label: "📚 Education", text: "You are my tutor. Help me learn and understand topics step by step.", color: "border-neon-cyan/40 hover:bg-neon-cyan/10", iconColor: "text-neon-cyan" },
  { icon: Gamepad2, label: "🎮 Entertainment", text: "Tell me a funny joke or an interesting story!", color: "border-neon-pink/40 hover:bg-neon-pink/10", iconColor: "text-neon-pink" },
  { icon: Heart, label: "💪 Health & Fitness", text: "Give me a personalized workout routine and diet plan for today.", color: "border-neon-green/40 hover:bg-neon-green/10", iconColor: "text-neon-green" },
  { icon: ShoppingBag, label: "🛒 Shopping", text: "Suggest the best budget smartphones under ₹15,000 in 2026.", color: "border-neon-yellow/40 hover:bg-neon-yellow/10", iconColor: "text-neon-yellow" },
  { icon: Briefcase, label: "💼 Career", text: "Help me prepare for a software engineering interview.", color: "border-neon-purple/40 hover:bg-neon-purple/10", iconColor: "text-neon-purple" },
  { icon: FileText, label: "📄 Document", text: "Upload a file and I'll summarize, analyze, or create notes from it.", color: "border-neon-red/40 hover:bg-neon-red/10", iconColor: "text-neon-red" },
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSuggestionClick }) => {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl w-full mx-auto text-center">
        {/* Logo */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-12 h-12 text-neon-cyan animate-pulse-glow" />
          </div>
          <h1 className="font-orbitron text-4xl font-bold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink bg-clip-text text-transparent mb-2"
            style={{ textShadow: "0 0 30px hsl(180 100% 50% / 0.3)" }}
          >
            MINDSPARK AI
          </h1>
          <p className="text-muted-foreground text-sm">
            Your intelligent assistant for coding, math, creativity & more ✨
          </p>
        </div>

        {/* Plugin Modules */}
        <div className="mb-8">
          <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">Quick Modules</p>
          <div className="flex flex-wrap justify-center gap-2">
            {pluginModules.map((mod, i) => (
              <button
                key={i}
                onClick={() => onSuggestionClick(mod.text)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full border ${mod.color} bg-card/30 backdrop-blur-sm transition-all text-xs font-medium text-foreground`}
              >
                <mod.icon className={`w-3.5 h-3.5 ${mod.iconColor}`} />
                {mod.label}
              </button>
            ))}
          </div>
        </div>

        {/* Suggestion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s.text)}
              className={`flex items-start gap-3 p-3 rounded-xl border ${s.borderColor} ${s.glowColor} bg-card/40 backdrop-blur-sm hover:bg-card/70 transition-all text-left group`}
            >
              <s.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${s.iconColor}`} />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                {s.text}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
