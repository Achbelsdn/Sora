
import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';
marked.setOptions({ breaks: true, gfm: true });

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'chat' | 'market' | 'repos' | 'settings';
type Mode = 'solo' | 'multi';
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
  color: string; icon: string;
  description: string;
}
interface Settings {
  supabaseUrl: string; supabaseKey: string; groqKey: string;
  githubToken: string; tinyfishKey: string; scraplingKey: string;
  model: string; temperature: number; maxTokens: number;
  systemPrompt: string; contextWindow: number;
  ragChunks: number; webEnabled: boolean; scrapingEnabled: boolean;
  persona: string;
}

// ── Agents ────────────────────────────────────────────────────────────────
const AGENTS: Record<AgentId, { label: string; color: string; icon: string }> = {
  researcher:  { label: 'Researcher',  color: '#1a4a8b', icon: '🔍' },
  analyst:     { label: 'Architect',   color: '#1a7a4a', icon: '🏗️' },
  critic:      { label: 'Critic',      color: '#8b1a1a', icon: '⚡' },
  synthesizer: { label: 'Synthesizer', color: '#7a4a0a', icon: '✦' },
};

// ── Market templates ──────────────────────────────────────────────────────
const MARKET_TEMPLATES: MarketTemplate[] = [
  {
    id: 'neural-scraper',
    name: 'NeuralScraper',
    tagline: 'Web intelligence platform — Scrapling + TinyFish + LLaMA',
    category: 'Web Intelligence',
    repos: ['D4Vinci/Scrapling', 'tinyfish-io/tinyfish-cookbook'],
    difficulty: 'intermediate',
    color: '#8b1a1a',
    icon: '🕷️',
    description: 'Adaptive scraping with anti-bot bypass + AI-powered data extraction. Handles Cloudflare, dynamic JS, auto-recovers broken selectors.',
  },
  {
    id: 'llm-data-forge',
    name: 'LLM DataForge',
    tagline: 'Live data pipeline — LLM App + Data Engineer Handbook',
    category: 'Data Pipeline',
    repos: ['pathwaycom/llm-app', 'DataExpert-io/data-engineer-handbook'],
    difficulty: 'advanced',
    color: '#1a4a8b',
    icon: '⚙️',
    description: 'Real-time LLM data pipeline with streaming ingestion, vector indexing, and production data engineering patterns.',
  },
  {
    id: 'agent-academy',
    name: 'AgentAcademy',
    tagline: 'AI agent builder — ai-agents-for-beginners + openai-cookbook',
    category: 'AI Agents',
    repos: ['microsoft/ai-agents-for-beginners', 'openai/openai-cookbook'],
    difficulty: 'starter',
    color: '#1a7a4a',
    icon: '🤖',
    description: 'Build autonomous AI agents using Microsoft best practices + OpenAI patterns. Includes tool use, memory, and planning loops.',
  },
  {
    id: 'vision-api',
    name: 'VisionAPI',
    tagline: 'Image generation service — Stable Diffusion + SAM + CLIP',
    category: 'Computer Vision',
    repos: ['CompVis/stable-diffusion', 'facebookresearch/segment-anything', 'openai/CLIP'],
    difficulty: 'advanced',
    color: '#7a4a0a',
    icon: '🎨',
    description: 'Image generation + segmentation + understanding pipeline. Generate, segment, and semantically search images in one API.',
  },
  {
    id: 'llm-from-scratch',
    name: 'TrainYourLLM',
    tagline: 'Build and train LLMs from scratch',
    category: 'Foundation Models',
    repos: ['rasbt/LLMs-from-scratch', 'ggerganov/llama.cpp'],
    difficulty: 'advanced',
    color: '#4a1a7a',
    icon: '🧠',
    description: 'Full LLM training pipeline from tokenizer to transformer, with llama.cpp for efficient local inference.',
  },
  {
    id: 'data-science-hub',
    name: 'DataScienceHub',
    tagline: 'End-to-end ML platform — Python 100 Days + Pandas + TF',
    category: 'Machine Learning',
    repos: ['jackfrued/Python-100-Days', 'aymericdamien/TensorFlow-Examples'],
    difficulty: 'starter',
    color: '#1a6a4a',
    icon: '📊',
    description: 'Complete data science environment with Python best practices, TensorFlow examples, and structured learning path.',
  },
];

