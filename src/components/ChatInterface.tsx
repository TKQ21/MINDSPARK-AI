import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Image as ImageIcon, Loader2, Menu, Paperclip, FileText, CheckCircle, Mic, MicOff } from "lucide-react";
import MessageBubble, { Message } from "./MessageBubble";
import ChatSidebar, { Conversation } from "./ChatSidebar";
import WelcomeScreen from "./WelcomeScreen";
import StarBackground from "./StarBackground";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;
const PARSE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`;

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
  const [documentContext, setDocumentContext] = useState<string | null>(null);
  const [isParsingDoc, setIsParsingDoc] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const navigate = useNavigate();

  const messages = activeConvId ? messagesByConv[activeConvId] || [] : [];

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUserId(session.user.id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const loadConversations = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (data) {
        setConversations(data.map((c: any) => ({ id: c.id, title: c.title, createdAt: new Date(c.created_at) })));
      }
    };
    loadConversations();
  }, [userId]);

  useEffect(() => {
    if (!activeConvId || messagesByConv[activeConvId]) return;
    const loadMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeConvId)
        .order("created_at", { ascending: true });
      if (data) {
        setMessagesByConv((prev) => ({
          ...prev,
          [activeConvId]: data.map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            imageUrl: m.image_url || undefined,
            fileName: m.file_name || undefined,
          })),
        }));
      }
    };
    loadMessages();
  }, [activeConvId]);

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

  const saveMessageToDB = async (convId: string, msg: Message) => {
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: msg.role,
      content: msg.content,
      image_url: msg.imageUrl || null,
      file_name: msg.fileName || null,
    });
  };

  const createConversation = async (title: string): Promise<string> => {
    if (!userId) throw new Error("Not authenticated");
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: title.slice(0, 100) })
      .select("id")
      .single();
    if (error) throw error;
    const id = data.id;
    setConversations((prev) => [{ id, title, createdAt: new Date() }, ...prev]);
    setActiveConvId(id);
    return id;
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    await supabase.from("conversations").update({ title: newTitle }).eq("id", id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));
  };

  const handleDeleteConversation = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessagesByConv((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (activeConvId === id) setActiveConvId(null);
  };

  const isImageRequest = (text: string) => {
    const lower = text.toLowerCase();
    return (
      lower.includes("generate") || lower.includes("create") || lower.includes("draw") ||
      lower.includes("make") || lower.includes("banao") || lower.includes("bana") ||
      lower.includes("dikha") || lower.includes("show")
    ) && (
      lower.includes("image") || lower.includes("picture") || lower.includes("photo") ||
      lower.includes("illustration") || lower.includes("tasveer") || lower.includes("pic") ||
      lower.includes("wallpaper") || lower.includes("poster") || lower.includes("art") ||
      lower.includes("logo") || lower.includes("icon") || lower.includes("sketch") ||
      lower.includes("painting") || lower.includes("banner") || lower.includes("design")
    );
  };

  // Parse document using Gemini multimodal
  const parseDocument = async (fileUrl: string, fileName: string): Promise<string | null> => {
    try {
      setIsParsingDoc(true);
      toast.info("📄 Analyzing document...");
      const resp = await fetch(PARSE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ fileUrl, fileName }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Failed to parse document");
      }
      const data = await resp.json();
      if (data.success && data.text) {
        toast.success("✅ Document analyzed successfully!");
        return data.text;
      }
      throw new Error("Could not extract text from document");
    } catch (e: any) {
      toast.error(`Document analysis failed: ${e.message}`);
      return null;
    } finally {
      setIsParsingDoc(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Max 20MB.");
      return;
    }
    const filePath = `${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("chat-uploads").upload(filePath, file);
    if (uploadError) { toast.error("Upload failed: " + uploadError.message); return; }
    const { data: publicUrl } = supabase.storage.from("chat-uploads").getPublicUrl(filePath);
    const isImage = file.type.startsWith("image/");
    
    setUploadedFile({ name: file.name, url: publicUrl.publicUrl, isImage });

    // Auto-parse non-image documents
    if (!isImage) {
      const extractedText = await parseDocument(publicUrl.publicUrl, file.name);
      if (extractedText) {
        setDocumentContext(extractedText);
      }
    }

    toast.success(`📄 ${file.name} uploaded successfully! Ask any question about it.`);
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
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Image generation failed"); }
      const data = await res.json();
      const botMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.text || "Here's your generated image! 🎨",
        imageUrl: data.image_url,
      };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), botMsg] }));
      await saveMessageToDB(convId, botMsg);
    } catch (e: any) {
      const errorMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: `Sorry, I couldn't generate the image. ${e.message}` };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), errorMsg] }));
      toast.error(e.message);
    }
  };

  const handleStreamChat = async (allMessages: Message[], convId: string, docCtx: string | null) => {
    try {
      const apiMessages = allMessages.map((m) => ({ role: m.role, content: m.content }));
      const body: any = { messages: apiMessages };
      if (docCtx) {
        body.documentContext = docCtx;
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(body),
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
      const botId = crypto.randomUUID();
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
      if (assistantSoFar) {
        await saveMessageToDB(convId, { id: botId, role: "assistant", content: assistantSoFar });
      }
    } catch (e: any) {
      const errorMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: `Sorry, something went wrong. ${e.message}` };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), errorMsg] }));
      toast.error(e.message);
    }
  };

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;
    setInput("");
    setIsLoading(true);

    try {
      let convId = activeConvId;
      if (!convId) {
        convId = await createConversation(messageText.slice(0, 40));
      }

      let content = messageText;
      let fileName: string | undefined;
      let imageUrl: string | undefined;
      let currentDocContext = documentContext;

      if (uploadedFile) {
        fileName = uploadedFile.name;
        if (uploadedFile.isImage) {
          imageUrl = uploadedFile.url;
          // For images, parse them too for visual Q&A
          if (!currentDocContext) {
            const imgText = await parseDocument(uploadedFile.url, uploadedFile.name);
            if (imgText) currentDocContext = imgText;
          }
          content = messageText;
        } else {
          content = messageText;
        }
        setUploadedFile(null);
      }

      const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: messageText, fileName, imageUrl };
      setMessagesByConv((prev) => ({ ...prev, [convId!]: [...(prev[convId!] || []), userMsg] }));
      await saveMessageToDB(convId, userMsg);

      const allMessages = [...(messagesByConv[convId] || []), userMsg];

      if (isImageRequest(messageText) && !currentDocContext) {
        await handleImageGeneration(messageText, convId);
      } else {
        await handleStreamChat(allMessages, convId, currentDocContext);
      }
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Your browser doesn't support voice input.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    let finalTranscript = input;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interim = transcript;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error:", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") toast.error("Microphone access denied.");
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
    toast.success("🎤 Listening... Speak now!");
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden">
      <StarBackground />

      <ChatSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={(id) => { setActiveConvId(id); setSidebarOpen(false); setDocumentContext(null); }}
        onNew={() => { setActiveConvId(null); setSidebarOpen(false); setDocumentContext(null); }}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        userName={userName}
        onLogout={handleLogout}
      />

      <div className="w-full flex flex-col relative z-10">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-neon-cyan/10 bg-background/60 backdrop-blur-md">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <Menu className="w-5 h-5 text-neon-cyan" />
          </button>
          <h2 className="text-sm font-orbitron font-bold bg-gradient-to-r from-neon-cyan via-neon-pink to-neon-yellow bg-clip-text text-transparent truncate">
            {activeConvId ? conversations.find((c) => c.id === activeConvId)?.title || "Chat" : "MINDSPARK AI"}
          </h2>
          {documentContext && (
            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green flex items-center gap-1">
              <FileText className="w-3 h-3" /> Document loaded
              <button onClick={() => setDocumentContext(null)} className="ml-1 hover:text-neon-red">✕</button>
            </span>
          )}
        </header>

        {messages.length === 0 && !activeConvId ? (
          <WelcomeScreen onSuggestionClick={(text) => handleSend(text)} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {(isLoading || isParsingDoc) && messages[messages.length - 1]?.role === "user" && (
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

        {uploadedFile && (
          <div className="px-4 pb-2">
            <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-green/10 border border-neon-green/30 text-sm">
              <CheckCircle className="w-4 h-4 text-neon-green flex-shrink-0" />
              <FileText className="w-4 h-4 text-neon-yellow flex-shrink-0" />
              <span className="text-foreground truncate">{uploadedFile.name}</span>
              {isParsingDoc ? (
                <span className="text-muted-foreground text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Analyzing...</span>
              ) : (
                <span className="text-muted-foreground text-xs">— Ready! Ask anything about it</span>
              )}
              <button onClick={() => { setUploadedFile(null); setDocumentContext(null); }} className="ml-auto text-muted-foreground hover:text-neon-red text-xs">✕</button>
            </div>
          </div>
        )}

        <div className="border-t border-neon-cyan/10 bg-background/60 backdrop-blur-md p-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isParsingDoc}
              className="flex-shrink-0 w-11 h-11 rounded-xl border border-neon-yellow/30 bg-card/50 flex items-center justify-center hover:bg-neon-yellow/10 hover:border-neon-yellow/50 transition-all disabled:opacity-40"
              title="Upload file or image"
            >
              <Paperclip className="w-4 h-4 text-neon-yellow" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }}
              className="hidden"
            />
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={documentContext ? "Ask anything about the uploaded document..." : "Ask MINDSPARK AI anything..."}
                className="w-full bg-card/50 border border-neon-cyan/20 rounded-xl px-4 py-3 text-foreground resize-none focus:outline-none focus:border-neon-cyan/50 focus:shadow-[0_0_12px_hsl(var(--neon-cyan)/0.15)] transition-all placeholder:text-muted-foreground/60"
                rows={1}
                disabled={isLoading || isParsingDoc}
              />
            </div>
            <button
              onClick={toggleVoiceInput}
              disabled={isLoading || isParsingDoc}
              className={`flex-shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center transition-all disabled:opacity-40 ${
                isListening
                  ? "border-neon-red/50 bg-neon-red/10 text-neon-red shadow-[0_0_12px_hsl(var(--neon-red)/0.3)]"
                  : "border-neon-purple/30 bg-card/50 text-neon-purple hover:bg-neon-purple/10 hover:border-neon-purple/50"
              }`}
              title={isListening ? "Stop listening" : "Voice input"}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => handleSend()}
              disabled={isLoading || isParsingDoc || !input.trim()}
              className="flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-white flex items-center justify-center hover:shadow-[0_0_15px_hsl(var(--neon-cyan)/0.3)] transition-all disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
