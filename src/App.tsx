
import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import { useIsMobile } from './hooks/use-mobile';

marked.setOptions({ breaks: true, gfm: true });

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'chat' | 'market' | 'repos' | 'settings';
type Mode = 'solo' | 'multi' | 'kimi' | 'hybrid';
type AgentId = 'researcher' | 'analyst' | 'critic' | 'synthesizer';
type AgentStatus = 'idle' | 'thinking' | 'done';

interface Msg {
  id: string; role: 'user' | 'sara'; content: string; ts: number;
  mode?: Mode; ragUsed?: boolean; webUsed?: boolean; scrapingUsed?: boolean;
  durationMs?: number; err?: boolean; agentOutputs?: Partial<Record<AgentId, string>>;
}
interface Repo {
  id: string; owner: string; repo: string; description: string | null;
  stars: number; language: string | null; indexed_at: string | null;
  chunk_count: number; selected?: boolean;
}
interface AssocResult {
  service_name: string; tagline: string;
  repos_combined: { owner: string; repo: string; stars: number; language: string }[];
  research: string; architecture: string; starter_code: string;
  deployment_strategy: string; duration_seconds: number; live_web_used?: boolean;
}
interface MarketTemplate {
  id: string; name: string; tagline: string; category: string;
  repos: string[]; difficulty: 'starter' | 'intermediate' | 'advanced';
  color: string; icon: string; description: string;
}
interface Settings {
  supabaseUrl: string; supabaseKey: string; groqKey: string;
  githubToken: string; tinyfishKey: string; scraplingKey: string;
  model: string; temperature: number; maxTokens: number;
  systemPrompt: string; contextWindow: number;
  ragChunks: number; webEnabled: boolean; scrapingEnabled: boolean;
  persona: string;
}

// ── Agents ─────────────────────────────────────────────────────────────────
const AGENTS: Record<AgentId, { label: string; color: string; icon: string }> = {
  researcher:  { label: 'Researcher',  color: '#1a4a8b', icon: '🔍' },
  analyst:     { label: 'Architect',   color: '#1a7a4a', icon: '🏗️' },
  critic:      { label: 'Critic',      color: '#8b1a1a', icon: '⚡' },
  synthesizer: { label: 'Synthesizer', color: '#7a4a0a', icon: '✦' },
};

// ── Market templates ───────────────────────────────────────────────────────
const MARKET_TEMPLATES: MarketTemplate[] = [
  { id: 'neural-scraper', name: 'NeuralScraper', tagline: 'Web intelligence platform — Scrapling + TinyFish + LLaMA', category: 'Web Intelligence', repos: ['D4Vinci/Scrapling', 'tinyfish-io/tinyfish-cookbook'], difficulty: 'intermediate', color: '#8b1a1a', icon: '🕷️', description: 'Adaptive scraping with anti-bot bypass + AI-powered data extraction. Handles Cloudflare, dynamic JS, auto-recovers broken selectors.' },
  { id: 'llm-data-forge', name: 'LLM DataForge', tagline: 'Live data pipeline — LLM App + Data Engineer Handbook', category: 'Data Pipeline', repos: ['pathwaycom/llm-app', 'DataExpert-io/data-engineer-handbook'], difficulty: 'advanced', color: '#1a4a8b', icon: '⚙️', description: 'Real-time LLM data pipeline with streaming ingestion, vector indexing, and production data engineering patterns.' },
  { id: 'agent-academy', name: 'AgentAcademy', tagline: 'AI agent builder — ai-agents-for-beginners + openai-cookbook', category: 'AI Agents', repos: ['microsoft/ai-agents-for-beginners', 'openai/openai-cookbook'], difficulty: 'starter', color: '#1a7a4a', icon: '🤖', description: 'Build autonomous AI agents using Microsoft best practices + OpenAI patterns. Includes tool use, memory, and planning loops.' },
  { id: 'vision-api', name: 'VisionAPI', tagline: 'Image generation service — Stable Diffusion + SAM + CLIP', category: 'Computer Vision', repos: ['CompVis/stable-diffusion', 'facebookresearch/segment-anything', 'openai/CLIP'], difficulty: 'advanced', color: '#7a4a0a', icon: '🎨', description: 'Image generation + segmentation + understanding pipeline. Generate, segment, and semantically search images in one API.' },
  { id: 'llm-from-scratch', name: 'TrainYourLLM', tagline: 'Build and train LLMs from scratch', category: 'Foundation Models', repos: ['rasbt/LLMs-from-scratch', 'ggerganov/llama.cpp'], difficulty: 'advanced', color: '#4a1a7a', icon: '🧠', description: 'Full LLM training pipeline from tokenizer to transformer, with llama.cpp for efficient local inference.' },
  { id: 'data-science-hub', name: 'DataScienceHub', tagline: 'End-to-end ML platform — Python 100 Days + Pandas + TF', category: 'Machine Learning', repos: ['jackfrued/Python-100-Days', 'aymericdamien/TensorFlow-Examples'], difficulty: 'starter', color: '#1a6a4a', icon: '📊', description: 'Complete data science environment with Python best practices, TensorFlow examples, and structured learning path.' },
];

// ── Env vars — read at module level (Vite inlines at build time) ───────────
const ENV_URL = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
const ENV_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

// ── Defaults & persistence ─────────────────────────────────────────────────
const DEFAULTS: Settings = {
  supabaseUrl: ENV_URL,
  supabaseKey: ENV_KEY,
  groqKey: '', githubToken: '', tinyfishKey: '', scraplingKey: '',
  model: 'llama-3.3-70b-versatile', temperature: 0.7, maxTokens: 4096,
  systemPrompt: '', contextWindow: 10, ragChunks: 5,
  webEnabled: true, scrapingEnabled: true, persona: 'engineer',
};

