import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  Sparkles,
  FileText,
  Download,
  Volume2,
  VolumeX,
  RotateCw,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
} from "lucide-react";
import { motion } from "framer-motion";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  fileName?: string;
}

interface MessageBubbleProps {
  message: Message;
  onRegenerate?: () => void;
}

function formatTime(id: string) {
  // derive time from current moment when rendered (best-effort) — UI only
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handleOpen = () => {
    const blob = new Blob([code], { type: "text/plain" });
    window.open(URL.createObjectURL(blob), "_blank");
  };
  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-white/10 bg-[hsl(230_30%_6%)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
          {lang || "code"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-300 px-2 py-1 rounded transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleOpen}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-300 px-2 py-1 rounded transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
        </div>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onRegenerate }) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isBot = message.role === "assistant";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadImage = async () => {
    if (!message.imageUrl) return;
    try {
      const response = await fetch(message.imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mindspark-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(message.imageUrl, "_blank");
    }
  };

  const handleSpeak = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const plainText = message.content
      .replace(/#{1,6}\s/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[|_~>-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.lang = "hi-IN";
    const voices = window.speechSynthesis.getVoices();
    const hindiVoice = voices.find((v) => v.lang.startsWith("hi"));
    const englishVoice = voices.find((v) => v.lang.startsWith("en"));
    utterance.voice = hindiVoice || englishVoice || voices[0] || null;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`group flex gap-3 ${isBot ? "" : "justify-end"}`}
    >
      {/* Avatar */}
      {isBot && (
        <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 via-cyan-400 to-blue-600 shadow-[0_4px_18px_-4px_hsl(217_91%_60%/0.7)]">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}

      {/* Content column */}
      <div className={`${isBot ? "flex-1 max-w-[85%]" : "max-w-[78%] flex flex-col items-end"}`}>
        {/* Meta row */}
        <div
          className={`flex items-center gap-2 mb-1 text-[10px] text-slate-500 ${
            isBot ? "" : "flex-row-reverse"
          }`}
        >
          {isBot && <span className="font-medium text-slate-400">MINDSPARK AI</span>}
          {isBot && <span>·</span>}
          <span>{formatTime(message.id)}</span>
        </div>

        {/* Bubble */}
        <div
          className={`relative rounded-2xl px-4 py-3 backdrop-blur-xl border transition-all ${
            isBot
              ? "bg-gradient-to-br from-white/[0.04] to-white/[0.015] border-white/10 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]"
              : "bg-gradient-to-br from-blue-600/25 to-cyan-500/10 border-blue-400/25 shadow-[0_8px_30px_-12px_hsl(217_91%_60%/0.45)]"
          }`}
        >
          {message.fileName && (
            <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-300">
              <FileText className="w-3.5 h-3.5 text-blue-300" />
              <span className="truncate">{message.fileName}</span>
            </div>
          )}

          {isBot ? (
            <div className="prose-neon text-[14px] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    const code = String(children).replace(/\n$/, "");
                    if (!inline && (match || code.includes("\n"))) {
                      return <CodeBlock code={code} lang={match?.[1]} />;
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap">
              {message.content}
            </p>
          )}

          {message.imageUrl && (
            <div className="mt-3 relative group/img">
              <img
                src={message.imageUrl}
                alt="Generated"
                className="rounded-xl max-w-full border border-white/10"
              />
              <button
                onClick={handleDownloadImage}
                className="absolute top-2 right-2 p-2 rounded-lg bg-black/60 backdrop-blur border border-white/10 text-blue-300 hover:bg-black/80 transition-all opacity-0 group-hover/img:opacity-100"
                title="Download image"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Hover actions */}
        {isBot && message.content && (
          <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-300 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> Copy
                </>
              )}
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-300 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors"
              >
                <RotateCw className="w-3 h-3" /> Regenerate
              </button>
            )}
            <button
              onClick={handleSpeak}
              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors ${
                isSpeaking ? "text-rose-300" : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              {isSpeaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              {isSpeaking ? "Stop" : "Speak"}
            </button>
            <button
              onClick={() => setFeedback(feedback === "up" ? null : "up")}
              className={`p-1 rounded-md hover:bg-white/[0.04] transition-colors ${
                feedback === "up" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              <ThumbsUp className="w-3 h-3" />
            </button>
            <button
              onClick={() => setFeedback(feedback === "down" ? null : "down")}
              className={`p-1 rounded-md hover:bg-white/[0.04] transition-colors ${
                feedback === "down" ? "text-rose-300" : "text-slate-400 hover:text-rose-300"
              }`}
            >
              <ThumbsDown className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default React.memo(MessageBubble, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.imageUrl === next.message.imageUrl &&
    prev.message.fileName === next.message.fileName &&
    prev.onRegenerate === next.onRegenerate
  );
});
