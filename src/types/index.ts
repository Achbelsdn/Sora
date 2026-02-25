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

// ── Chat types ─────────────────────────────────────────────────────
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
