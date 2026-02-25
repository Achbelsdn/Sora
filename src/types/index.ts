// ── Agent types ────────────────────────────────────────────────────
export type AgentId = 'researcher' | 'analyst' | 'critic' | 'synthesizer';
export type AgentStatus = 'idle' | 'thinking' | 'done' | 'error';
export type AppMode = 'solo' | 'multi';
export type TabId = 'chat' | 'repos' | 'settings';

export interface Agent {
  id: AgentId;
  name: string;
  glyph: string;
  color: string;
  role: string;
}

export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  output?: string;
  tokens?: number;
}

// ── Chat types (Existing & Missing) ────────────────────────────────
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  mode?: AppMode;
  agentOutputs?: Partial<Record<AgentId, string>>;
  ragUsed?: boolean;
  durationMs?: number;
  error?: boolean;
}

// Ajout des types requis par chatStore.ts
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date | string | number;
}

export interface ChatSession {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt?: Date | string | number;
}

export interface DebateSession {
  id: string;
  topic: string;
  status: 'active' | 'completed' | 'pending';
  createdAt?: Date | string | number;
}

// ── Document types ─────────────────────────────────────────────────
// Requis par useDocumentGenerator.ts
export type DocumentType = 'pdf' | 'doc' | 'txt' | 'markdown';

// ── Settings ───────────────────────────────────────────────────────
export interface AppSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  groqApiKey: string;
  githubToken: string;
  mode: AppMode;
  temperature: number;
  maxTokens: number;
  activeRepos: string[]; // repo IDs to use as context
}

// ── GitHub Repo ────────────────────────────────────────────────────
export interface GithubRepo {
  id: string;
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  language: string | null;
  indexed_at: string | null;
  chunk_count: number;
  active?: boolean;
}