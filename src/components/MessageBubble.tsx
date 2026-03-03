import React from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check, Bot, User, Image as ImageIcon } from "lucide-react";
import { useState } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const isBot = message.role === "assistant";

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
            ? "bg-primary/10 border border-primary/30"
            : "bg-accent/10 border border-accent/30"
        }`}
      >
        {isBot ? (
          <Bot className="w-4 h-4 text-primary" />
        ) : (
          <User className="w-4 h-4 text-accent" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 max-w-[85%] ${isBot ? "" : "flex flex-col items-end"}`}>
        <div
          className={`rounded-xl px-4 py-3 ${
            isBot
              ? "bg-card border border-border"
              : "bg-primary/10 border border-primary/20"
          }`}
        >
          {isBot ? (
            <div className="prose-neon text-sm leading-relaxed">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-foreground">{message.content}</p>
          )}

          {message.imageUrl && (
            <div className="mt-3">
              <img
                src={message.imageUrl}
                alt="Generated"
                className="rounded-lg max-w-full border border-border"
              />
            </div>
          )}
        </div>

        {/* Copy button for bot messages */}
        {isBot && message.content && (
          <button
            onClick={handleCopy}
            className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded"
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
