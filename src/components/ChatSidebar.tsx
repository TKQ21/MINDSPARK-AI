import React, { useState } from "react";
import { Plus, MessageSquare, Trash2, Sparkles, LogOut, User, X, Pencil, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

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
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const confirmEdit = (id: string) => {
    if (editTitle.trim()) {
      onRename(id, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
            onClick={onToggle}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed z-50 top-0 left-0 h-full w-[280px] flex flex-col"
            style={{
              background: "linear-gradient(180deg, hsl(230 22% 10%) 0%, hsl(230 28% 7%) 100%)",
              borderRight: "1px solid hsl(180 100% 50% / 0.15)",
            }}
          >
            {/* Header */}
            <div className="p-4 border-b border-neon-cyan/10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary animate-pulse-glow" />
                  <h1 className="font-orbitron text-lg font-bold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink bg-clip-text text-transparent">
                    MINDSPARK
                  </h1>
                  <span className="text-xs font-orbitron text-neon-yellow">AI</span>
                </div>
                <button
                  onClick={onToggle}
                  className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={onNew}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neon-green/30 hover:bg-neon-green/10 hover:border-neon-green/50 transition-all text-sm font-medium text-foreground"
              >
                <Plus className="w-4 h-4 text-neon-green" />
                New Chat
              </button>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No conversations yet
                </p>
              )}
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => editingId !== conv.id && onSelect(conv.id)}
                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all text-sm ${
                    activeId === conv.id
                      ? "bg-neon-cyan/10 border border-neon-cyan/20 text-foreground"
                      : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent"
                  }`}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
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
                      className="flex-1 bg-transparent border-b border-neon-cyan/40 outline-none text-sm text-foreground px-0 py-0"
                    />
                  ) : (
                    <span className="truncate flex-1">{conv.title}</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {editingId === conv.id ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); confirmEdit(conv.id); }}
                        className="p-1 hover:text-neon-green transition-colors"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => startEdit(conv, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-neon-cyan"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-neon-red"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-neon-cyan/10">
              {userName && (
                <div className="flex items-center gap-2 mb-2 px-2">
                  <div className="w-7 h-7 rounded-full bg-neon-purple/20 border border-neon-purple/30 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-neon-purple" />
                  </div>
                  <span className="text-xs text-foreground truncate flex-1">{userName}</span>
                  {onLogout && (
                    <button
                      onClick={onLogout}
                      className="p-1.5 rounded-lg hover:bg-neon-red/10 text-muted-foreground hover:text-neon-red transition-colors"
                      title="Logout"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground text-center">
                Powered by MINDSPARK AI ✨
              </p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChatSidebar;
