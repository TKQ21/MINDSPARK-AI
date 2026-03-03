import React from "react";
import { Sparkles, Code, Calculator, Lightbulb, Image, Globe } from "lucide-react";

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

const suggestions = [
  { icon: Code, text: "Write a Python function to find prime numbers", color: "text-neon-cyan" },
  { icon: Calculator, text: "Solve the integral of x²·sin(x) step by step", color: "text-neon-pink" },
  { icon: Lightbulb, text: "Give me 5 creative startup ideas for 2025", color: "text-neon-green" },
  { icon: Image, text: "Generate an image of a futuristic city at night", color: "text-neon-purple" },
  { icon: Globe, text: "Explain quantum computing in simple Hindi", color: "text-neon-yellow" },
  { icon: Code, text: "Build a responsive navbar with HTML and CSS", color: "text-neon-cyan" },
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSuggestionClick }) => {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center">
        {/* Logo */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-10 h-10 text-primary animate-pulse-glow" />
          </div>
          <h1 className="font-orbitron text-4xl font-bold text-primary text-glow-cyan mb-2">
            MINDSPARK AI
          </h1>
          <p className="text-muted-foreground text-sm">
            Your intelligent assistant for coding, math, creativity & more
          </p>
        </div>

        {/* Suggestion cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s.text)}
              className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-all text-left group"
            >
              <s.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${s.color}`} />
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
