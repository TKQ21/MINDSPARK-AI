import React from "react";
import { Sparkles, Code, Calculator, Lightbulb, Image, Globe } from "lucide-react";

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

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSuggestionClick }) => {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center">
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

        {/* Suggestion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
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
