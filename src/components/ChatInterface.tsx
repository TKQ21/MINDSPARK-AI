import React, { useState, useRef, useEffect } from "react";
import { Send, Image as ImageIcon, Loader2, Menu, Paperclip } from "lucide-react";
import MessageBubble, { Message } from "./MessageBubble";
import ChatSidebar, { Conversation } from "./ChatSidebar";
import WelcomeScreen from "./WelcomeScreen";
import StarBackground from "./StarBackground";
import { toast } from "sonner";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

const ChatInterface: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeConvId ? messagesByConv[activeConvId] || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const createConversation = (title: string): string => {
    const id = generateId();
    setConversations((prev) => [{ id, title, createdAt: new Date() }, ...prev]);
    setActiveConvId(id);
    return id;
  };

  const isImageRequest = (text: string) => {
    const lower = text.toLowerCase();
    return (
      (lower.includes("generate") || lower.includes("create") || lower.includes("draw") || lower.includes("make")) &&
      (lower.includes("image") || lower.includes("picture") || lower.includes("photo") || lower.includes("illustration"))
    );
  };

  const handleImageGeneration = async (prompt: string, convId: string) => {
    try {
      const res = await fetch(IMAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Image generation failed");
      }

      const data = await res.json();
      const botMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: data.text || "Here's your generated image! 🎨",
        imageUrl: data.image_url,
      };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] || []), botMsg],
      }));
    } catch (e: any) {
      const errorMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: `Sorry, I couldn't generate the image. ${e.message}`,
      };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] || []), errorMsg],
      }));
      toast.error(e.message);
    }
  };

  const handleStreamChat = async (allMessages: Message[], convId: string) => {
    try {
      const apiMessages = allMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (resp.status === 429) {
          toast.error("Rate limit exceeded. Please wait a moment.");
          return;
        }
        if (resp.status === 402) {
          toast.error("Usage limit reached. Please add credits.");
          return;
        }
        throw new Error(err.error || "Failed to get response");
      }

      if (!resp.body) throw new Error("No response stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantSoFar = "";
      const botId = generateId();
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessagesByConv((prev) => {
                const msgs = prev[convId] || [];
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.id === botId) {
                  return {
                    ...prev,
                    [convId]: msgs.map((m) =>
                      m.id === botId ? { ...m, content: assistantSoFar } : m
                    ),
                  };
                }
                return {
                  ...prev,
                  [convId]: [
                    ...msgs,
                    { id: botId, role: "assistant", content: assistantSoFar },
                  ],
                };
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessagesByConv((prev) => ({
                ...prev,
                [convId]: (prev[convId] || []).map((m) =>
                  m.id === botId ? { ...m, content: assistantSoFar } : m
                ),
              }));
            }
          } catch {}
        }
      }
    } catch (e: any) {
      const errorMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: `Sorry, something went wrong. ${e.message}`,
      };
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] || []), errorMsg],
      }));
      toast.error(e.message);
    }
  };

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;

    setInput("");
    setIsLoading(true);

    let convId = activeConvId;
    if (!convId) {
      convId = createConversation(messageText.slice(0, 40));
    }

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: messageText,
    };

    setMessagesByConv((prev) => ({
      ...prev,
      [convId!]: [...(prev[convId!] || []), userMsg],
    }));

    const allMessages = [...(messagesByConv[convId] || []), userMsg];

    if (isImageRequest(messageText)) {
      await handleImageGeneration(messageText, convId);
    } else {
      await handleStreamChat(allMessages, convId);
    }

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden">
      <StarBackground />

      <ChatSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={(id) => {
          setActiveConvId(id);
          setSidebarOpen(false);
        }}
        onNew={() => {
          setActiveConvId(null);
          setSidebarOpen(false);
        }}
        onDelete={(id) => {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          setMessagesByConv((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          if (activeConvId === id) setActiveConvId(null);
        }}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col relative z-10 min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
          <h2 className="text-sm font-medium text-foreground truncate">
            {activeConvId
              ? conversations.find((c) => c.id === activeConvId)?.title || "Chat"
              : "MINDSPARK AI"}
          </h2>
        </header>

        {/* Messages area */}
        {messages.length === 0 && !activeConvId ? (
          <WelcomeScreen onSuggestionClick={(text) => handleSend(text)} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                </div>
                <div className="bg-card border border-border rounded-xl px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" style={{ animation: "typing-dot 1.4s infinite 0s" }} />
                    <span className="w-2 h-2 rounded-full bg-primary" style={{ animation: "typing-dot 1.4s infinite 0.2s" }} />
                    <span className="w-2 h-2 rounded-full bg-primary" style={{ animation: "typing-dot 1.4s infinite 0.4s" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-border bg-background/80 backdrop-blur-sm p-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <div className="flex-1 relative neon-border rounded-xl bg-card">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything... (code, math, images, ideas)"
                className="w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[44px] max-h-[150px]"
                rows={1}
                disabled={isLoading}
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 glow-cyan"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground mt-2">
            MINDSPARK AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
