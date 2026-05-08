import React, { useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  LogOut,
  Pencil,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  Settings,
  Users,
  Search,
  Sparkles,
  Zap,
  Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

export type SidebarView = "chats" | "history" | "team" | "upgrade" | "settings";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  userName?: string;
  onLogout?: () => void;
  isPro?: boolean;
  planStatus?: "free" | "pro" | "pending";
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  isOpen,
  onToggle,
  userName,
  onLogout,
  isPro = false,
  view,
  onViewChange,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [search, setSearch] = useState("");

  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const confirmEdit = (id: string) => {
    if (editTitle.trim()) onRename(id, editTitle.trim());
    setEditingId(null);
  };

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const navItems: { key: SidebarView; icon: any; label: string }[] = [
    { key: "chats", icon: MessageSquare, label: "Chats" },
    { key: "history", icon: History, label: "History" },
    { key: "team", icon: Users, label: "Team" },
    { key: "upgrade", icon: Zap, label: "Upgrade" },
    { key: "settings", icon: Settings, label: "Settings" },
  ];

  // Mini rail (collapsed)
  if (!isOpen) {
    return (
      <aside
        className="relative z-30 flex flex-col items-center w-[64px] h-full py-4 border-r"
        style={{
          background:
            "linear-gradient(180deg, hsl(230 30% 7% / 0.92) 0%, hsl(230 35% 5% / 0.96) 100%)",
          borderColor: "hsl(217 91% 60% / 0.12)",
          backdropFilter: "blur(20px)",
        }}
      >
        <button
          onClick={onToggle}
          className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-blue-400/30 transition-all"
          title="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4 text-blue-300" />
        </button>

        <button
          onClick={onNew}
          className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_4px_20px_-4px_hsl(217_91%_60%/0.6)] hover:shadow-[0_4px_24px_-2px_hsl(217_91%_60%/0.8)] transition-all"
          title="New chat"
        >
          <Plus className="w-4 h-4" />
        </button>

        <div className="flex-1 flex flex-col items-center gap-1 mt-2">
          {navItems.map((it) => (
            <button
              key={it.key}
              onClick={() => {
                onViewChange(it.key);
                onToggle();
              }}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all relative ${
                view === it.key
                  ? "bg-blue-500/15 text-blue-300 border border-blue-400/30"
                  : "text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent"
              }`}
              title={it.label}
            >
              <it.icon className="w-4 h-4" />
              {it.key === "upgrade" && !isPro && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {userName && onLogout && (
          <button
            onClick={onLogout}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </aside>
    );
  }

  return (
    <motion.aside
      initial={{ width: 64, opacity: 0.6 }}
      animate={{ width: 280, opacity: 1 }}
      transition={{ type: "spring", damping: 28, stiffness: 280 }}
      className="relative z-30 flex flex-col h-full border-r overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, hsl(230 30% 7% / 0.94) 0%, hsl(230 35% 5% / 0.97) 100%)",
        borderColor: "hsl(217 91% 60% / 0.12)",
        backdropFilter: "blur(24px)",
      }}
    >
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563EB] via-[#3B82F6] to-[#60A5FA] flex items-center justify-center shadow-[0_4px_18px_-4px_hsl(217_91%_60%/0.7)]">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white tracking-tight">MINDSPARK</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-blue-300/80">AI Workspace</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
          title="Collapse"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Nav (vertical list now since 5 items) */}
      <div className="px-3 pb-2 space-y-0.5">
        {navItems.map((it) => {
          const active = view === it.key;
          const isUpgrade = it.key === "upgrade";
          return (
            <button
              key={it.key}
              onClick={() => onViewChange(it.key)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all ${
                active
                  ? "bg-gradient-to-r from-blue-500/20 to-indigo-500/5 text-blue-100 border border-blue-400/25"
                  : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent"
              } ${isUpgrade && !isPro && !active ? "text-blue-300" : ""}`}
            >
              <it.icon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{it.label}</span>
              {isUpgrade && !isPro && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-200 border border-blue-400/30">
                  PRO
                </span>
              )}
              {isUpgrade && isPro && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* New Chat */}
      {(view === "chats" || view === "history") && (
        <div className="px-3 pb-2">
          <button
            onClick={onNew}
            className="group w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-[#1D4ED8] via-[#2563EB] to-[#3B82F6] hover:from-[#2563EB] hover:via-[#3B82F6] hover:to-[#60A5FA] shadow-[0_8px_24px_-8px_hsl(217_91%_60%/0.7)] hover:shadow-[0_10px_28px_-6px_hsl(217_91%_60%/0.9)] transition-all"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
            New Chat
          </button>
        </div>
      )}

      {view === "chats" || view === "history" ? (
        <>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 focus:border-blue-400/40 focus:bg-white/[0.05] outline-none text-xs text-slate-200 placeholder:text-slate-500 transition-all"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-10 px-4 leading-relaxed">
                {conversations.length === 0
                  ? "No conversations yet.\nStart by creating a new chat."
                  : "No matches found."}
              </p>
            )}
            <AnimatePresence initial={false}>
              {filtered.map((conv) => {
                const active = activeId === conv.id;
                return (
                  <motion.div
                    key={conv.id}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    onClick={() => editingId !== conv.id && onSelect(conv.id)}
                    className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${
                      active
                        ? "bg-gradient-to-r from-blue-500/15 to-indigo-500/5 text-white border border-blue-400/25 shadow-inner"
                        : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full bg-gradient-to-b from-[#3B82F6] to-[#60A5FA]" />
                    )}
                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-blue-300" : ""}`} />
                    {editingId === conv.id ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit(conv.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="flex-1 bg-transparent border-b border-blue-400/40 outline-none text-sm text-white"
                      />
                    ) : (
                      <span className="truncate flex-1">{conv.title}</span>
                    )}
                    <div className="flex items-center">
                      {editingId === conv.id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); confirmEdit(conv.id); }}
                          className="p-1 text-emerald-400"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => startEdit(conv, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-blue-300"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {view === "team" && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1 mb-1">Workspace</p>
              {[
                { name: "You", role: "Owner", color: "from-blue-500 to-indigo-500" },
                { name: "AI Assistant", role: "Online", color: "from-[#3B82F6] to-[#2563EB]" },
              ].map((m) => (
                <div key={m.name} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${m.color} flex items-center justify-center text-white text-xs font-semibold`}>
                    {m.name[0]}
                  </div>
                  <div className="leading-tight flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{m.name}</p>
                    <p className="text-[10px] text-emerald-400">{m.role}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {view === "settings" && (
            <div className="space-y-3 text-xs text-slate-300">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1 mb-1">Plan & Billing</p>

              <div className={`rounded-xl p-3 border ${isPro ? "bg-gradient-to-br from-[#2563EB]/25 to-[#60A5FA]/10 border-blue-400/40" : "bg-blue-500/10 border-blue-400/25"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-white">{isPro ? "Pro Plan" : "Free Plan"}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">Active</span>
                </div>
                <p className="text-[10.5px] text-slate-300">
                  {isPro ? "Unlimited access to all models." : "32k tokens, 5 images, 3 docs per 24h."}
                </p>
              </div>

              <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1 pt-2 mb-1">Comparison</p>
              <div className="rounded-xl overflow-hidden border border-white/10 text-[10.5px]">
                <table className="w-full">
                  <thead className="bg-white/[0.04] text-slate-400">
                    <tr>
                      <th className="text-left p-1.5">Feature</th>
                      <th className="p-1.5">Free</th>
                      <th className="p-1.5 text-blue-300">Pro</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {[
                      ["Tokens / day", "32k", "∞"],
                      ["Image gen", "5", "∞"],
                      ["Doc uploads", "3", "∞"],
                      ["AI models", "1", "7"],
                      ["Speed", "Standard", "Priority"],
                      ["Insights", "Basic", "Full"],
                      ["Export", "—", "✓"],
                      ["Support", "Community", "Priority"],
                    ].map(([f, a, b]) => (
                      <tr key={f} className="border-t border-white/5">
                        <td className="p-1.5">{f}</td>
                        <td className="p-1.5 text-center">{a}</td>
                        <td className="p-1.5 text-center text-blue-200">{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1 pt-2 mb-1">Models</p>
              <div className="rounded-xl overflow-hidden border border-white/10 text-[10.5px]">
                <table className="w-full">
                  <thead className="bg-white/[0.04] text-slate-400">
                    <tr>
                      <th className="text-left p-1.5">Model</th>
                      <th className="p-1.5">Plan</th>
                      <th className="p-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {[
                      ["Gemini 1.5 Flash", "Free", true],
                      ["Gemini 2.0 Flash", "Pro", isPro],
                      ["Gemini 1.5 Pro", "Pro", isPro],
                      ["Llama 3.3 70B", "Pro", isPro],
                      ["Llama 3.1 8B", "Pro", isPro],
                      ["Mixtral 8x7B", "Pro", isPro],
                      ["Gemma 2 9B", "Pro", isPro],
                    ].map(([name, plan, unlocked]) => (
                      <tr key={String(name)} className="border-t border-white/5">
                        <td className="p-1.5">{name}</td>
                        <td className="p-1.5 text-center">{plan}</td>
                        <td className="p-1.5 text-center">
                          {unlocked ? (
                            <span className="text-emerald-300">✓ Active</span>
                          ) : (
                            <span className="text-slate-500 inline-flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" /> Locked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!isPro && (
                <button
                  onClick={() => onViewChange("upgrade")}
                  className="mt-2 w-full text-[11px] font-semibold py-2 rounded-lg text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] shadow-[0_4px_14px_-4px_rgba(37,99,235,0.7)] transition-all flex items-center justify-center gap-1"
                >
                  <Zap className="w-3 h-3" /> Upgrade to Pro
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="p-3 border-t border-white/5">
        {userName && (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold">
              {(userName[0] || "U").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="text-xs text-white truncate">{userName}</p>
              <p className="text-[10px] text-slate-400">{isPro ? "Pro · All models" : "Free · Gemini 1.5"}</p>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  );
};

export default ChatSidebar;