// ── Defaults & persistence ────────────────────────────────────────────────
const DEFAULTS: Settings = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseKey: import.meta.env.VITE_SUPABASE_KEY ?? '',
  groqKey: import.meta.env.VITE_GROQ_KEY ?? '',
  githubToken: import.meta.env.VITE_GITHUB_TOKEN ?? '',
  tinyfishKey: import.meta.env.VITE_TINYFISH_KEY ?? '',
  scraplingKey: import.meta.env.VITE_SCRAPLING_KEY ?? '',
  model: 'llama-3.3-70b-versatile',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  contextWindow: 10,
  ragChunks: 5,
  webEnabled: true,
  scrapingEnabled: true,
  persona: 'engineer',
};
function loadCfg(): Settings { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('sara2_cfg') ?? '{}') }; } catch { return DEFAULTS; } }
function saveCfg(s: Settings) { localStorage.setItem('sara2_cfg', JSON.stringify(s)); }

// ── Icon components ───────────────────────────────────────────────────────
function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, string> = {
    chat:    'M8 12h8M8 8h12M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5l-4 4V6z',
    market:  'M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z',
    repos:   'M4 4h16v3H4zM4 10.5h16v3H4zM4 17h16v3H4z',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h2M20 12h2M12 2v2M12 20v2',
    send:    'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    search:  'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
    web:     'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM2 12h20M12 2c-3 4-3 16 0 20M12 2c3 4 3 16 0 20',
    zap:     'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    check:   'M20 6L9 17l-5-5',
    x:       'M18 6L6 18M6 6l12 12',
    plus:    'M12 5v14M5 12h14',
    star:    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    layers:  'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    code:    'M16 18l6-6-6-6M8 6l-6 6 6 6',
    users:   'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    bot:     'M12 8V4H8M4 8h16v12H4V8zM9 13h6M9 17h6',
    brain:   'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z',
    eye:     'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    chevron: 'M9 18l6-6-6-6',
    arrow:   'M5 12h14M12 5l7 7-7 7',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    cpu:     'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v4M3 9H1m22 0h-2M3 9a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2',
    link:    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    package: 'M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
    trending:'M23 6l-9.5 9.5-5-5L1 18',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name] && <path d={paths[name]} />}
    </svg>
  );
}