function loadCfg(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('sara2_cfg') ?? '{}');
    return {
      ...DEFAULTS,
      ...saved,
      // Env vars always override cached credentials
      supabaseUrl: ENV_URL || saved.supabaseUrl || '',
      supabaseKey: ENV_KEY || saved.supabaseKey || '',
    };
  } catch { return DEFAULTS; }
}

function saveCfg(s: Settings) {
  // Never persist credentials that come from environment variables
  const toSave: Partial<Settings> = { ...s };
  if (ENV_URL) delete toSave.supabaseUrl;
  if (ENV_KEY) delete toSave.supabaseKey;
  localStorage.setItem('sara2_cfg', JSON.stringify(toSave));
}

// ── Icons ──────────────────────────────────────────────────────────────────
function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, string> = {
    chat:    'M8 12h8M8 8h12M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5l-4 4V6z',
    market:  'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    repos:   'M4 4h16v3H4zM4 10.5h16v3H4zM4 17h16v3H4z',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h2M20 12h2M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
    send:    'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    zap:     'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    check:   'M20 6L9 17l-5-5',
    x:       'M18 6L6 18M6 6l12 12',
    plus:    'M12 5v14M5 12h14',
    star:    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    layers:  'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    code:    'M16 18l6-6-6-6M8 6l-6 6 6 6',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    trending:'M23 6l-9.5 9.5-5-5L1 18',
    arrow:   'M5 12h14M12 5l7 7-7 7',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] && <path d={paths[name]} />}
    </svg>
  );
}

