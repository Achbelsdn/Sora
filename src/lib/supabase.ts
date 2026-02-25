import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[FORGE] Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder'
);

// ── Helper: invoke edge function ────────────────────────────────────────────

export async function invokeEdgeFn<T = unknown>(
  fn: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(`Edge Function "${fn}" error: ${error.message}`);
  if (!data?.success && data?.error) throw new Error(data.error);
  return data as T;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChatResponse {
  success: boolean;
  answer: string;
  session_id: string;
  model: string;
  provider: string;
  rag_used: boolean;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface MultiAgentResponse extends ChatResponse {
  researcher_findings: string;
  analyst_analysis: string;
  critic_critique: string;
  duration_seconds: number;
  agents_ran: number;
}

export interface GithubSyncResponse {
  success: boolean;
  repo: string;
  repo_id: string;
  files_indexed: number;
  chunks_created: number;
  files: string[];
  stars: number;
  language: string;
}

export interface GithubRepo {
  id: string;
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  language: string | null;
  indexed_at: string | null;
  chunk_count: number;
}
