import React, { useState, useRef, useEffect } from "react";
import { Send, Image as ImageIcon, Loader2, Menu, Paperclip, FileText, CheckCircle } from "lucide-react";
import MessageBubble, { Message } from "./MessageBubble";
import ChatSidebar, { Conversation } from "./ChatSidebar";
import WelcomeScreen from "./WelcomeScreen";
import StarBackground from "./StarBackground";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

interface ChatInterfaceProps {
  userName?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ userName }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string; isImage: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const messages = activeConvId ? messagesByConv[activeConvId] || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

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

  const handleFileUpload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Max 20MB.");
      return;
    }

    // Upload to storage
    const filePath = `${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("chat-uploads")
      .upload(filePath, file);

    if (uploadError) {
      toast.error("Upload failed: " + uploadError.message);
      return;
    }

    const { data: publicUrl } = supabase.storage
      .from("chat-uploads")
      .getPublicUrl(filePath);

    const isImage = file.type.startsWith("image/");

    // Store uploaded file info - don't auto-send
    setUploadedFile({ name: file.name, url: publicUrl.publicUrl, isImage });
    toast.success(`📄 ${file.name} uploaded successfully!`);
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
        if (resp.status === 429) { toast.error("Rate limit exceeded."); return; }
        if (resp.status === 402) { toast.error("Usage limit reached."); return; }
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
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessagesByConv((prev) => {
                const msgs = prev[convId] || [];
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.id === botId) {
                  return { ...prev, [convId]: msgs.map((m) => m.id === botId ? { ...m, content: assistantSoFar } : m) };
                }
                return { ...prev, [convId]: [...msgs, { id: botId, role: "assistant", content: assistantSoFar }] };
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e: any) {
      const errorMsg: Message = { id: generateId(), role: "assistant", content: `Sorry, something went wrong. ${e.message}` };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), errorMsg] }));
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

    // Build user message content
    let content = messageText;
    let fileName: string | undefined;
    let imageUrl: string | undefined;

    if (uploadedFile) {
      fileName = uploadedFile.name;
      if (uploadedFile.isImage) {
        imageUrl = uploadedFile.url;
        content = `[File: ${uploadedFile.name}]\n\n${messageText}`;
      } else {
        content = `[Document: ${uploadedFile.name}]\n\n${messageText}`;
      }
      setUploadedFile(null);
    }

    const userMsg: Message = { id: generateId(), role: "user", content: messageText, fileName, imageUrl };

    setMessagesByConv((prev) => ({ ...prev, [convId!]: [...(prev[convId!] || []), userMsg] }));

    const allMessages = [...(messagesByConv[convId] || []), { ...userMsg, content }];

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
        onSelect={(id) => { setActiveConvId(id); setSidebarOpen(false); }}
        onNew={() => { setActiveConvId(null); setSidebarOpen(false); }}
        onDelete={(id) => {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          setMessagesByConv((prev) => { const next = { ...prev }; delete next[id]; return next; });
          if (activeConvId === id) setActiveConvId(null);
        }}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        userName={userName}
        onLogout={handleLogout}
      />

      {/* Main area - always full width */}
      <div className="w-full flex flex-col relative z-10">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-neon-cyan/10 bg-background/60 backdrop-blur-md">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5 text-neon-cyan" />
          </button>
          <h2 className="text-sm font-orbitron font-bold bg-gradient-to-r from-neon-cyan via-neon-pink to-neon-yellow bg-clip-text text-transparent truncate">
            {activeConvId
              ? conversations.find((c) => c.id === activeConvId)?.title || "Chat"
              : "MINDSPARK AI"}
          </h2>
        </header>

        {/* Messages */}
        {messages.length === 0 && !activeConvId ? (
          <WelcomeScreen onSuggestionClick={(text) => handleSend(text)} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
                </div>
                <div className="bg-card/80 border border-neon-purple/20 rounded-xl px-4 py-3 shadow-[0_0_8px_hsl(270_100%_60%/0.1)]">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-neon-cyan" style={{ animation: "typing-dot 1.4s infinite 0s" }} />
                    <span className="w-2 h-2 rounded-full bg-neon-pink" style={{ animation: "typing-dot 1.4s infinite 0.2s" }} />
                    <span className="w-2 h-2 rounded-full bg-neon-yellow" style={{ animation: "typing-dot 1.4s infinite 0.4s" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Uploaded file indicator */}
        {uploadedFile && (
          <div className="px-4 pb-2">
            <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-green/10 border border-neon-green/30 text-sm">
              <CheckCircle className="w-4 h-4 text-neon-green flex-shrink-0" />
              <FileText className="w-4 h-4 text-neon-yellow flex-shrink-0" />
              <span className="text-foreground truncate">{uploadedFile.name}</span>
              <span className="text-muted-foreground text-xs">— Type what you want to do with it</span>
              <button
                onClick={() => setUploadedFile(null)}
                className="ml-auto text-muted-foreground hover:text-neon-red text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-neon-cyan/10 bg-background/60 backdrop-blur-md p-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            {/* Upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex-shrink-0 w-11 h-11 rounded-xl border border-neon-yellow/30 bg-card/50 flex items-center justify-center hover:bg-neon-yellow/10 hover:border-neon-yellow/50 transition-all disabled:opacity-40"
              title="Upload file or image"
            >
              <Paperclip className="w-4 h-4 text-neon-yellow" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = "";
              }}
            />

            {/* Image gen shortcut */}
            <button
              onClick={() => setInput("Generate an image of ")}
              disabled={isLoading}
              className="flex-shrink-0 w-11 h-11 rounded-xl border border-neon-pink/30 bg-card/50 flex items-center justify-center hover:bg-neon-pink/10 hover:border-neon-pink/50 transition-all disabled:opacity-40"
              title="Generate image"
            >
              <ImageIcon className="w-4 h-4 text-neon-pink" />
            </button>

            <div className="flex-1 relative rounded-xl bg-card/50 border border-neon-cyan/20 hover:border-neon-cyan/40 transition-colors" style={{ boxShadow: "inset 0 0 20px hsl(180 100% 50% / 0.03), 0 0 12px hsl(180 100% 50% / 0.08)" }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={uploadedFile ? `Ask about "${uploadedFile.name}"...` : "Ask anything... (code, math, images, ideas)"}
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
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