function Spin({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M12 2A10 10 0 0 1 22 12" /></svg>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Sara() {
  const [tab, setTab] = useState<Tab>('chat');
  const [mode, setMode] = useState<Mode>('solo');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aStatus, setAStatus] = useState<Record<AgentId, AgentStatus>>({ researcher:'idle', analyst:'idle', critic:'idle', synthesizer:'idle' });
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

  const sb = cfg.supabaseUrl && cfg.supabaseKey ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

  useEffect(() => { if (sb) loadRepos(); }, [cfg.supabaseUrl, cfg.supabaseKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function loadRepos() {
    if (!sb) return;
    const { data } = await sb.from('github_repos').select('*').order('stars', { ascending: false });
    if (data) setRepos(data.map(r => ({ ...r, selected: false })));
  }

  const setA = (id: AgentId, s: AgentStatus) => setAStatus(p => ({ ...p, [id]: s }));
  const resetA = () => setAStatus({ researcher:'idle', analyst:'idle', critic:'idle', synthesizer:'idle' });

  // ── SEND ────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !sb) { if (!sb) setErrMsg('Configure Supabase in Settings'); return; }
    setInput(''); resetA(); setErrMsg('');
    setMsgs(p => [...p, { id: `u${Date.now()}`, role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);
    const history = msgs.slice(-cfg.contextWindow).map(m => ({ role: m.role === 'sara' ? 'assistant' : 'user', content: m.content }));
    try {
      const fn = mode === 'solo' ? 'chat' : 'multiagent';
      if (mode === 'multi') {
        const order: AgentId[] = ['researcher', 'analyst', 'critic', 'synthesizer'];
        let i = 0;
        const t = setInterval(() => { if (i > 0) setA(order[i - 1], 'done'); if (i < order.length) { setA(order[i], 'thinking'); i++; } else clearInterval(t); }, 2100);
      } else setA('synthesizer', 'thinking');
      const t0 = Date.now();
      const { data, error: fnErr } = await sb.functions.invoke(fn, {
        body: { message: text, session_id: sessionId, history, repos: repos.filter(r => r.selected).map(r => r.id) },
      });
      if (mode === 'solo') setA('synthesizer', 'done');
      else (Object.keys(AGENTS) as AgentId[]).forEach(k => setA(k, 'done'));
      if (fnErr) throw new Error(fnErr.message);
      if (data?.session_id) setSessionId(data.session_id);
      setMsgs(p => [...p, {
        id: `s${Date.now()}`, role: 'sara', content: data?.answer ?? 'No response', ts: Date.now(), mode,
        ragUsed: data?.rag_used, webUsed: data?.web_used, durationMs: Date.now() - t0,
        agentOutputs: mode === 'multi' ? { researcher: data?.researcher_findings, analyst: data?.analyst_analysis, critic: data?.critic_critique, synthesizer: data?.answer } : undefined,
      }]);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : 'Error';
      setErrMsg(m);
      setMsgs(p => [...p, { id: `e${Date.now()}`, role: 'sara', content: `**Connection Error**\n\n${m}\n\n→ Check Settings`, ts: Date.now(), err: true }]);
    } finally { setLoading(false); }
  }, [input, loading, mode, msgs, sb, repos, sessionId, cfg]);

  // ── ASSOCIATE ───────────────────────────────────────────────────────────
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
        body: { repo_ids: sel, custom_goal: goalOverride ?? assocGoal || undefined },
      });
      clearInterval(pt);
      if (fnErr) throw new Error(fnErr.message);
      if (!data?.success) throw new Error(data?.error ?? 'Failed');
      setAssocResult(data);
      setTab('market');
    } catch (e: unknown) { clearInterval(pt); setErrMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setAssociating(false); setAssocPhase(''); }
  }, [repos, sb, assocGoal]);

  // ── SYNC REPO ───────────────────────────────────────────────────────────
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

  // ── BULK SYNC ───────────────────────────────────────────────────────────
  const bulkSync = async (preset: string) => {
    if (!sb || bulkSyncing) return;
    setBulkSyncing(true); setBulkProgress(`Starting bulk sync (${preset})…`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('bulk-sync', { body: { use_preset: preset } });
      if (fnErr) throw new Error(fnErr.message);
      setBulkProgress(`✓ ${data.repos_succeeded}/${data.repos_processed} repos · ${data.total_chunks} chunks indexed`);
      await loadRepos();
    } catch (e: unknown) { setBulkProgress(`✗ ${e instanceof Error ? e.message : 'Error'}`); }
    finally { setBulkSyncing(false); }
  };

  const toggleRepo = (id: string) => setRepos(p => p.map(r => r.id === id ? { ...r, selected: !r.selected } : r));
  const selRepos = repos.filter(r => r.selected);

  // ── MARKET TEMPLATE BUILD ───────────────────────────────────────────────
  const buildFromTemplate = async (template: MarketTemplate) => {
    setActiveTemplate(template);
    setAssocGoal(template.description);
    // Find matching repo IDs
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

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', fontFamily: 'var(--f-body)' }} className="grain">

      {/* TOP BAR */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 56, background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--shadow-sm)', zIndex: 10 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 17, color: 'white' }}>S</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Sara</span>
              <span className="chip chip-ink" style={{ fontSize: 10 }}>1.0 02B</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', lineHeight: 1, marginTop: 1 }}>Groq · LLaMA 3.3 70B · Scrapling · TinyFish</p>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 4, borderRadius: 10 }}>
          {([['chat', 'chat', 'Chat'], ['market', 'layers', 'Association Market'], ['repos', 'repos', `Repos${repos.length > 0 ? ` (${repos.length})` : ''}`], ['settings', 'settings', 'Settings']] as [Tab, string, string][]).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', transition: 'all 0.15s', background: tab === t ? 'var(--surface)' : 'transparent', color: tab === t ? 'var(--ink)' : 'var(--ink3)', boxShadow: tab === t ? 'var(--shadow-sm)' : 'none' }}>
              <Icon name={icon} size={14} />
              {label}
            </button>
          ))}
        </nav>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', background: 'var(--bg2)', padding: 3, borderRadius: 8, gap: 2 }}>
            {(['solo', 'multi'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--f-mono)', transition: 'all 0.15s', background: mode === m ? (m === 'solo' ? 'var(--ink)' : 'var(--red)') : 'transparent', color: mode === m ? 'white' : 'var(--ink3)' }}>
                {m === 'solo' ? 'Solo' : '4-Agent'}
              </button>
            ))}
          </div>
          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className={isConnected ? 'dot-live' : 'dot-err'} />
            <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{isConnected ? 'live' : 'offline'}</span>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* AGENTS SIDEBAR */}
        {tab === 'chat' && (
          <aside style={{ width: 200, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{mode === 'multi' ? 'Pipeline' : 'Engine'}</p>
            </div>
            <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => {
                if (mode === 'solo' && id !== 'synthesizer') return null;
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

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ══ CHAT ══════════════════════════════════════════════════════ */}
          {tab === 'chat' && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                {msgs.length === 0 ? (
                  <ChatEmpty mode={mode} selRepos={selRepos} />
                ) : (
                  <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {msgs.map(m => <ChatBubble key={m.id} msg={m} />)}
                    {loading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 14, color: 'white' }}>S</span>
                        </div>
                        <div style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {[0, 1, 2].map(i => <div key={i} className="dot-live" style={{ width: 6, height: 6, animationDelay: `${i * 0.2}s` }} />)}
                          <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Sara thinking…</span>
                        </div>
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>
              {/* Input bar */}
              <div style={{ flexShrink: 0, padding: '16px 24px 20px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                {errMsg && <div style={{ marginBottom: 10, padding: '8px 14px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, fontFamily: 'var(--f-mono)' }}>{errMsg}</div>}
                <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 10 }}>
                  <textarea value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={mode === 'multi' ? 'Multi-agent: Researcher → Architect → Critic → Synth…' : 'Ask Sara anything — she can browse the live web…'}
                    rows={2} disabled={loading}
                    className="sara-input"
                    style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
                  />
                  <button onClick={send} disabled={!input.trim() || loading} className="btn-primary"
                    style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'stretch', flexShrink: 0 }}>
                    {loading ? <><Spin /> Wait</> : <><Icon name="send" size={14} /> Send</>}
                  </button>
                </div>
                <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
                  LLaMA 3.3 70B (Meta open-source) · Scrapling · TinyFish · Enter to send
                </p>
              </div>
            </>
          )}

          {/* ══ ASSOCIATION MARKET ════════════════════════════════════════ */}
          {tab === 'market' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <MarketTab
                repos={repos} templates={MARKET_TEMPLATES}
                assocResult={assocResult} associating={associating}
                assocGoal={assocGoal} setAssocGoal={setAssocGoal}
                assocPhase={assocPhase} errMsg={errMsg}
                toggleRepo={toggleRepo} selRepos={selRepos}
                onAssociate={() => associate()} onBuildTemplate={buildFromTemplate}
                activeTemplate={activeTemplate}
              />
            </div>
          )}

          {/* ══ REPOS ═════════════════════════════════════════════════════ */}
          {tab === 'repos' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <ReposTab
                repos={repos} repoInput={repoInput} setRepoInput={setRepoInput}
                onSync={syncRepo} syncing={syncing} syncMsg={syncMsg}
                onToggle={toggleRepo} bulkSyncing={bulkSyncing}
                bulkProgress={bulkProgress} onBulkSync={bulkSync}
              />
            </div>
          )}

          {/* ══ SETTINGS ══════════════════════════════════════════════════ */}
          {tab === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <SettingsTab cfg={cfg} onChange={s => { setCfg(s); saveCfg(s); }} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT EMPTY
// ═══════════════════════════════════════════════════════════════════════════
function ChatEmpty({ mode, selRepos }: { mode: Mode; selRepos: Repo[] }) {
  return (
    <div style={{ maxWidth: 780, margin: '40px auto 0' }}>
      <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow)' }}>
          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 28, color: 'white' }}>S</span>
        </div>
        <div>
          <h1 style={{ fontFamily: 'var(--f-head)', fontSize: 36, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1 }}>Hello, I'm Sara</h1>
          <p style={{ color: 'var(--ink2)', fontSize: 15, marginTop: 6 }}>
            {mode === 'multi' ? '4 specialized agents analyzing your request in sequence' : 'Your AI engineering partner — live web + GitHub knowledge'}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { t: 'Scrape competitor prices live', d: 'Scrapling + TinyFish extract structured data from any site', c: 'var(--red)' },
          { t: 'Build a RAG chatbot', d: 'Supabase pgvector + LangChain + streaming chat interface', c: 'var(--blue)' },
          { t: 'Train an LLM from scratch', d: 'Based on rasbt/LLMs-from-scratch + llama.cpp inference', c: 'var(--ink)' },
          { t: 'Create an AI agent pipeline', d: 'microsoft/ai-agents-for-beginners + tool use + memory', c: 'var(--green)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: 16, cursor: 'default' }}>
            <div style={{ width: 4, height: 28, borderRadius: 2, background: s.c, marginBottom: 10 }} />
            <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{s.t}</p>
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>{s.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT BUBBLE
// ═══════════════════════════════════════════════════════════════════════════
function ChatBubble({ msg }: { msg: Msg }) {
  const [open, setOpen] = useState(false);
  const html = msg.role === 'sara' ? marked.parse(msg.content) as string : '';
  const isUser = msg.role === 'user';

  return (
    <div className="anim-up">
      {isUser ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ maxWidth: '72%', padding: '12px 16px', borderRadius: '16px 16px 4px 16px', background: 'var(--ink)', color: 'white', fontSize: 14, lineHeight: 1.6, boxShadow: 'var(--shadow-sm)' }}>
            {msg.content}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 13, color: 'white' }}>S</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Sara</span>
            {msg.mode === 'multi' && <span className="chip chip-red" style={{ fontSize: 10 }}>4-agent</span>}
            {msg.ragUsed && <span className="chip chip-green" style={{ fontSize: 10 }}>⬡ RAG</span>}
            {msg.webUsed && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live</span>}
            {msg.err && <span className="chip chip-ink" style={{ fontSize: 10, color: 'var(--red)' }}>error</span>}
            {msg.durationMs && <span style={{ fontSize: 11, color: 'var(--ink4)', marginLeft: 'auto', fontFamily: 'var(--f-mono)' }}>{(msg.durationMs / 1000).toFixed(1)}s</span>}
          </div>
          <div className="card" style={{ padding: '16px 20px', borderLeft: msg.err ? '3px solid var(--red)' : '3px solid var(--border)' }}>
            <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {msg.agentOutputs && (
            <div style={{ marginTop: 8, marginLeft: 4 }}>
              <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'var(--f-mono)' }}>
                <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
                Agent breakdown
              </button>
              {open && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {(Object.entries(msg.agentOutputs) as [AgentId, string][]).map(([id, out]) => {
                    const a = AGENTS[id]; if (!a || !out) return null;
                    return (
                      <div key={id} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${a.color}` }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: a.color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{a.icon} {a.label}</p>
                        <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>{out.slice(0, 220)}{out.length > 220 ? '…' : ''}</p>
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
function MarketTab({ repos, templates, assocResult, associating, assocGoal, setAssocGoal, assocPhase, errMsg, toggleRepo, selRepos, onAssociate, onBuildTemplate, activeTemplate }: {
  repos: Repo[]; templates: MarketTemplate[]; assocResult: AssocResult | null;
  associating: boolean; assocGoal: string; setAssocGoal: (v: string) => void;
  assocPhase: string; errMsg: string; toggleRepo: (id: string) => void;
  selRepos: Repo[]; onAssociate: () => void; onBuildTemplate: (t: MarketTemplate) => void;
  activeTemplate: MarketTemplate | null;
}) {
  const categories = [...new Set(templates.map(t => t.category))];
  const difficultyColor: Record<string, string> = { starter: 'var(--green)', intermediate: 'var(--amber)', advanced: 'var(--red)' };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 28, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>Association Market</h2>
              <p style={{ color: 'var(--ink2)', fontSize: 14, maxWidth: 520 }}>
                Combine GitHub repos into fully functional services. Sara analyzes their APIs, designs the architecture, and generates production-ready starter code.
              </p>
            </div>
            {selRepos.length >= 2 && (
              <button className="btn-red" onClick={onAssociate} disabled={associating}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 20 }}>
                {associating ? <><Spin /> {assocPhase}</> : <><Icon name="zap" size={14} /> Build {selRepos.length} repos</>}
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {errMsg && <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12 }}>{errMsg}</div>}

        {/* Association result */}
        {assocResult && <AssocResultCard result={assocResult} />}

        {/* Custom association zone */}
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 16 }}>⚗️</span>
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Custom Association</p>
            <span className="chip chip-red" style={{ fontSize: 10 }}>Sara exclusive</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 12 }}>Select repos below, describe what you want to build, and Sara generates the complete service.</p>
          <input value={assocGoal} onChange={e => setAssocGoal(e.target.value)}
            placeholder="e.g. Build a competitor price monitor that scrapes 10 sites every hour…"
            className="sara-input" style={{ marginBottom: 12 }}
          />
          {/* Repo selector (compact) */}
          {repos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {repos.slice(0, 16).map(r => (
                <button key={r.id} onClick={() => toggleRepo(r.id)}
                  style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${r.selected ? 'var(--red)' : 'var(--border)'}`, background: r.selected ? 'var(--red-s)' : 'transparent', color: r.selected ? 'var(--red)' : 'var(--ink2)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--f-mono)', transition: 'all 0.15s' }}>
                  {r.selected ? '✓ ' : ''}{r.owner}/{r.repo}
                </button>
              ))}
            </div>
          )}
          {repos.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink4)', marginBottom: 12 }}>No repos indexed. Go to <strong>Repos</strong> tab and bulk-sync first.</p>}
          <button className="btn-primary" onClick={onAssociate} disabled={associating || selRepos.length < 2}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {associating ? <><Spin /> {assocPhase}</> : <><Icon name="zap" size={14} /> Generate Service ({selRepos.length} repos selected)</>}
          </button>
        </div>

        {/* Pre-built templates */}
        <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Ready-to-Build Templates</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {templates.map(t => {
            const isActive = activeTemplate?.id === t.id;
            return (
              <div key={t.id} className="market-card" style={{ border: isActive ? `2px solid ${t.color}` : undefined }}
                onClick={() => onBuildTemplate(t)}>
                <div style={{ padding: '16px 16px 0' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: t.color + '15', border: `1px solid ${t.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      {t.icon}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: difficultyColor[t.difficulty] + '15', color: difficultyColor[t.difficulty], border: `1px solid ${difficultyColor[t.difficulty]}30`, fontFamily: 'var(--f-mono)' }}>{t.difficulty}</span>
                    </div>
                  </div>
                  <h4 style={{ fontFamily: 'var(--f-head)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{t.name}</h4>
                  <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, marginBottom: 12 }}>{t.description}</p>
                </div>
                {/* Repos */}
                <div style={{ padding: '10px 16px', background: 'var(--bg)', display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--border)' }}>
                  {t.repos.map(r => (
                    <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{r.split('/')[1]}</span>
                  ))}
                </div>
                {/* CTA */}
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
// ASSOCIATION RESULT CARD
// ═══════════════════════════════════════════════════════════════════════════
function AssocResultCard({ result }: { result: AssocResult }) {
  const [activeTab, setActiveTab] = useState<'arch' | 'code' | 'deploy'>('arch');
  const content = activeTab === 'arch' ? result.architecture : activeTab === 'code' ? result.starter_code : result.deployment_strategy;
  const html = marked.parse(content) as string;

  return (
    <div className="card-float" style={{ marginBottom: 24, overflow: 'hidden' }}>
      {/* Result header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(139,26,26,0.04), rgba(26,14,8,0.02))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="chip chip-red" style={{ fontSize: 10 }}>generated</span>
              <span className="chip chip-green" style={{ fontSize: 10 }}>{result.duration_seconds.toFixed(1)}s</span>
              {result.live_web_used && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live web</span>}
            </div>
            <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{result.service_name}</h3>
            <p style={{ color: 'var(--ink2)', fontSize: 14 }}>{result.tagline}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 260, justifyContent: 'flex-end' }}>
            {result.repos_combined.map(r => (
              <span key={r.repo} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--s3)', border: '1px solid var(--border)', color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>{r.owner}/{r.repo}</span>
            ))}
          </div>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        {([['arch', 'Architecture'], ['code', 'Starter Code'], ['deploy', 'Deploy Guide']] as ['arch' | 'code' | 'deploy', string][]).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', background: 'transparent', color: activeTab === t ? 'var(--red)' : 'var(--ink3)', borderBottom: `2px solid ${activeTab === t ? 'var(--red)' : 'transparent'}`, transition: 'all 0.15s' }}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ padding: 24 }}>
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
    { key: 'top20', label: 'Top 20 AI/ML Repos', desc: 'jackfrued, microsoft, rasbt, openai…', count: 20 },
    { key: 'scraping', label: 'Web Scraping Stack', desc: 'Scrapling, TinyFish, Scrapy, Playwright…', count: 5 },
    { key: 'ai', label: 'AI/LLM Stack', desc: 'LangChain, HuggingFace, llama.cpp, Ollama…', count: 5 },
    { key: 'supabase_stack', label: 'SaaS Stack', desc: 'Supabase, Next.js, Tailwind, Vite…', count: 5 },
  ];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>GitHub Knowledge Base</h2>
        <p style={{ color: 'var(--ink2)', fontSize: 14 }}>Index repos into pgvector. Sara uses them as live context in every response.</p>
      </div>

      {/* Bulk sync presets */}
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
              <span className="chip chip-ink" style={{ fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{p.count} repos</span>
            </button>
          ))}
        </div>
        {bulkSyncing && <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Spin /><span style={{ fontSize: 12, color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>Syncing…</span></div>}
        {bulkProgress && <p style={{ marginTop: 10, fontSize: 12, fontFamily: 'var(--f-mono)', color: bulkProgress.startsWith('✓') ? 'var(--green)' : bulkProgress.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>{bulkProgress}</p>}
      </div>

      {/* Single repo */}
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
        {syncMsg && <p style={{ marginTop: 8, fontSize: 12, fontFamily: 'var(--f-mono)', color: syncMsg.startsWith('✓') ? 'var(--green)' : syncMsg.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>{syncMsg}</p>}
      </div>

      {/* Repos list */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
// SETTINGS TAB — Full AI Parameters
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ cfg, onChange }: { cfg: Settings; onChange: (s: Settings) => void }) {
  const [local, setLocal] = useState(cfg);
  const set = (k: keyof Settings, v: string | number | boolean) => setLocal(p => ({ ...p, [k]: v }));

  function Section({ title, color = 'var(--ink)', children }: { title: string; color?: string; children: React.ReactNode }) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>{title}</p>
        {children}
      </div>
    );
  }

  function Field({ label, field, type = 'text', ph, hint }: { label: string; field: keyof Settings; type?: string; ph?: string; hint?: string }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>{label}</label>
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
    { value: 'engineer', label: '🏗️ Principal Engineer — FAANG-level, architecture-first' },
    { value: 'researcher', label: '🔬 Research Scientist — papers, citations, analysis' },
    { value: 'founder', label: '🚀 Technical Co-Founder — product × engineering' },
    { value: 'tutor', label: '📚 Patient Tutor — explains step by step' },
    { value: 'hacker', label: '⚡ Speed Hacker — fast, direct, minimal explanation' },
  ];

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Configuration</h2>
        <span className="chip chip-ink">Sara 1.0 02B</span>
      </div>

      {/* Supabase */}
      <Section title="◈ Supabase — Backend" color="var(--red)">
        <Field label="Project URL" field="supabaseUrl" ph="https://xxxx.supabase.co" hint="Settings → API → Project URL" />
        <Field label="Anon Key" field="supabaseKey" type="password" ph="eyJhbGci…" hint="Settings → API → anon public" />
      </Section>

      {/* AI Model */}
      <Section title="⚡ AI Model — Groq" color="var(--green)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.2)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>LLaMA 3.3 70B (Meta, open-source)</p>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 2 }}>~800 tok/s · 14,400 req/day free · Rivals GPT-4o on benchmarks</p>
          <a href="https://console.groq.com" target="_blank" style={{ fontSize: 11, color: 'var(--green)', display: 'block', marginTop: 3 }}>→ Free key at console.groq.com</a>
        </div>
        <Field label="Groq API Key" field="groqKey" type="password" ph="gsk_…" hint="Also set as Supabase secret: GROQ_API_KEY" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>Model</label>
          <select value={local.model} onChange={e => set('model', e.target.value)} className="sara-input" style={{ appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%239a8070\' stroke-width=\'1.5\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', cursor: 'pointer' }}>
            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>Persona</label>
          <select value={local.persona} onChange={e => set('persona', e.target.value)} className="sara-input" style={{ appearance: 'none', cursor: 'pointer' }}>
            {personas.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </Section>

      {/* Web & Scraping */}
      <Section title="🌐 Live Web Intelligence" color="var(--blue)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--blue-s)', border: '1px solid rgba(26,74,139,0.2)' }}>
          <p style={{ fontSize: 12, color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>Scrapling (github.com/D4Vinci/Scrapling) — adaptive CSS, Cloudflare bypass, stealth mode</p>
          <p style={{ fontSize: 12, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 4 }}>TinyFish (tinyfish-cookbook) — real browser, any website as JSON API</p>
        </div>
        <Field label="TinyFish API Key" field="tinyfishKey" type="password" ph="tf_…" hint="Set as Supabase secret: TINYFISH_API_KEY — free at tinyfish.ai" />
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={local.webEnabled} onChange={e => set('webEnabled', e.target.checked)} style={{ width: 14, height: 14 }} />
            Web browsing enabled
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={local.scrapingEnabled} onChange={e => set('scrapingEnabled', e.target.checked)} style={{ width: 14, height: 14 }} />
            Scrapling enabled
          </label>
        </div>
      </Section>

      {/* GitHub */}
      <Section title="◇ GitHub" color="var(--amber)">
        <Field label="GitHub Token" field="githubToken" type="password" ph="ghp_… (optional for private repos)" hint="github.com/settings/tokens → repo:read" />
      </Section>

      {/* Generation parameters */}
      <Section title="◆ Generation Parameters" color="var(--ink2)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Temperature', field: 'temperature' as const, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), note: '0 = precise · 1 = creative · 2 = wild' },
            { label: 'Max Tokens', field: 'maxTokens' as const, min: 512, max: 8192, step: 256, fmt: (v: number) => v.toLocaleString(), note: 'Max response length' },
            { label: 'Context Window', field: 'contextWindow' as const, min: 2, max: 20, step: 1, fmt: (v: number) => `${v} msgs`, note: 'Previous messages to include' },
            { label: 'RAG Chunks', field: 'ragChunks' as const, min: 1, max: 15, step: 1, fmt: (v: number) => `${v} chunks`, note: 'GitHub knowledge injected per query' },
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

      {/* Custom system prompt */}
      <Section title="◈ Custom System Prompt" color="var(--ink3)">
        <textarea value={local.systemPrompt} onChange={e => set('systemPrompt', e.target.value)}
          placeholder="Leave empty to use Sara's default engineering persona…"
          className="sara-input" rows={4} style={{ resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
        <p style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 6 }}>Injected AFTER Sara's core identity. Use to add domain expertise or constraints.</p>
      </Section>

      {/* Deploy guide */}
      <div className="card" style={{ padding: 20, marginBottom: 20, background: 'var(--ink)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Deploy Guide</p>
        <pre style={{ fontSize: 11, lineHeight: 1.9, color: '#90e080', fontFamily: 'var(--f-mono)', overflowX: 'auto' }}>{`npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase functions deploy chat
npx supabase functions deploy multiagent
npx supabase functions deploy associate
npx supabase functions deploy github-sync
npx supabase functions deploy bulk-sync

# Supabase Dashboard → Edge Functions → Secrets
GROQ_API_KEY=gsk_...
TINYFISH_API_KEY=tf_...
GITHUB_TOKEN=ghp_...`}</pre>
      </div>

      <button className="btn-red" onClick={() => onChange(local)} style={{ width: '100%', padding: '14px 20px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow)' }}>
        <Icon name="check" size={16} /> Save Configuration
      </button>
    </div>
  );
}
