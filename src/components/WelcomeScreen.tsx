import React from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Code,
  Calculator,
  Lightbulb,
  Image as ImageIcon,
  Globe,
  GraduationCap,
  Briefcase,
  FileText,
} from "lucide-react";

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

const suggestions = [
  { icon: Code, title: "Write code", text: "Write a Python function to find prime numbers" },
  { icon: Calculator, title: "Solve math", text: "Solve the integral of x²·sin(x) step by step" },
  { icon: Lightbulb, title: "Brainstorm", text: "Give me 5 creative startup ideas for 2026" },
  { icon: ImageIcon, title: "Generate image", text: "Generate an image of a futuristic city at night" },
  { icon: Globe, title: "Translate", text: "Explain quantum computing in simple Hindi" },
  { icon: FileText, title: "Analyze docs", text: "Upload a PDF and I'll summarize it for you" },
];

const modules = [
  { icon: GraduationCap, label: "Learn", text: "You are my tutor. Help me learn step by step." },
  { icon: Briefcase, label: "Career", text: "Help me prepare for a software engineering interview." },
  { icon: Lightbulb, label: "Ideas", text: "Brainstorm creative ideas with me." },
  { icon: Code, label: "Code", text: "Help me debug and improve my code." },
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSuggestionClick }) => {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-3xl w-full mx-auto">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur text-[11px] text-blue-200 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Powered by Gemini 3 Pro · Multimodal
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-white mb-3">
            How can I help you{" "}
            <span className="bg-gradient-to-r from-[#60A5FA] via-[#3B82F6] to-[#2563EB] bg-clip-text text-transparent">
              today?
            </span>
          </h1>
          <p className="text-slate-400 text-sm">
            Ask anything · upload PDFs, sheets and images · generate code, art and answers.
          </p>
        </motion.div>

        {/* Quick modules */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="flex flex-wrap justify-center gap-2 mb-8"
        >
          {modules.map((m) => (
            <button
              key={m.label}
              onClick={() => onSuggestionClick(m.text)}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-300 bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-blue-400/30 hover:text-white transition-all"
            >
              <m.icon className="w-3.5 h-3.5 text-blue-300" />
              {m.label}
            </button>
          ))}
        </motion.div>

        {/* Suggestion grid */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          {suggestions.map((s, i) => (
            <motion.button
              key={i}
              whileHover={{ y: -2 }}
              onClick={() => onSuggestionClick(s.text)}
              className="group relative text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 hover:bg-white/[0.05] transition-all overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-blue-500/5 via-transparent to-blue-500/5 pointer-events-none" />
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-400/10 border border-blue-400/20 flex items-center justify-center mb-3">
                  <s.icon className="w-4 h-4 text-blue-300" />
                </div>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">{s.title}</p>
                <p className="text-sm text-slate-200 leading-relaxed">{s.text}</p>
              </div>
            </motion.button>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
