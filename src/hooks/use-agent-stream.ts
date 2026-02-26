import { useState, useCallback, useRef } from 'react';

export type AgentId = 'researcher' | 'architect' | 'critic' | 'synthesizer';

export interface AgentStream {
  id: string;
  label: string;
  status: 'idle' | 'thinking' | 'streaming' | 'done';
  content: string;
  startedAt?: number;
  doneAt?: number;
}

export interface StreamResult {
  answer: string;
  researcher_findings?: string;
  analyst_analysis?: string;
  critic_critique?: string;
  session_id?: string;
  duration_ms?: number;
  rag_used?: boolean;
}

const AGENT_META: Record<string, { label: string; icon: string; color: string }> = {
  researcher:  { label: 'Researcher',  icon: '🔍', color: '#1a4a8b' },
  architect:   { label: 'Architect',   icon: '🏗️', color: '#1a7a4a' },
  critic:      { label: 'Critic',      icon: '⚡', color: '#8b1a1a' },
  synthesizer: { label: 'Synthesizer', icon: '✦',  color: '#7a4a0a' },
  llama:       { label: 'LLaMA',       icon: '🦙', color: '#1a0e08' },
  gemini:      { label: 'Gemini',      icon: '💎', color: '#1a4a8b' },
  openrouter:  { label: 'OpenRouter',  icon: '🌐', color: '#5a2a8a' },
};

export function useAgentStream() {
  const [agents, setAgents] = useState<Record<string, AgentStream>>({});
  const [phase, setPhase] = useState<string>('');
  const [elapsed, setElapsed] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<StreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const reset = useCallback(() => {
    setAgents({});
    setPhase('');
    setElapsed(0);
    setStreaming(false);
    setResult(null);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stream = useCallback(async (
    supabaseUrl: string,
    supabaseKey: string,
    fnName: string,
    body: Record<string, unknown>
  ): Promise<StreamResult | null> => {
    reset();
    setStreaming(true);
    startRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: StreamResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case 'phase':
                  setPhase(data.phase);
                  for (const agentId of data.agents) {
                    setAgents(prev => ({ ...prev, [agentId]: { id: agentId, label: AGENT_META[agentId]?.label ?? agentId, status: 'idle', content: '' } }));
                  }
                  break;
                case 'agent_start':
                  setAgents(prev => ({ ...prev, [data.agent]: { ...prev[data.agent], id: data.agent, label: AGENT_META[data.agent]?.label ?? data.agent, status: 'streaming', content: prev[data.agent]?.content ?? '', startedAt: Date.now() } }));
                  break;
                case 'agent_token':
                  setAgents(prev => ({ ...prev, [data.agent]: { ...prev[data.agent], content: (prev[data.agent]?.content ?? '') + data.token } }));
                  break;
                case 'agent_done':
                  setAgents(prev => ({ ...prev, [data.agent]: { ...prev[data.agent], status: 'done', doneAt: Date.now() } }));
                  break;
                case 'done':
                  finalResult = data;
                  setResult(data);
                  break;
                case 'error':
                  setError(data.error);
                  break;
              }
            } catch { /* skip malformed */ }
            currentEvent = '';
          } else if (line === '') {
            currentEvent = '';
          }
        }
      }
      return finalResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Stream failed';
      setError(msg);
      return null;
    } finally {
      setStreaming(false);
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }
  }, [reset]);

  return { agents, phase, elapsed, streaming, result, error, stream, reset, agentMeta: AGENT_META };
}