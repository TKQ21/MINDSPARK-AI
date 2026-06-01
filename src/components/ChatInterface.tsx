import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Paperclip,
  FileText,
  CheckCircle,
  Mic,
  MicOff,
  ChevronDown,
  Sparkles,
  PanelRight,
} from "lucide-react";
import { motion } from "framer-motion";
import MessageBubble, { Message } from "./MessageBubble";
import ChatSidebar, { Conversation, SidebarView } from "./ChatSidebar";
import WelcomeScreen from "./WelcomeScreen";
import InsightsPanel from "./InsightsPanel";
import UpgradePage from "./UpgradePage";
import UsageBanner from "./UsageBanner";
import ModelSelector from "./ModelSelector";
import { loadSelectedModel, saveSelectedModel, ModelId, resolveModel } from "@/lib/models";
import { useUserPlan } from "@/hooks/useUserPlan";
import { clearLegacyMindSparkKeys, clearUserMindSparkCache } from "@/lib/userStorage";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;
const PARSE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`;
const unreadableFileMessage = "File received, but content could not be read. Please try re-uploading.";

const MAX_FILE_MB = 100;

const QUICK_PROMPTS = [
  "Summarize this for me",
  "Explain like I'm 5",
  "Write a Python script",
  "Create an image of…",
];

interface ChatInterfaceProps {
  userName?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ userName }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string; isImage: boolean } | null>(null);
  const [documentContext, setDocumentContext] = useState<string | null>(null);
  const [documentContexts, setDocumentContexts] = useState<Record<string, string>>({});
  const [pendingDocumentContext, setPendingDocumentContext] = useState<string | null>(null);
  const [documentReadError, setDocumentReadError] = useState<string | null>(null);
  const [isParsingDoc, setIsParsingDoc] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<string>("auto");
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const navigate = useNavigate();

  const usage = useUserPlan();
  const [view, setView] = useState<SidebarView>("chats");
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemini-1.5-flash");

  useEffect(() => {
    if (!userId) return;
    setSelectedModel(loadSelectedModel(userId));
  }, [userId]);

  // If user loses Pro, force back to free model silently
  useEffect(() => {
    const resolved = resolveModel(selectedModel, usage.isPro);
    if (resolved !== selectedModel) {
      setSelectedModel(resolved);
      saveSelectedModel(resolved, userId);
    }
  }, [usage.isPro, selectedModel, userId]);

  const handleModelChange = (id: ModelId) => {
    setSelectedModel(id);
    saveSelectedModel(id, userId);
  };

  const goUpgrade = () => setView("upgrade");

  const messages = activeConvId ? messagesByConv[activeConvId] || [] : [];

  const setLatestDocumentContext = useCallback((conversationId: string | null, nextContext: string | null) => {
    if (conversationId) {
      setDocumentContexts((prev) => {
        const next = { ...prev };
        if (nextContext) next[conversationId] = nextContext;
        else delete next[conversationId];
        return next;
      });
    } else {
      setPendingDocumentContext(nextContext);
    }
    setDocumentContext(nextContext);
  }, []);

  const clearLatestDocumentContext = useCallback((conversationId: string | null) => {
    setLatestDocumentContext(conversationId, null);
  }, [setLatestDocumentContext]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        clearLegacyMindSparkKeys();
        setUserId(session.user.id);
      }
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

  const loadMessagesForConversation = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const loaded = (data || []).map((m: any) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      imageUrl: m.image_url || undefined,
      fileName: m.file_name || undefined,
    }));

    setMessagesByConv((prev) => ({ ...prev, [conversationId]: loaded }));
    return loaded;
  }, []);

  useEffect(() => {
    if (!activeConvId || messagesByConv[activeConvId]) return;
    loadMessagesForConversation(activeConvId);
  }, [activeConvId, messagesByConv, loadMessagesForConversation]);

  useEffect(() => {
    if (activeConvId) {
      setDocumentContext(documentContexts[activeConvId] ?? null);
      return;
    }
    setDocumentContext(pendingDocumentContext);
  }, [activeConvId, documentContexts, pendingDocumentContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + "px";
    }
  }, [input]);

  const handleLogout = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) clearUserMindSparkCache(user.id);
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
    setDocumentContexts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (activeConvId === id) {
      setActiveConvId(null);
      setUploadedFile(null);
      setDocumentReadError(null);
    }
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

  const parseDocument = async (fileUrl: string, fileName: string): Promise<{ text: string | null; error: string | null }> => {
    try {
      setIsParsingDoc(true);
      const resp = await fetch(PARSE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ fileUrl, fileName }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(typeof data.error === "string" ? data.error : unreadableFileMessage);
      if (data.success && typeof data.text === "string" && data.text.trim()) {
        return { text: data.text, error: null };
      }
      throw new Error(unreadableFileMessage);
    } catch (e: any) {
      return { text: null, error: e?.message || unreadableFileMessage };
    } finally {
      setIsParsingDoc(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`File too large. Max ${MAX_FILE_MB}MB.`);
      return;
    }
    if (usage.docsExceeded) {
      toast.info("You've used all 3 free document uploads for today.");
      goUpgrade();
      return;
    }
    setDocumentReadError(null);
    const filePath = `${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("chat-uploads").upload(filePath, file);
    if (uploadError) { toast.error("Upload failed: " + uploadError.message); return; }
    const { data: publicUrl } = supabase.storage.from("chat-uploads").getPublicUrl(filePath);
    const isImage = file.type.startsWith("image/");
    setUploadedFile({ name: file.name, url: publicUrl.publicUrl, isImage });

    const { text: extractedText, error: parseError } = await parseDocument(publicUrl.publicUrl, file.name);
    if (extractedText) {
      setLatestDocumentContext(activeConvId, extractedText);
      if (!usage.isPro) usage.addDoc();
      toast.success("📄 File ready. Ask me anything about it.");
      return;
    }
    clearLatestDocumentContext(activeConvId);
    setDocumentReadError(parseError || unreadableFileMessage);
    toast.error(parseError || unreadableFileMessage);
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
        content: data.text || "Here's your generated image.",
        imageUrl: data.image_url,
      };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), botMsg] }));
      await saveMessageToDB(convId, botMsg);
      if (!usage.isPro) usage.addImage();
    } catch (e: any) {
      const errorMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: `Sorry, I couldn't generate the image. ${e.message}` };
      setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), errorMsg] }));
      toast.error(e.message);
    }
  };

  const handleStreamChat = async (allMessages: Message[], convId: string, docCtx: string | null) => {
    try {
      const apiMessages = allMessages.map((m) => ({ role: m.role, content: m.content }));
      const body: any = { messages: apiMessages, model: resolveModel(selectedModel, usage.isPro), isPro: usage.isPro };
      if (docCtx) body.documentContext = docCtx;

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
        if (!usage.isPro) {
          usage.addQuestion();
        }
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

    const wantsImg = isImageRequest(messageText);
    if (!usage.isPro) {
      if (wantsImg && usage.imagesExceeded) {
        toast.info("You've used all 5 free image generations for today. Upgrade to Pro for unlimited.");
        goUpgrade();
        return;
      }
      if (!wantsImg && usage.questionsExceeded) {
        toast.info("You've used all 10 free questions for today. Upgrade to Pro for unlimited.");
        goUpgrade();
        return;
      }
    }

    setInput("");
    setIsLoading(true);
    try {
      let convId = activeConvId;
      if (!convId) convId = await createConversation(messageText.slice(0, 40));

      const wantsGeneratedImage = isImageRequest(messageText);
      let fileName: string | undefined;
      let imageUrl: string | undefined;
      let currentDocContext = documentContexts[convId] ?? null;

      if (!currentDocContext && pendingDocumentContext) {
        currentDocContext = pendingDocumentContext;
        setDocumentContexts((prev) => ({ ...prev, [convId!]: pendingDocumentContext }));
        setPendingDocumentContext(null);
      }
      if (currentDocContext) setDocumentContext(currentDocContext);

      if (uploadedFile) {
        fileName = uploadedFile.name;
        if (uploadedFile.isImage) imageUrl = uploadedFile.url;
      }

      const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: messageText, fileName, imageUrl };
      setMessagesByConv((prev) => ({ ...prev, [convId!]: [...(prev[convId!] || []), userMsg] }));
      await saveMessageToDB(convId, userMsg);

      const priorMessages = messagesByConv[convId] || (activeConvId === convId ? await loadMessagesForConversation(convId) : []);
      const allMessages = [...priorMessages, userMsg];

      if (!currentDocContext && documentReadError && uploadedFile && !wantsGeneratedImage) {
        const botMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: documentReadError };
        setMessagesByConv((prev) => ({ ...prev, [convId!]: [...(prev[convId!] || []), botMsg] }));
        await saveMessageToDB(convId, botMsg);
        setUploadedFile(null);
        setDocumentReadError(null);
        return;
      }

      setUploadedFile(null);

      if (wantsGeneratedImage) {
        await handleImageGeneration(messageText, convId);
      } else {
        await handleStreamChat(allMessages, convId, currentDocContext);
      }
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("Your browser doesn't support voice input."); return; }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }

    const recognition = new SpeechRecognition();
    const lang = voiceLang === "auto" ? (navigator.language || "en-US") : voiceLang;
    recognition.lang = lang;
    setDetectedLang(lang);
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;
    let finalTranscript = input;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript + " ";
        else interim = transcript;
      }
      setInput(finalTranscript + interim);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error === "not-allowed") toast.error("Microphone access denied.");
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
    toast.success(`🎤 Listening (${lang})...`);
  };

  const activeTitle = activeConvId
    ? conversations.find((c) => c.id === activeConvId)?.title || "Chat"
    : "New conversation";

  return (
    <div className="flex h-screen w-full relative overflow-hidden bg-[hsl(230_30%_5%)] text-slate-100">
      {/* Aurora background */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 15% 5%, hsl(217 91% 45% / 0.35), transparent 60%), radial-gradient(ellipse 70% 60% at 90% 90%, hsl(190 95% 35% / 0.24), transparent 60%), radial-gradient(ellipse 60% 50% at 50% 100%, hsl(217 91% 50% / 0.18), transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(217 91% 80% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(217 91% 80% / 0.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 80%)",
        }}
      />

      <ChatSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={(id) => {
          setActiveConvId(id);
          setUploadedFile(null);
          setDocumentReadError(null);
        }}
        onNew={() => {
          setActiveConvId(null);
          setUploadedFile(null);
          setDocumentReadError(null);
          clearLatestDocumentContext(null);
        }}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        userName={userName}
        onLogout={handleLogout}
        isPro={usage.isPro}
        planStatus={usage.status}
        view={view}
        onViewChange={setView}
      />

      <div className="flex-1 flex flex-col relative z-10 min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.02] backdrop-blur-xl">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sparkles className="w-4 h-4 text-blue-300 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-white truncate">{activeTitle}</h2>
            {documentContext && !documentReadError && (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-emerald-300 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Doc attached
                <button
                  onClick={() => { clearLatestDocumentContext(activeConvId); setDocumentReadError(null); }}
                  className="ml-1 hover:text-rose-300"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className={`hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              insightsOpen
                ? "bg-blue-500/10 border-blue-400/30 text-blue-200"
                : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.06]"
            }`}
            title="Toggle insights"
          >
            <PanelRight className="w-3.5 h-3.5" />
            Insights
          </button>
        </header>

        {/* Body */}
        {view === "upgrade" ? (
          <UpgradePage isPro={usage.isPro} status={usage.status} onBack={() => setView("chats")} onSubmitted={() => usage.refresh()} />
        ) : messages.length === 0 && !activeConvId ? (
          <>
            <UsageBanner
              isPro={usage.isPro}
              tokensUsed={usage.questionCount}
              tokensLimit={usage.questionLimit}
              resetMs={Math.max(0, usage.resetAt - Date.now())}
              onUpgrade={goUpgrade}
            />
            <WelcomeScreen onSuggestionClick={(text) => handleSend(text)} />
          </>
        ) : (
          <>
            <UsageBanner
              isPro={usage.isPro}
              tokensUsed={usage.questionCount}
              tokensLimit={usage.questionLimit}
              resetMs={Math.max(0, usage.resetAt - Date.now())}
              onUpgrade={goUpgrade}
            />
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {(isLoading || isParsingDoc) && messages[messages.length - 1]?.role === "user" && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-3"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_4px_18px_-4px_hsl(217_91%_60%/0.7)]">
                      <Sparkles className="w-4 h-4 text-white animate-pulse" />
                    </div>
                    <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/10 backdrop-blur-xl">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="typing-star">✦</span>
                        <span className="text-blue-300 font-medium">MindSpark is typing</span>
                        <span className="flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
                          <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0.2s" }} />
                          <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: "0.4s" }} />
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </>
        )}

        {/* File chip */}
        {uploadedFile && (
          <div className="px-4 sm:px-6 pb-2">
            <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-400/20 text-sm">
              <CheckCircle className="w-4 h-4 text-emerald-300 flex-shrink-0" />
              <FileText className="w-4 h-4 text-blue-300 flex-shrink-0" />
              <span className="text-slate-100 truncate">{uploadedFile.name}</span>
              {isParsingDoc ? (
                <span className="text-slate-400 text-xs flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
                </span>
              ) : documentReadError ? (
                <span className="text-rose-300 text-xs">— {documentReadError}</span>
              ) : (
                <span className="text-slate-400 text-xs">— What should I do with it?</span>
              )}
              <button
                onClick={() => { setUploadedFile(null); setDocumentReadError(null); clearLatestDocumentContext(activeConvId); }}
                className="ml-auto text-slate-400 hover:text-rose-300 text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-white/5 bg-white/[0.02] backdrop-blur-xl p-4">
          <div className="max-w-3xl mx-auto">
            {/* Quick prompts */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3 justify-center">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setInput(p)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/10 text-slate-300 hover:bg-white/[0.06] hover:border-blue-400/30 hover:text-white transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="relative rounded-2xl bg-white/[0.04] border border-white/10 focus-within:border-blue-400/40 focus-within:shadow-[0_0_0_4px_hsl(217_91%_60%/0.08)] transition-all overflow-hidden">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  documentContext && !documentReadError
                    ? "Ask anything about the uploaded document..."
                    : "Message MINDSPARK AI..."
                }
                className="w-full bg-transparent px-4 pt-3.5 pb-12 text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none"
                rows={1}
                disabled={isLoading || isParsingDoc}
              />

              {/* Bottom toolbar */}
              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isParsingDoc}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-300 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                  title={`Upload file (max ${MAX_FILE_MB}MB)`}
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.pptx,.ppt,.md,.json,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }}
                  className="hidden"
                />
                <button
                  onClick={toggleVoiceInput}
                  disabled={isLoading || isParsingDoc}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 ${
                    isListening
                      ? "text-rose-300 bg-rose-500/10"
                      : "text-slate-400 hover:text-blue-300 hover:bg-white/[0.06]"
                  }`}
                  title={isListening ? "Stop listening" : "Voice input"}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(e.target.value)}
                  className="text-[10px] bg-[#0d1117] border border-white/10 rounded-md text-slate-200 px-1.5 py-1 outline-none hover:bg-[#161b22] focus:border-blue-400/40 [&>option]:bg-[#0d1117] [&>option]:text-[#e6edf3]"
                  title="Voice language"
                  style={{ colorScheme: "dark" }}
                >
                  <option value="auto">Auto</option>
                  <option value="en-US">English</option>
                  <option value="hi-IN">हिन्दी</option>
                  <option value="es-ES">Español</option>
                  <option value="fr-FR">Français</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="ar-SA">العربية</option>
                  <option value="ja-JP">日本語</option>
                  <option value="zh-CN">中文</option>
                </select>
                {detectedLang && isListening && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-200 border border-blue-400/20">
                    {detectedLang}
                  </span>
                )}

                <ModelSelector
                  value={selectedModel}
                  onChange={handleModelChange}
                  isPro={usage.isPro}
                  onUpgrade={goUpgrade}
                />

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 hidden sm:inline">
                    {input.length} chars · ⏎ to send
                  </span>
                  <button
                    onClick={() => handleSend()}
                    disabled={isLoading || isParsingDoc || !input.trim()}
                    className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_4px_16px_-4px_rgba(37,99,235,0.7)] hover:shadow-[0_6px_20px_-4px_rgba(37,99,235,0.9)] transition-all disabled:opacity-40 disabled:shadow-none"
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        Send
                        <Send className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 text-center mt-2">
              MINDSPARK can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>

      {/* Right insights panel */}
      <InsightsPanel
        isOpen={insightsOpen}
        onToggle={() => setInsightsOpen(!insightsOpen)}
        messageCount={messages.length}
        documentName={documentContext && !documentReadError ? uploadedFile?.name || "Recent document" : null}
        onSuggestion={(text) => setInput(text)}
        tokensUsed={usage.questionCount}
        tokenBudget={usage.questionLimit}
        isPro={usage.isPro}
        hoursLeft={usage.hoursLeft}
        minutesLeft={usage.minutesLeft}
        onUpgrade={goUpgrade}
      />

      <style>{`
        @keyframes pulse-star {
          0%, 100% { opacity: 0.3; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .typing-star { animation: pulse-star 1.5s ease-in-out infinite; color: #3B82F6; font-size: 18px; display: inline-block; }
      `}</style>
    </div>
  );
};

export default ChatInterface;