function Spin({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}>
      <path d="M12 2A10 10 0 0 1 22 12" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Sara() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('chat');
  const [mode, setMode] = useState<Mode>('solo');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aStatus, setAStatus] = useState<Record<AgentId, AgentStatus>>({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });
  const [cfg, setCfg] = useState<Settings>(loadCfg);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoInput, setRepoInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [assocResult, setAssocResult] = useState<AssocResult | null>(null);
  const [associating, setAssociating] = useState(false);
  const [assocGoal, setAssocGoal] = useState('');
  const [assocPhase, setAssocPhase] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<MarketTemplate | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // FIX: useMemo would be better but this avoids recreating on every render
  const sbRef = useRef<ReturnType<typeof createClient> | null>(null);
  useEffect(() => {
    sbRef.current = (cfg.supabaseUrl && cfg.supabaseKey)
      ? createClient(cfg.supabaseUrl, cfg.supabaseKey)
      : null;
    if (sbRef.current) loadRepos();
  }, [cfg.supabaseUrl, cfg.supabaseKey]);

  const sb = sbRef.current ?? ((cfg.supabaseUrl && cfg.supabaseKey) ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function loadRepos() {
    if (!sb) return;
    const { data } = await sb.from('github_repos').select('*').order('stars', { ascending: false });
    if (data) setRepos(data.map((r: Repo) => ({ ...r, selected: false })));
  }

  const setA = (id: AgentId, s: AgentStatus) => setAStatus(p => ({ ...p, [id]: s }));
  const resetA = () => setAStatus({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });

  // ── SEND - Version finale corrigée + Kimi 100% Moonshot ─────────────────
const send = useCallback(async () => {
  const text = input.trim();
  if (!text || loading || !sb) {
    if (!sb) setErrMsg('Configure Supabase dans Settings');
    return;
  }

  setInput('');
  resetA();
  setErrMsg('');
  setMsgs(p => [...p, { id: `u${Date.now()}`, role: 'user', content: text, ts: Date.now() }]);
  setLoading(true);

  const history = msgs.slice(-cfg.contextWindow).map(m => ({
    role: m.role === 'sara' ? 'assistant' : 'user',
    content: m.content
  }));

  const fn = mode === 'multi' || mode === 'hybrid' ? 'multiagent-hybrid'
           : mode === 'kimi' ? 'chat-kimi'           // ← important
           : 'chat';

  const timeout = (ms: number) => new Promise((_, reject) => 
    setTimeout(() => reject(new Error('timeout')), ms)
  );

  try {
    if (mode === 'multi' || mode === 'hybrid') {
      const order: AgentId[] = ['researcher', 'analyst', 'critic', 'synthesizer'];
      let i = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (i > 0) setA(order[i-1], 'done');
        if (i < order.length) setA(order[i], 'thinking');
        i++;
      }, 2100);
    } else setA('synthesizer', 'thinking');

    const t0 = Date.now();

    const result = await Promise.race([
      timeout(65000), // 65s pour Kimi (il est parfois lent)
      sb.functions.invoke(fn, {
        body: { 
          message: text, 
          session_id: sessionId, 
          history, 
          repos: repos.filter(r => r.selected).map(r => r.id) 
        }
      })
    ]);

    if (timerRef.current) clearInterval(timerRef.current as any);
    if (mode === 'solo' || mode === 'kimi') setA('synthesizer', 'done');
    else (Object.keys(AGENTS) as AgentId[]).forEach(k => setA(k, 'done'));

    const { data, error } = result as any;
    if (error) throw error;

    if (data?.session_id) setSessionId(data.session_id);

    setMsgs(p => [...p, {
      id: `s${Date.now()}`, 
      role: 'sara', 
      content: data?.answer ?? 'Pas de réponse', 
      ts: Date.now(), 
      mode,
      ragUsed: data?.rag_used, 
      webUsed: data?.web_used, 
      durationMs: Date.now() - t0,
      agentOutputs: (mode === 'multi' || mode === 'hybrid') 
        ? { researcher: data?.researcher_findings, analyst: data?.analyst_analysis, critic: data?.critic_critique, synthesizer: data?.answer } 
        : undefined,
    }]);

  } catch (e: any) {
    if (timerRef.current) clearInterval(timerRef.current as any);

    const msg = e.message?.includes('timeout') || e.name === 'AbortError'
      ? "Kimi est trop lent → Passage auto en LLaMA"
      : (e.message || 'Erreur inconnue');

    // Fallback automatique
    if ((mode === 'kimi' || mode === 'hybrid') && !msg.includes('LLaMA')) {
      setErrMsg("Kimi a échoué → Passage en mode LLaMA");
      setMode('solo');
    } else {
      setErrMsg(msg);
    }

    setMsgs(p => [...p, { 
      id: `e${Date.now()}`,           // ← corrigé
      role: 'sara', 
      content: `**Erreur**\n\n${msg}`, // ← corrigé
      ts: Date.now(), 
      err: true 
    }]);

  } finally {
    setLoading(false);
  }
}, [input, loading, mode, msgs, sb, repos, sessionId, cfg]);
  // ── ASSOCIATE ─────────────────────────────────────────────────────────────
  const associate = useCallback(async (repoOverrides?: string[], goalOverride?: string) => {
    const sel = repoOverrides ?? repos.filter(r => r.selected).map(r => r.id);
    if (sel.length < 2) { setErrMsg('Select at least 2 repos'); return; }
    if (!sb) { setErrMsg('Configure Supabase first'); return; }
    setAssociating(true); setAssocResult(null); setErrMsg('');
    const phases = ['Browsing live repo pages…', 'Analyzing integration points…', 'Designing architecture…', 'Generating starter code…', 'Writing deploy guide…'];
    let pi = 0; setAssocPhase(phases[0]);
    const pt = setInterval(() => { pi++; if (pi < phases.length) setAssocPhase(phases[pi]); else clearInterval(pt); }, 4000);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('associate', {
        body: { repo_ids: sel, custom_goal: (goalOverride ?? assocGoal) || undefined },
      });
      clearInterval(pt);
      if (fnErr) throw new Error(fnErr.message);
      if (!data?.success) throw new Error(data?.error ?? 'Failed');
      setAssocResult(data);
      setTab('market');
    } catch (e: unknown) { clearInterval(pt); setErrMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setAssociating(false); setAssocPhase(''); }
  }, [repos, sb, assocGoal]);

  // ── SYNC REPO ─────────────────────────────────────────────────────────────
  const syncRepo = async () => {
    if (!repoInput.trim() || syncing || !sb) return;
    const parts = repoInput.trim().replace('https://github.com/', '').split('/');
    if (parts.length < 2) { setSyncMsg('Format: owner/repo'); return; }
    const [owner, repo] = parts;
    setSyncing(true); setSyncMsg(`Indexing ${owner}/${repo}…`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('github-sync', { body: { owner, repo } });
      if (fnErr) throw new Error(fnErr.message);
      setSyncMsg(`✓ ${owner}/${repo} — ${data.chunks_created} chunks`);
      setRepoInput(''); await loadRepos();
    } catch (e: unknown) { setSyncMsg(`✗ ${e instanceof Error ? e.message : 'Failed'}`); }
    finally { setSyncing(false); }
  };

  // ── BULK SYNC ─────────────────────────────────────────────────────────────
  const bulkSync = async (preset: string) => {
    if (!sb || bulkSyncing) return;
    setBulkSyncing(true); setBulkProgress(`Starting bulk sync (${preset})…`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('bulk-sync', { body: { use_preset: preset } });
      if (fnErr) throw new Error(fnErr.message);
      setBulkProgress(`✓ ${data.repos_succeeded}/${data.repos_processed} repos · ${data.total_chunks} chunks`);
      await loadRepos();
    } catch (e: unknown) { setBulkProgress(`✗ ${e instanceof Error ? e.message : 'Error'}`); }
    finally { setBulkSyncing(false); }
  };

  const toggleRepo = (id: string) => setRepos(p => p.map(r => r.id === id ? { ...r, selected: !r.selected } : r));
  const selRepos = repos.filter(r => r.selected);

  const buildFromTemplate = async (template: MarketTemplate) => {
    setActiveTemplate(template);
    setAssocGoal(template.description);
    const matchIds = template.repos.flatMap(repoStr => {
      const [owner, repo] = repoStr.split('/');
      return repos.filter(r => r.owner === owner && r.repo === repo).map(r => r.id);
    });
    if (matchIds.length >= 2) {
      await associate(matchIds, template.description);
    } else {
      setErrMsg(`Index these repos first: ${template.repos.join(', ')}`);
    }
  };

  const isConnected = !!sb;

  const navTabs: [Tab, string, string][] = [
    ['chat', 'chat', 'Chat'],
    ['market', 'market', 'Market'],
    ['repos', 'repos', `Repos${repos.length > 0 ? ` (${repos.length})` : ''}`],
    ['settings', 'settings', 'Settings'],
  ];

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', fontFamily: 'var(--f-body)', overflow: 'hidden' }}
      className="grain"
    >
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 14px' : '0 24px',
        height: isMobile ? 52 : 56,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, boxShadow: 'var(--shadow-sm)', zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 16, color: 'white' }}>S</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Sara</span>
              <span className="chip chip-ink" style={{ fontSize: 10 }}>1.0</span>
            </div>
            {!isMobile && (
              <p style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', lineHeight: 1, marginTop: 1 }}>
                Groq · LLaMA 3.3 70B · Scrapling · TinyFish
              </p>
            )}
          </div>
        </div>

        {/* Desktop nav only */}
        {!isMobile && (
          <nav style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 4, borderRadius: 10 }}>
            {navTabs.map(([t, icon, label]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', transition: 'all 0.15s', background: tab === t ? 'var(--surface)' : 'transparent', color: tab === t ? 'var(--ink)' : 'var(--ink3)', boxShadow: tab === t ? 'var(--shadow-sm)' : 'none' }}>
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </nav>
        )}

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', background: 'var(--bg2)', padding: 3, borderRadius: 8, gap: 2 }}>
            {([['solo', 'LLaMA'], ['kimi', 'Kimi'], ['hybrid', 'K+L'], ['multi', '4×']] as [Mode, string][]).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                style={{ padding: isMobile ? '4px 7px' : '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: isMobile ? 9 : 11, fontWeight: 600, fontFamily: 'var(--f-mono)', transition: 'all 0.15s', background: mode === m ? (m === 'kimi' ? '#1a5a8b' : m === 'hybrid' ? '#5a1a8b' : m === 'solo' ? 'var(--ink)' : 'var(--red)') : 'transparent', color: mode === m ? 'white' : 'var(--ink3)', whiteSpace: 'nowrap' }}>
                {label}
              </button>
            ))}
          </div>
          {/* Connection status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className={isConnected ? 'dot-live' : 'dot-err'} />
            {!isMobile && (
              <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>
                {isConnected ? 'live' : 'offline'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* Sidebar — desktop only, only on chat tab */}
        {!isMobile && tab === 'chat' && (
          <aside style={{ width: 200, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {mode === 'multi' || mode === 'hybrid' ? 'Pipeline' : mode === 'kimi' ? 'Kimi K2.5' : 'LLaMA 70B'}
              </p>
            </div>
            <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => {
                if ((mode === 'solo' || mode === 'kimi') && id !== 'synthesizer') return null;
                const s = aStatus[id];
                return (
                  <div key={id} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${s !== 'idle' ? a.color + '30' : 'var(--border)'}`, background: s !== 'idle' ? a.color + '08' : 'var(--bg)', transition: 'all 0.2s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14 }}>{a.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: s !== 'idle' ? a.color : 'var(--ink2)', fontFamily: 'var(--f-body)', flex: 1 }}>{a.label}</span>
                      <div className={s === 'done' ? 'dot-done' : s === 'thinking' ? 'dot-live' : 'dot-idle'} style={{ background: s === 'thinking' ? a.color : undefined }} />
                    </div>
                    <div style={{ height: 2, background: s === 'done' ? a.color : s === 'thinking' ? a.color : 'var(--border)', borderRadius: 1, animation: s === 'thinking' ? 'bar-fill 2s ease-out forwards' : 'none', opacity: s === 'idle' ? 0.3 : 1 }} />
                  </div>
                );
              })}
            </div>
            {selRepos.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>⬡ {selRepos.length} repo{selRepos.length !== 1 ? 's' : ''}</p>
                <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>Knowledge active</p>
              </div>
            )}
          </aside>
        )}

        {/* Main content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>

          {/* ── CHAT ─────────────────────────────────────────────────── */}
          {tab === 'chat' && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
                {msgs.length === 0 ? (
                  <ChatEmpty mode={mode} selRepos={selRepos} onSelect={text => { setInput(text); }} isMobile={isMobile} />
                ) : (
                  <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {msgs.map(m => <ChatBubble key={m.id} msg={m} isMobile={isMobile} />)}
                    {loading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 14, color: 'white' }}>S</span>
                        </div>
                        <div style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {[0, 1, 2].map(i => (
                            <div key={i} className="dot-live" style={{ width: 6, height: 6, animationDelay: `${i * 0.2}s` }} />
                          ))}
                          <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Sara thinking…</span>
                        </div>
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div style={{ flexShrink: 0, padding: isMobile ? '10px 14px 14px' : '16px 24px 20px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                {errMsg && (
                  <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, fontFamily: 'var(--f-mono)', lineHeight: 1.5 }}>
                    {errMsg}
                  </div>
                )}
                <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8 }}>
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={mode === 'multi' ? 'Multi-agent mode…' : 'Ask Sara anything — web, code, architecture…'}
                    rows={isMobile ? 1 : 2}
                    disabled={loading}
                    className="sara-input"
                    style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || loading}
                    className="btn-primary"
                    style={{ padding: isMobile ? '0 14px' : '0 20px', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'stretch', flexShrink: 0 }}
                  >
                    {loading ? <Spin /> : <Icon name="send" size={14} />}
                    {!isMobile && (loading ? 'Wait' : 'Send')}
                  </button>
                </div>
                {!isMobile && (
                  <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
                    {mode === 'kimi' ? 'Kimi K2.5 · NIM' : mode === 'hybrid' ? 'Kimi K2.5 × LLaMA 3.3 70B · Hybrid' : 'LLaMA 3.3 70B · Groq'} · TinyFish · Enter ↵
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── MARKET ───────────────────────────────────────────────── */}
          {tab === 'market' && (
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <MarketTab
                repos={repos} templates={MARKET_TEMPLATES}
                assocResult={assocResult} associating={associating}
                assocGoal={assocGoal} setAssocGoal={setAssocGoal}
                assocPhase={assocPhase} errMsg={errMsg}
                toggleRepo={toggleRepo} selRepos={selRepos}
                onAssociate={() => associate()} onBuildTemplate={buildFromTemplate}
                activeTemplate={activeTemplate} isMobile={isMobile}
              />
            </div>
          )}

          {/* ── REPOS ────────────────────────────────────────────────── */}
          {tab === 'repos' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <ReposTab
                repos={repos} repoInput={repoInput} setRepoInput={setRepoInput}
                onSync={syncRepo} syncing={syncing} syncMsg={syncMsg}
                onToggle={toggleRepo} bulkSyncing={bulkSyncing}
                bulkProgress={bulkProgress} onBulkSync={bulkSync}
              />
            </div>
          )}

          {/* ── SETTINGS ─────────────────────────────────────────────── */}
          {tab === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <SettingsTab cfg={cfg} onChange={s => { setCfg(s); saveCfg(s); }} envUrl={ENV_URL} envKey={ENV_KEY} />
            </div>
          )}
        </main>
      </div>

      {/* ── MOBILE BOTTOM NAV ───────────────────────────────────────────── */}
      {isMobile && (
        <nav style={{
          flexShrink: 0, display: 'flex', background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -2px 12px rgba(26,14,8,0.08)',
          zIndex: 20, paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {navTabs.map(([t, icon]) => {
            const labels: Record<Tab, string> = { chat: 'Chat', market: 'Market', repos: 'Repos', settings: 'Settings' };
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '10px 4px 10px', border: 'none', cursor: 'pointer',
                  background: 'transparent', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3,
                  color: active ? 'var(--ink)' : 'var(--ink4)',
                  transition: 'all 0.15s', position: 'relative',
                }}>
                {active && (
                  <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 24, height: 2, borderRadius: '0 0 2px 2px', background: 'var(--red)' }} />
                )}
                <Icon name={icon} size={active ? 20 : 18} />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, fontFamily: 'var(--f-mono)', lineHeight: 1 }}>
                  {labels[t]}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT EMPTY — suggestion cards are now clickable
// ═══════════════════════════════════════════════════════════════════════════
function ChatEmpty({ mode, selRepos, onSelect, isMobile }: {
  mode: Mode; selRepos: Repo[]; onSelect: (text: string) => void; isMobile: boolean;
}) {
  const suggestions = [
    { t: 'Scrape competitor prices live', d: 'Scrapling + TinyFish extract structured data from any site', c: 'var(--red)' },
    { t: 'Build a RAG chatbot', d: 'Supabase pgvector + LangChain + streaming chat interface', c: 'var(--blue)' },
    { t: 'Train an LLM from scratch', d: 'Based on rasbt/LLMs-from-scratch + llama.cpp inference', c: 'var(--ink)' },
    { t: 'Create an AI agent pipeline', d: 'microsoft/ai-agents-for-beginners + tool use + memory', c: 'var(--green)' },
  ];

  return (
    <div style={{ maxWidth: 780, margin: isMobile ? '16px auto 0' : '40px auto 0', paddingBottom: 16 }}>
      {/* Hero */}
      <div style={{ marginBottom: isMobile ? 24 : 32, display: 'flex', alignItems: 'flex-start', gap: isMobile ? 14 : 20 }}>
        <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: isMobile ? 14 : 16, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow)' }}>
          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: isMobile ? 24 : 28, color: 'white' }}>S</span>
        </div>
        <div>
          <h1 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 26 : 36, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Hello, I'm Sara
          </h1>
          <p style={{ color: 'var(--ink2)', fontSize: isMobile ? 13 : 15, marginTop: 6 }}>
            {mode === 'multi'
              ? '4 specialized agents analyzing your request in sequence'
              : 'Your AI engineering partner — live web + GitHub knowledge'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="chip chip-ink">LLaMA 3.3 70B</span>
            <span className="chip chip-red">Scrapling</span>
            <span className="chip chip-blue">TinyFish</span>
            <span className="chip chip-green">pgvector RAG</span>
            {selRepos.length > 0 && <span className="chip chip-amber">⬡ {selRepos.length} repos active</span>}
          </div>
        </div>
      </div>

      {/* Clickable suggestions */}
      <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Tap to try →
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 8 : 12 }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s.t)}
            style={{
              padding: 16, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)',
              background: 'var(--surface)', borderRadius: 'var(--r)',
              boxShadow: 'var(--shadow-sm)', transition: 'all 0.15s',
              width: '100%', fontFamily: 'var(--f-body)',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow = 'var(--shadow)';
              el.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow = 'var(--shadow-sm)';
              el.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ width: 4, height: 24, borderRadius: 2, background: s.c, marginBottom: 10 }} />
            <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{s.t}</p>
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>{s.d}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT BUBBLE
// ═══════════════════════════════════════════════════════════════════════════
function ChatBubble({ msg, isMobile }: { msg: Msg; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const html = msg.role === 'sara' ? (marked.parse(msg.content) as string) : '';
  const isUser = msg.role === 'user';

  return (
    <div className="anim-up">
      {isUser ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            maxWidth: isMobile ? '85%' : '72%',
            padding: '12px 16px',
            borderRadius: '16px 16px 4px 16px',
            background: 'var(--ink)', color: 'white',
            fontSize: 14, lineHeight: 1.6,
            boxShadow: 'var(--shadow-sm)', wordBreak: 'break-word',
          }}>
            {msg.content}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 13, color: 'white' }}>S</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Sara</span>
            {msg.mode === 'multi' && <span className="chip chip-red" style={{ fontSize: 10 }}>4-agent</span>}
            {msg.ragUsed && <span className="chip chip-green" style={{ fontSize: 10 }}>⬡ RAG</span>}
            {msg.webUsed && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live</span>}
            {msg.err && <span className="chip chip-ink" style={{ fontSize: 10, color: 'var(--red)' }}>error</span>}
            {msg.durationMs && (
              <span style={{ fontSize: 11, color: 'var(--ink4)', marginLeft: 'auto', fontFamily: 'var(--f-mono)' }}>
                {(msg.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="card" style={{ padding: isMobile ? '14px 16px' : '16px 20px', borderLeft: msg.err ? '3px solid var(--red)' : '3px solid var(--border)', overflowX: 'auto' }}>
            <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {msg.agentOutputs && (
            <div style={{ marginTop: 8, marginLeft: 4 }}>
              <button onClick={() => setOpen(!open)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'var(--f-mono)' }}>
                <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
                Agent breakdown
              </button>
              {open && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                  {(Object.entries(msg.agentOutputs) as [AgentId, string][]).map(([id, out]) => {
                    const a = AGENTS[id]; if (!a || !out) return null;
                    return (
                      <div key={id} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${a.color}` }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: a.color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {a.icon} {a.label}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                          {out.slice(0, 220)}{out.length > 220 ? '…' : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSOCIATION MARKET
// ═══════════════════════════════════════════════════════════════════════════
function MarketTab({ repos, templates, assocResult, associating, assocGoal, setAssocGoal, assocPhase, errMsg, toggleRepo, selRepos, onAssociate, onBuildTemplate, activeTemplate, isMobile }: {
  repos: Repo[]; templates: MarketTemplate[]; assocResult: AssocResult | null;
  associating: boolean; assocGoal: string; setAssocGoal: (v: string) => void;
  assocPhase: string; errMsg: string; toggleRepo: (id: string) => void;
  selRepos: Repo[]; onAssociate: () => void; onBuildTemplate: (t: MarketTemplate) => void;
  activeTemplate: MarketTemplate | null; isMobile: boolean;
}) {
  const difficultyColor: Record<string, string> = { starter: 'var(--green)', intermediate: 'var(--amber)', advanced: 'var(--red)' };

  return (
    <div style={{ padding: isMobile ? '16px 14px' : 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 22 : 28, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>
                Association Market
              </h2>
              <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: 520 }}>
                Combine GitHub repos into fully functional services.
              </p>
            </div>
            {selRepos.length >= 2 && (
              <button className="btn-red" onClick={onAssociate} disabled={associating}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {associating ? <><Spin /> {assocPhase || 'Building…'}</> : <><Icon name="zap" size={14} /> Build {selRepos.length} repos</>}
              </button>
            )}
          </div>
        </div>

        {errMsg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12 }}>
            {errMsg}
          </div>
        )}

        {assocResult && <AssocResultCard result={assocResult} />}

        {/* Custom association */}
        <div className="card" style={{ padding: isMobile ? 16 : 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>⚗️</span>
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Custom Association</p>
            <span className="chip chip-red" style={{ fontSize: 10 }}>Sara exclusive</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 12 }}>
            Select repos below, describe your goal, and Sara generates the complete service.
          </p>
          <input value={assocGoal} onChange={e => setAssocGoal(e.target.value)}
            placeholder="e.g. Build a competitor price monitor that scrapes 10 sites every hour…"
            className="sara-input" style={{ marginBottom: 12 }}
          />
          {repos.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {repos.slice(0, 16).map(r => (
                <button key={r.id} onClick={() => toggleRepo(r.id)}
                  style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${r.selected ? 'var(--red)' : 'var(--border)'}`, background: r.selected ? 'var(--red-s)' : 'transparent', color: r.selected ? 'var(--red)' : 'var(--ink2)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--f-mono)', transition: 'all 0.15s' }}>
                  {r.selected ? '✓ ' : ''}{r.owner}/{r.repo}
                </button>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--ink4)', marginBottom: 12 }}>
              No repos indexed. Go to <strong>Repos</strong> tab and bulk-sync first.
            </p>
          )}
          <button className="btn-primary" onClick={onAssociate} disabled={associating || selRepos.length < 2}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {associating ? <><Spin /> {assocPhase}</> : <><Icon name="zap" size={14} /> Generate Service ({selRepos.length} repos selected)</>}
          </button>
        </div>

        {/* Templates */}
        <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
          Ready-to-Build Templates
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
          {templates.map(t => {
            const isActive = activeTemplate?.id === t.id;
            return (
              <div key={t.id}
                className="market-card"
                style={{ border: isActive ? `2px solid ${t.color}` : undefined, cursor: 'pointer' }}
                onClick={() => onBuildTemplate(t)}
              >
                <div style={{ padding: '16px 16px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: t.color + '15', border: `1px solid ${t.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      {t.icon}
                    </div>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: difficultyColor[t.difficulty] + '15', color: difficultyColor[t.difficulty], border: `1px solid ${difficultyColor[t.difficulty]}30`, fontFamily: 'var(--f-mono)' }}>
                      {t.difficulty}
                    </span>
                  </div>
                  <h4 style={{ fontFamily: 'var(--f-head)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{t.name}</h4>
                  <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, marginBottom: 12 }}>{t.description}</p>
                </div>
                <div style={{ padding: '10px 16px', background: 'var(--bg)', display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--border)' }}>
                  {t.repos.map(r => (
                    <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>
                      {r.split('/')[1]}
                    </span>
                  ))}
                </div>
                <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: t.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="zap" size={12} /> Build this
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{t.category}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSOCIATION RESULT
// ═══════════════════════════════════════════════════════════════════════════
function AssocResultCard({ result }: { result: AssocResult }) {
  const [activeTab, setActiveTab] = useState<'arch' | 'code' | 'deploy'>('arch');
  const content = activeTab === 'arch' ? result.architecture : activeTab === 'code' ? result.starter_code : result.deployment_strategy;
  const html = marked.parse(content) as string;

  return (
    <div className="card-float" style={{ marginBottom: 24, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(139,26,26,0.04), rgba(26,14,8,0.02))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="chip chip-red" style={{ fontSize: 10 }}>generated</span>
              <span className="chip chip-green" style={{ fontSize: 10 }}>{result.duration_seconds.toFixed(1)}s</span>
              {result.live_web_used && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live</span>}
            </div>
            <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{result.service_name}</h3>
            <p style={{ color: 'var(--ink2)', fontSize: 13 }}>{result.tagline}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 260 }}>
            {result.repos_combined.map(r => (
              <span key={r.repo} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--s3)', border: '1px solid var(--border)', color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>
                {r.owner}/{r.repo}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', overflowX: 'auto' }}>
        {([['arch', 'Architecture'], ['code', 'Starter Code'], ['deploy', 'Deploy Guide']] as ['arch' | 'code' | 'deploy', string][]).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', background: 'transparent', color: activeTab === t ? 'var(--red)' : 'var(--ink3)', borderBottom: `2px solid ${activeTab === t ? 'var(--red)' : 'transparent'}`, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ padding: '20px 24px', overflowX: 'auto' }}>
        <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REPOS TAB
// ═══════════════════════════════════════════════════════════════════════════
function ReposTab({ repos, repoInput, setRepoInput, onSync, syncing, syncMsg, onToggle, bulkSyncing, bulkProgress, onBulkSync }: {
  repos: Repo[]; repoInput: string; setRepoInput: (v: string) => void;
  onSync: () => void; syncing: boolean; syncMsg: string; onToggle: (id: string) => void;
  bulkSyncing: boolean; bulkProgress: string; onBulkSync: (preset: string) => void;
}) {
  const presets = [
    { key: 'top20', label: 'Top 20 AI/ML', desc: 'jackfrued, microsoft, rasbt, openai…', count: 20 },
    { key: 'scraping', label: 'Web Scraping', desc: 'Scrapling, TinyFish, Scrapy…', count: 5 },
    { key: 'ai', label: 'AI/LLM Stack', desc: 'LangChain, HuggingFace, llama.cpp…', count: 5 },
    { key: 'supabase_stack', label: 'SaaS Stack', desc: 'Supabase, Next.js, Tailwind…', count: 5 },
  ];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
          GitHub Knowledge Base
        </h2>
        <p style={{ color: 'var(--ink2)', fontSize: 14 }}>Index repos into pgvector. Sara uses them as live context.</p>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Bulk Index — Pre-built Packs</p>
          <span className="chip chip-amber" style={{ fontSize: 10 }}>1-click</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {presets.map(p => (
            <button key={p.key} onClick={() => onBulkSync(p.key)} disabled={bulkSyncing}
              className="btn-ghost" style={{ textAlign: 'left', padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>{p.label}</p>
                <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{p.desc}</p>
              </div>
              <span className="chip chip-ink" style={{ fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{p.count}</span>
            </button>
          ))}
        </div>
        {bulkSyncing && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spin />
            <span style={{ fontSize: 12, color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>Syncing…</span>
          </div>
        )}
        {bulkProgress && (
          <p style={{ marginTop: 10, fontSize: 12, fontFamily: 'var(--f-mono)', color: bulkProgress.startsWith('✓') ? 'var(--green)' : bulkProgress.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>
            {bulkProgress}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>Add Single Repository</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={repoInput} onChange={e => setRepoInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSync()}
            placeholder="owner/repo or https://github.com/owner/repo"
            className="sara-input" style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={onSync} disabled={syncing || !repoInput.trim()}
            style={{ padding: '0 20px', flexShrink: 0 }}>
            {syncing ? <><Spin /> Indexing…</> : 'Index'}
          </button>
        </div>
        {syncMsg && (
          <p style={{ marginTop: 8, fontSize: 12, fontFamily: 'var(--f-mono)', color: syncMsg.startsWith('✓') ? 'var(--green)' : syncMsg.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>
            {syncMsg}
          </p>
        )}
      </div>

      {repos.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>◇</p>
          <p style={{ color: 'var(--ink3)' }}>No repos indexed yet. Use Bulk Index above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {repos.map(r => (
            <div key={r.id} className="card" onClick={() => onToggle(r.id)}
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', border: r.selected ? '1px solid var(--red)' : undefined, background: r.selected ? 'var(--red-s)' : undefined, transition: 'all 0.15s' }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${r.selected ? 'var(--red)' : 'var(--border2)'}`, background: r.selected ? 'var(--red)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                {r.selected && <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--f-mono)', color: r.selected ? 'var(--red)' : 'var(--ink)' }}>{r.owner}/{r.repo}</span>
                  {r.language && <span className="chip chip-ink" style={{ fontSize: 10 }}>{r.language}</span>}
                </div>
                {r.description && <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{r.description.slice(0, 80)}</p>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 12, color: 'var(--amber)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>★ {r.stars?.toLocaleString()}</p>
                <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{r.chunk_count} chunks</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS TAB — shows env var status, no manual credential input if env set
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ cfg, onChange, envUrl, envKey }: {
  cfg: Settings; onChange: (s: Settings) => void; envUrl: string; envKey: string;
}) {
  const [local, setLocal] = useState(cfg);
  const set = (k: keyof Settings, v: string | number | boolean) => setLocal(p => ({ ...p, [k]: v }));

  function Section({ title, color = 'var(--ink)', children }: { title: string; color?: string; children: React.ReactNode }) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
          {title}
        </p>
        {children}
      </div>
    );
  }

  function Field({ label, field, type = 'text', ph, hint }: { label: string; field: keyof Settings; type?: string; ph?: string; hint?: string }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>
          {label}
        </label>
        <input type={type} value={String(local[field])} onChange={e => set(field, e.target.value)} placeholder={ph}
          className="sara-input" style={{ fontFamily: type === 'password' ? 'var(--f-mono)' : 'var(--f-body)' }} />
        {hint && <p style={{ marginTop: 5, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{hint}</p>}
      </div>
    );
  }

  const models = [
    { value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B — Best quality' },
    { value: 'llama-3.1-70b-versatile', label: 'LLaMA 3.1 70B — Fast' },
    { value: 'llama-3.1-8b-instant', label: 'LLaMA 3.1 8B — Ultra fast' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B — 32k context' },
    { value: 'gemma2-9b-it', label: 'Gemma 2 9B — Google' },
  ];
  const personas = [
    { value: 'engineer', label: '🏗️ Principal Engineer — architecture-first' },
    { value: 'researcher', label: '🔬 Research Scientist — papers, citations' },
    { value: 'founder', label: '🚀 Technical Co-Founder — product × engineering' },
    { value: 'tutor', label: '📚 Patient Tutor — step by step' },
    { value: 'hacker', label: '⚡ Speed Hacker — fast, direct' },
  ];

  const hasEnvCreds = envUrl && envKey;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Configuration</h2>
      </div>

      {/* Supabase */}
      <Section title="◈ Supabase — Backend" color="var(--red)">
        {hasEnvCreds ? (
          <div style={{ padding: 14, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.25)' }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 4 }}>
              ✓ Connected via Vercel environment variables
            </p>
            <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
              VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are injected at build time. No manual configuration needed. To change them, update the variables in Vercel Dashboard → Settings → Environment Variables, then redeploy.
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>
                ⚠ Not connected
              </p>
              <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                Recommended: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Dashboard → Settings → Environment Variables, then redeploy. Or enter manually below.
              </p>
            </div>
            <Field label="Project URL" field="supabaseUrl" ph="https://xxxx.supabase.co" hint="Supabase Dashboard → Settings → API → Project URL" />
            <Field label="Anon Key" field="supabaseKey" type="password" ph="eyJhbGci…" hint="Supabase Dashboard → Settings → API → anon public key" />
          </>
        )}
      </Section>

      {/* AI */}
      <Section title="⚡ AI Model — Groq" color="var(--green)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.2)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>Groq API key → Supabase Secret</p>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 2, lineHeight: 1.6 }}>
            Supabase Dashboard → Edge Functions → Secrets → Add GROQ_API_KEY=gsk_…
          </p>
          <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--green)', display: 'block', marginTop: 4 }}>
            → Free key at console.groq.com
          </a>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>
            Model
          </label>
          <select value={local.model} onChange={e => set('model', e.target.value)} className="sara-input" style={{ cursor: 'pointer' }}>
            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>
            Persona
          </label>
          <select value={local.persona} onChange={e => set('persona', e.target.value)} className="sara-input" style={{ cursor: 'pointer' }}>
            {personas.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </Section>

      {/* Web */}
      <Section title="🌐 Live Web Intelligence" color="var(--blue)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--blue-s)', border: '1px solid rgba(26,74,139,0.2)' }}>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
            Set TINYFISH_API_KEY as Supabase Secret to enable live web browsing.
          </p>
          <a href="https://tinyfish.ai" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--blue)', display: 'block', marginTop: 2 }}>
            → Free key at tinyfish.ai
          </a>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={local.webEnabled} onChange={e => set('webEnabled', e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--red)' }} />
            Web browsing
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={local.scrapingEnabled} onChange={e => set('scrapingEnabled', e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--red)' }} />
            Scrapling
          </label>
        </div>
      </Section>

      {/* Generation params */}
      <Section title="◆ Generation Parameters" color="var(--ink2)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Temperature', field: 'temperature' as const, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), note: '0 = precise · 2 = wild' },
            { label: 'Max Tokens', field: 'maxTokens' as const, min: 512, max: 8192, step: 256, fmt: (v: number) => v.toLocaleString(), note: 'Max response length' },
            { label: 'Context', field: 'contextWindow' as const, min: 2, max: 20, step: 1, fmt: (v: number) => `${v} msgs`, note: 'Messages history' },
            { label: 'RAG Chunks', field: 'ragChunks' as const, min: 1, max: 15, step: 1, fmt: (v: number) => `${v}`, note: 'Knowledge per query' },
          ].map(p => (
            <div key={p.field}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>{p.label}</label>
                <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>{p.fmt(Number(local[p.field]))}</span>
              </div>
              <input type="range" min={p.min} max={p.max} step={p.step} value={Number(local[p.field])} onChange={e => set(p.field, Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--red)' }} />
              <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 3 }}>{p.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* System prompt */}
      <Section title="◈ Custom System Prompt" color="var(--ink3)">
        <textarea value={local.systemPrompt} onChange={e => set('systemPrompt', e.target.value)}
          placeholder="Leave empty to use Sara's default engineering persona…"
          className="sara-input" rows={4} style={{ resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
        <p style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 6 }}>
          Injected AFTER Sara's core identity. Use to add domain expertise.
        </p>
      </Section>

      {/* Deploy guide */}
      <div className="card" style={{ padding: 20, marginBottom: 20, background: 'var(--ink)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Complete Deploy Checklist
        </p>
        <pre style={{ fontSize: 11, lineHeight: 2, color: '#90e080', fontFamily: 'var(--f-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{`# ── Vercel Environment Variables ────────────────
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci…

# ── Supabase Secrets (Edge Functions) ────────────
GROQ_API_KEY=gsk_...          # required
TINYFISH_API_KEY=tf_...        # optional (web browsing)
GITHUB_TOKEN=ghp_...           # optional (higher rate limits)

# ── Deploy Edge Functions ─────────────────────────
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase functions deploy chat
npx supabase functions deploy multiagent
npx supabase functions deploy associate
npx supabase functions deploy github-sync
npx supabase functions deploy bulk-sync

# ── Run DB Migration ──────────────────────────────
npx supabase db push`}</pre>
      </div>

      <button className="btn-red" onClick={() => onChange(local)}
        style={{ width: '100%', padding: '14px 20px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow)' }}>
        <Icon name="check" size={16} /> Save Configuration
      </button>
    </div>
  );
}
