/**
 * useForgeAgents — Real Supabase edge function calls
 * Solo: Groq LLaMA 3.3 70B single agent
 * Multi: 4-agent pipeline (Researcher → Analyst → Critic → Synthesizer)
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { AgentId, AgentState, AgentStatus, AppMode, Message } from '@/types';

export interface ForgeState {
  agents: Record<AgentId, AgentState>;
  isProcessing: boolean;
  error: string | null;
  sessionId: string | null;
}

interface UseForgeAgentsReturn extends ForgeState {
  sendMessage: (content: string, history: Message[], mode: AppMode, activeRepos?: string[]) => Promise<{ answer: string; agentOutputs?: Partial<Record<AgentId, string>>; ragUsed: boolean; durationMs: number }>;
  reset: () => void;
}

const AGENT_ORDER: AgentId[] = ['researcher', 'analyst', 'critic', 'synthesizer'];

function makeDefault(): Record<AgentId, AgentState> {
  return Object.fromEntries(
    AGENT_ORDER.map(id => [id, { id, status: 'idle' as AgentStatus }])
  ) as Record<AgentId, AgentState>;
}

export function useForgeAgents(): UseForgeAgentsReturn {
  const [agents, setAgents] = useState<Record<AgentId, AgentState>>(makeDefault());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const setAgent = useCallback((id: AgentId, update: Partial<AgentState>) => {
    setAgents(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    history: Message[],
    mode: AppMode,
    activeRepos: string[] = []
  ) => {
    setIsProcessing(true);
    setError(null);
    setAgents(makeDefault());

    const t0 = Date.now();

    try {
      const formattedHistory = history.slice(-8).map(m => ({
        role: m.role,
        content: m.content,
      }));

      if (mode === 'solo') {
        // ── SOLO: single Groq call ─────────────────────────────────
        setAgent('synthesizer', { status: 'thinking' });

        const { data, error: fnErr } = await supabase.functions.invoke('chat', {
          body: {
            message: content,
            session_id: sessionId,
            history: formattedHistory,
            repos: activeRepos,
          },
        });

        if (fnErr) throw new Error(fnErr.message);
        if (!data?.success) throw new Error(data?.error ?? 'Chat function failed');

        setAgent('synthesizer', { status: 'done', output: data.answer, tokens: data.usage?.completion_tokens });
        if (data.session_id && data.session_id !== sessionId) setSessionId(data.session_id);

        return {
          answer: data.answer,
          ragUsed: data.rag_used ?? false,
          durationMs: Date.now() - t0,
        };

      } else {
        // ── MULTI: 4-agent pipeline ────────────────────────────────
        // Animate agents while backend processes
        const animTimers: number[] = [];
        let agentIdx = 0;

        const tick = () => {
          if (agentIdx < AGENT_ORDER.length) {
            if (agentIdx > 0) setAgent(AGENT_ORDER[agentIdx - 1], { status: 'done' });
            setAgent(AGENT_ORDER[agentIdx], { status: 'thinking' });
            agentIdx++;
            animTimers.push(window.setTimeout(tick, 2200));
          }
        };
        tick();

        const { data, error: fnErr } = await supabase.functions.invoke('multiagent', {
          body: {
            message: content,
            session_id: sessionId,
            history: formattedHistory,
            repos: activeRepos,
          },
        });

        animTimers.forEach(t => clearTimeout(t));

        if (fnErr) throw new Error(fnErr.message);
        if (!data?.success) throw new Error(data?.error ?? 'Multi-agent function failed');

        // Set final agent outputs from real data
        setAgent('researcher', { status: 'done', output: data.researcher_findings });
        setAgent('analyst', { status: 'done', output: data.analyst_analysis });
        setAgent('critic', { status: 'done', output: data.critic_critique });
        setAgent('synthesizer', { status: 'done', output: data.answer });

        if (data.session_id && data.session_id !== sessionId) setSessionId(data.session_id);

        return {
          answer: data.answer,
          agentOutputs: {
            researcher: data.researcher_findings,
            analyst: data.analyst_analysis,
            critic: data.critic_critique,
            synthesizer: data.answer,
          },
          ragUsed: data.rag_used ?? false,
          durationMs: Math.round(data.duration_seconds * 1000),
        };
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      AGENT_ORDER.forEach(id => setAgent(id, { status: 'error' }));

      const errorAnswer = buildErrorMessage(msg);
      return { answer: errorAnswer, ragUsed: false, durationMs: Date.now() - t0 };
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, setAgent]);

  const reset = useCallback(() => {
    setAgents(makeDefault());
    setIsProcessing(false);
    setError(null);
  }, []);

  return { agents, isProcessing, error, sessionId, sendMessage, reset };
}

function buildErrorMessage(err: string): string {
  return `## ⚡ Connection Error

\`${err}\`

---

### Setup Required

**1. Create a Supabase project**
→ https://supabase.com (free tier)

**2. Run the SQL migration**
\`\`\`sql
-- supabase/migrations/001_forge_init.sql
-- Paste in Supabase SQL Editor
\`\`\`

**3. Deploy Edge Functions**
\`\`\`bash
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase functions deploy chat
npx supabase functions deploy multiagent  
npx supabase functions deploy github-sync
\`\`\`

**4. Set Supabase secrets**
\`\`\`bash
npx supabase secrets set GROQ_API_KEY=gsk_...
# Get free key: https://console.groq.com
\`\`\`

**5. Configure in Settings tab**
→ Paste your SUPABASE_URL + ANON_KEY`;
}
