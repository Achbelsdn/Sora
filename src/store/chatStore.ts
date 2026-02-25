import { create } from 'zustand';
import type { ChatMessage, ChatSession, DebateSession } from '@/types';

interface ChatStore {
  // Sessions
  sessions: ChatSession[];
  currentSessionId: string | null;
  
  // Messages
  messages: ChatMessage[];
  
  // UI State
  isProcessing: boolean;
  currentDebate: DebateSession | null;
  
  // Actions
  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  setCurrentSession: (sessionId: string | null) => void;
  
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  
  setProcessing: (processing: boolean) => void;
  setCurrentDebate: (debate: DebateSession | null) => void;
  
  clearChat: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isProcessing: false,
  currentDebate: null,

  setSessions: (sessions) => set({ sessions }),
  
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
    currentSessionId: session.id
  })),
  
  setCurrentSession: (sessionId) => set({ 
    currentSessionId: sessionId,
    messages: [] 
  }),

  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    )
  })),

  setProcessing: (processing) => set({ isProcessing: processing }),
  
  setCurrentDebate: (debate) => set({ currentDebate: debate }),

  clearChat: () => set({ 
    messages: [], 
    currentDebate: null,
    isProcessing: false 
  })
}));
