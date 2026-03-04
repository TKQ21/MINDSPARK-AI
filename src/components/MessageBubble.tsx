import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, Bot, User, FileText } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  fileName?: string;
}

interface MessageBubbleProps {
  message: Message;
}

const neonBorderColors = [
  "border-neon-cyan/30",
  "border-neon-pink/30",
  "border-neon-green/30",
  "border-neon-yellow/30",
  "border-neon-purple/30",
  "border-neon-red/30",
];

const neonGlowStyles = [
  "shadow-[0_0_8px_hsl(180_100%_50%/0.15)]",
  "shadow-[0_0_8px_hsl(330_100%_71%/0.15)]",
  "shadow-[0_0_8px_hsl(120_100%_55%/0.15)]",
  "shadow-[0_0_8px_hsl(55_100%_50%/0.15)]",
  "shadow-[0_0_8px_hsl(270_100%_60%/0.15)]",
  "shadow-[0_0_8px_hsl(0_100%_55%/0.15)]",
];

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const isBot = message.role === "assistant";

  const colorIndex = message.id.charCodeAt(0) % neonBorderColors.length;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-3 ${isBot ? "" : "flex-row-reverse"} group`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isBot
            ? "bg-neon-cyan/10 border border-neon-cyan/30"
            : "bg-neon-pink/10 border border-neon-pink/30"
        }`}
      >
        {isBot ? (
          <Bot className="w-4 h-4 text-neon-cyan" />
        ) : (
          <User className="w-4 h-4 text-neon-pink" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 max-w-[85%] ${isBot ? "" : "flex flex-col items-end"}`}>
        <div
          className={`rounded-xl px-4 py-3 bg-card/80 backdrop-blur-sm border ${neonBorderColors[colorIndex]} ${neonGlowStyles[colorIndex]}`}
        >
          {message.fileName && (
            <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
              <FileText className="w-3.5 h-3.5 text-neon-yellow" />
              {message.fileName}
            </div>
          )}

          {isBot ? (
            <div className="prose-neon text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-foreground">{message.content}</p>
          )}

          {message.imageUrl && (
            <div className="mt-3">
              <img
                src={message.imageUrl}
                alt="Generated"
                className="rounded-lg max-w-full border border-neon-purple/30"
              />
            </div>
          )}
        </div>

        {/* Copy button */}
        {isBot && message.content && (
          <button
            onClick={handleCopy}
            className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-muted-foreground hover:text-neon-cyan px-2 py-1 rounded"
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
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
