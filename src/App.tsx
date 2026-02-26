import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import { useIsMobile } from './hooks/use-mobile';
import { useAgentStream } from './hooks/use-agent-stream';
import LiveAgentPanel from './components/LiveAgentPanel';

marked.setOptions({ breaks: true, gfm: true });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
type Tab = 'chat' | 'market' | 'repos' | 'settings';
type Mode = 'llama' | 'gemini' | 'openrouter' | 'llama-gemini' | 'llama-openrouter' | 'gemini-openrouter' | 'multi';
type AgentId = 'researcher' | 'analyst' | 'critic' | 'synthesizer';
type AgentStatus = 'idle' | 'thinking' | 'done';
type ToastType = 'success' | 'error' | 'info';

interface AttachedFile {
  id: string; name: string; type: string; size: number;
  content: string; isImage: boolean; isText: boolean;
  url?: string; extracting?: boolean;
}
interface Msg {
  id: string; role: 'user' | 'sara'; content: string; ts: number;
  mode?: Mode; ragUsed?: boolean; webUsed?: boolean;
  durationMs?: number; err?: boolean;
  agentOutputs?: Partial<Record<AgentId, string>>;
  files?: AttachedFile[];
  reactions?: string[];
  pinned?: boolean;
}
interface ChatSession {
  id: string; title: string; mode: string;
  created_at: string; updated_at: string;
  message_count: number; preview: string;
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
interface Toast {
  id: string; type: ToastType; message: string; duration?: number;
}
interface Settings {
  supabaseUrl: string; supabaseKey: string; groqKey: string;
  githubToken: string; tinyfishKey: string; scraplingKey: string;
  model: string; temperature: number; maxTokens: number;
  systemPrompt: string; contextWindow: number;
  ragChunks: number; webEnabled: boolean; scrapingEnabled: boolean;
  persona: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const AGENTS: Record<AgentId, { label: string; color: string; icon: string }> = {
  researcher:  { label: 'Researcher',  color: '#1a4a8b', icon: '🔍' },
  analyst:     { label: 'Architect',   color: '#1a7a4a', icon: '🏗️' },
  critic:      { label: 'Critic',      color: '#8b1a1a', icon: '⚡' },
  synthesizer: { label: 'Synthesizer', color: '#7a4a0a', icon: '✦' },
};

const MARKET_TEMPLATES: MarketTemplate[] = [
  { id: 'neural-scraper', name: 'NeuralScraper', tagline: 'Web intelligence platform', category: 'Web Intelligence', repos: ['D4Vinci/Scrapling', 'tinyfish-io/tinyfish-cookbook'], difficulty: 'intermediate', color: '#8b1a1a', icon: '🕷️', description: 'Adaptive scraping with anti-bot bypass + AI-powered data extraction.' },
  { id: 'llm-data-forge', name: 'LLM DataForge', tagline: 'Live data pipeline', category: 'Data Pipeline', repos: ['pathwaycom/llm-app', 'DataExpert-io/data-engineer-handbook'], difficulty: 'advanced', color: '#1a4a8b', icon: '⚙️', description: 'Real-time LLM data pipeline with streaming ingestion and vector indexing.' },
  { id: 'agent-academy', name: 'AgentAcademy', tagline: 'AI agent builder', category: 'AI Agents', repos: ['microsoft/ai-agents-for-beginners', 'openai/openai-cookbook'], difficulty: 'starter', color: '#1a7a4a', icon: '🤖', description: 'Build autonomous AI agents with tool use, memory, and planning loops.' },
  { id: 'vision-api', name: 'VisionAPI', tagline: 'Image generation service', category: 'Computer Vision', repos: ['CompVis/stable-diffusion', 'facebookresearch/segment-anything', 'openai/CLIP'], difficulty: 'advanced', color: '#7a4a0a', icon: '🎨', description: 'Image generation + segmentation + understanding pipeline in one API.' },
  { id: 'llm-from-scratch', name: 'TrainYourLLM', tagline: 'Build and train LLMs', category: 'Foundation Models', repos: ['rasbt/LLMs-from-scratch', 'ggerganov/llama.cpp'], difficulty: 'advanced', color: '#5a2a8a', icon: '🧠', description: 'Full LLM training pipeline from tokenizer to transformer with llama.cpp.' },
  { id: 'data-science-hub', name: 'DataScienceHub', tagline: 'End-to-end ML platform', category: 'Machine Learning', repos: ['jackfrued/Python-100-Days', 'aymericdamien/TensorFlow-Examples'], difficulty: 'starter', color: '#0a6a7a', icon: '📊', description: 'Complete data science environment with Python best practices.' },
];

const ENV_URL = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
const ENV_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

const DEFAULTS: Settings = {
  supabaseUrl: ENV_URL, supabaseKey: ENV_KEY,
  groqKey: '', githubToken: '', tinyfishKey: '', scraplingKey: '',
  model: 'llama-3.3-70b-versatile', temperature: 0.7, maxTokens: 4096,
  systemPrompt: '', contextWindow: 10, ragChunks: 5,
  webEnabled: true, scrapingEnabled: true, persona: 'engineer',
};

function loadCfg(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('sara2_cfg') ?? '{}');
    return { ...DEFAULTS, ...saved, supabaseUrl: ENV_URL || saved.supabaseUrl || '', supabaseKey: ENV_KEY || saved.supabaseKey || '' };
  } catch { return DEFAULTS; }
}
function saveCfg(s: Settings) {
  const toSave: Partial<Settings> = { ...s };
  if (ENV_URL) delete toSave.supabaseUrl;
  if (ENV_KEY) delete toSave.supabaseKey;
  localStorage.setItem('sara2_cfg', JSON.stringify(toSave));
}

// ═══════════════════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════════════════
function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, string> = {
    chat: 'M8 12h8M8 8h12M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5l-4 4V6z',
    market: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    repos: 'M4 4h16v3H4zM4 10.5h16v3H4zM4 17h16v3H4z',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h2M20 12h2M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    check: 'M20 6L9 17l-5-5',
    x: 'M18 6L6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    trending: 'M23 6l-9.5 9.5-5-5L1 18',
    arrow: 'M5 12h14M12 5l7 7-7 7',
    copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    search: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
    pin: 'M12 2v8M9 4h6M5 12h14M7 12l1 8h8l1-8',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    export: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    menu: 'M4 6h16M4 12h16M4 18h16',
    sidebar: 'M3 3h18v18H3zM9 3v18',
    command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z',
    heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
    bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
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
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

// Toast system
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `t${Date.now()}`;
    setToasts(p => [...p, { id, type, message, duration }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }, []);
  return { toasts, addToast };
}

// Keyboard shortcuts
function useKeyboard(handlers: Record<string, () => void>) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const key = [e.metaKey || e.ctrlKey ? 'mod' : '', e.shiftKey ? 'shift' : '', e.key.toLowerCase()].filter(Boolean).join('+');
      if (handlers[key]) { e.preventDefault(); handlers[key](); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [handlers]);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

function exportAsMarkdown(msgs: Msg[]): string {
  return `# Sara Conversation\n_Exported ${new Date().toISOString()}_\n\n---\n\n` +
    msgs.map(m => m.role === 'user'
      ? `## 🧑 You\n${m.content}\n`
      : `## 🤖 Sara${m.mode ? ` (${m.mode})` : ''}${m.durationMs ? ` · ${(m.durationMs/1000).toFixed(1)}s` : ''}\n${m.content}\n`
    ).join('\n---\n\n');
}

function exportAsJSON(msgs: Msg[]): string {
  return JSON.stringify({ exported_at: new Date().toISOString(), messages: msgs }, null, 2);
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const MODE_COLORS: Record<Mode, string> = {
  llama: '#1a0e08', gemini: '#1a4a8b', openrouter: '#5a2a8a',
  'llama-gemini': '#1a7a4a', 'llama-openrouter': '#7a4a0a', 'gemini-openrouter': '#0a6a7a',
  multi: '#8b1a1a',
};
const MODE_LABELS: Record<Mode, { short: string; long: string; desc: string }> = {
  llama:              { short: 'LLaMA',  long: 'LLaMA 3.3 70B',               desc: 'Groq · ultra-fast' },
  gemini:             { short: 'Gemini', long: 'Gemini 2.5 Flash',            desc: 'Google · multimodal' },
  openrouter:         { short: 'Router', long: 'OpenRouter',                  desc: '200+ models' },
  'llama-gemini':     { short: 'L+G',   long: 'LLaMA × Gemini',              desc: 'Duo · 2 agents' },
  'llama-openrouter': { short: 'L+R',   long: 'LLaMA × OpenRouter',          desc: 'Duo · 2 agents' },
  'gemini-openrouter':{ short: 'G+R',   long: 'Gemini × OpenRouter',         desc: 'Duo · 2 agents' },
  multi:              { short: '4×',     long: 'LLaMA + Gemini + OpenRouter', desc: '4-agent pipeline' },
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Sara() {
  const isMobile = useIsMobile();
  const { toasts, addToast } = useToasts();

  // ── Core state ─────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('chat');
  const [mode, setMode] = useState<Mode>('llama');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aStatus, setAStatus] = useState<Record<AgentId, AgentStatus>>({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });
  const [cfg, setCfg] = useState<Settings>(loadCfg);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState('');

  // ── Repos ──────────────────────────────────────────────────────────
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoInput, setRepoInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  // ── Market ─────────────────────────────────────────────────────────
  const [assocResult, setAssocResult] = useState<AssocResult | null>(null);
  const [associating, setAssociating] = useState(false);
  const [assocGoal, setAssocGoal] = useState('');
  const [assocPhase, setAssocPhase] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<MarketTemplate | null>(null);

  // ── Files ──────────────────────────────────────────────────────────
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── UI state ───────────────────────────────────────────────────────
  const [cmdOpen, setCmdOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Refs ────────────────────────────────────────────────────────────
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Agent helpers ──────────────────────────────────────────────────
  const setA = (id: AgentId, s: AgentStatus) => setAStatus(p => ({ ...p, [id]: s }));
  const resetA = () => setAStatus({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });

  const agentStream = useAgentStream();

  // ── Supabase client ────────────────────────────────────────────────
  const sb = useMemo(() => {
    return (cfg.supabaseUrl && cfg.supabaseKey) ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  }, [cfg.supabaseUrl, cfg.supabaseKey]);

  // ── Load repos on connect ──────────────────────────────────────────
  useEffect(() => { if (sb) { loadRepos(); loadSessions(); } }, [sb]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  useKeyboard(useMemo(() => ({
    'mod+k': () => setCmdOpen(p => !p),
    'mod+n': () => newChat(),
    'mod+shift+e': () => { if (msgs.length) downloadFile(exportAsMarkdown(msgs), `sara-${Date.now()}.md`); addToast('success', 'Exported as Markdown'); },
    'mod+shift+j': () => { if (msgs.length) downloadFile(exportAsJSON(msgs), `sara-${Date.now()}.json`); addToast('success', 'Exported as JSON'); },
    'mod+b': () => setSidebarOpen(p => !p),
    'escape': () => { setCmdOpen(false); },
  }), [msgs, addToast]));

  // ── Focus input on tab change ──────────────────────────────────────
  useEffect(() => { if (tab === 'chat') setTimeout(() => inputRef.current?.focus(), 100); }, [tab]);

  const isConnected = !!sb;
  const selRepos = repos.filter(r => r.selected);

  // ── Data loaders ───────────────────────────────────────────────────
  async function loadRepos() {
    if (!sb) return;
    const { data } = await sb.from('github_repos').select('*').order('stars', { ascending: false });
    if (data) setRepos(data.map((r: Repo) => ({ ...r, selected: false })));
  }

  async function loadSessions() {
    if (!sb) return;
    const { data } = await sb.from('chat_sessions').select('*').order('created_at', { ascending: false }).limit(50);
    if (data) setSessions(data.map((s: any) => ({ ...s, message_count: 0, preview: s.title })));
  }

  function newChat() {
    setMsgs([]); setSessionId(null); setInput(''); setFiles([]); setErrMsg('');
    resetA(); addToast('info', 'New conversation started');
  }

  async function loadSession(sid: string) {
    if (!sb) return;
    setSessionId(sid);
    const { data } = await sb.from('chat_messages').select('*').eq('session_id', sid).order('created_at', { ascending: true });
    if (data) {
      setMsgs(data.map((m: any, i: number) => ({
        id: `h${i}`, role: m.role === 'assistant' ? 'sara' : 'user',
        content: m.content, ts: new Date(m.created_at).getTime(),
        mode: m.metadata?.mode, ragUsed: m.metadata?.rag_used,
        webUsed: m.metadata?.web_used, durationMs: m.metadata?.duration_ms,
      })));
    }
    setTab('chat');
    addToast('info', 'Session loaded');
  }

  // ── File extraction ────────────────────────────────────────────────
  const extractFileContent = async (file: File): Promise<AttachedFile> => {
    const id = `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml|toml|env|sh|sql|css|html|xml|csv)$/i.test(file.name);
    const isPDF = file.type === 'application/pdf';

    if (isImage) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve({ id, name: file.name, type: file.type, size: file.size, content: e.target?.result as string, isImage: true, isText: false });
        reader.readAsDataURL(file);
      });
    }
    if (isText) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve({ id, name: file.name, type: file.type, size: file.size, content: e.target?.result as string, isImage: false, isText: true });
        reader.readAsText(file);
      });
    }
    if (isPDF) {
      try {
        const buf = await file.arrayBuffer();
        const rawStr = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
        const textMatches = rawStr.match(/\(([^)]{4,500})\)/g) ?? [];
        const text = textMatches.map(m => m.slice(1, -1)).filter(t => t.trim().length > 3 && /[a-zA-Z]/.test(t)).join(' ').replace(/\s+/g, ' ').slice(0, 12000);
        return { id, name: file.name, type: file.type, size: file.size, content: text || `[PDF: ${file.name}]`, isImage: false, isText: true };
      } catch {
        return { id, name: file.name, type: file.type, size: file.size, content: `[PDF: ${file.name}]`, isImage: false, isText: true };
      }
    }
    // Fallback
    try {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve({ id, name: file.name, type: file.type, size: file.size, content: (e.target?.result as string).slice(0, 10000), isImage: false, isText: true });
        reader.onerror = () => resolve({ id, name: file.name, type: file.type, size: file.size, content: `[File: ${file.name}]`, isImage: false, isText: false });
        reader.readAsText(file);
      });
    } catch {
      return { id, name: file.name, type: file.type, size: file.size, content: `[File: ${file.name}]`, isImage: false, isText: false };
    }
  };

  const handleFiles = async (rawFiles: FileList | File[]) => {
    const arr = Array.from(rawFiles);
    if (!arr.length) return;
    setUploading(true);
    const results: AttachedFile[] = [];
    for (const f of arr) {
      const extracted = await extractFileContent(f);
      results.push(extracted);
    }
    setFiles(p => [...p, ...results]);
    setUploading(false);
    addToast('success', `${results.length} file${results.length > 1 ? 's' : ''} attached`);
    if (!input.trim() && results.length === 1) {
      setInput(results[0].isImage ? 'Analyze this image in detail.' : `Analyze this file: ${results[0].name}`);
    }
  };

  // ── SEND ───────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    const ready = files.filter(f => !f.extracting);
    if ((!text && !ready.length) || loading || !sb) {
      if (!sb) { setErrMsg('Configure Supabase in Settings'); addToast('error', 'Not connected'); }
      return;
    }
    const msgText = text || `Analyze this file: ${ready[0]?.name}`;
    setInput(''); resetA(); setErrMsg(''); setFiles([]);
    setMsgs(p => [...p, { id: `u${Date.now()}`, role: 'user', content: msgText, ts: Date.now(), files: ready.length ? ready : undefined }]);
    setLoading(true);

    const history = msgs.slice(-cfg.contextWindow).map(m => ({ role: m.role === 'sara' ? 'assistant' : 'user', content: m.content }));
    const hasImg = ready.some(f => f.isImage);
    const isDuo = mode === 'llama-gemini' || mode === 'llama-openrouter' || mode === 'gemini-openrouter';
    let eMode = mode as Mode;
    if (hasImg && mode === 'llama') eMode = 'gemini';

    const isMultiAgent = eMode === 'multi' || isDuo;
    const fn = eMode === 'multi' ? 'multiagent' : isDuo ? 'chat-duo' : eMode === 'gemini' ? 'chat-gemini' : eMode === 'openrouter' ? 'chat-openrouter' : 'chat';

    const sFiles = ready.map(f => ({
      name: f.name, type: f.type, size: f.size, isImage: f.isImage, isText: f.isText,
      content: f.isImage ? f.content.slice(0, 500000) : f.content.slice(0, 20000), url: f.url,
    }));
    const body: Record<string, unknown> = {
      message: msgText, session_id: sessionId, history,
      repos: selRepos.map(r => r.id),
      files: sFiles.length ? sFiles : undefined,
    };
    if (isDuo) body.models = eMode.split('-');

    try {
      const t0 = Date.now();

      if (isMultiAgent) {
        // ─── SSE STREAMING for multi-agent/duo ───
        const result = await agentStream.stream(cfg.supabaseUrl, cfg.supabaseKey, fn, body);

        if (result) {
          if (result.session_id) setSessionId(result.session_id);
          setMsgs(p => [...p, {
            id: `s${Date.now()}`, role: 'sara',
            content: result.answer ?? 'No response',
            ts: Date.now(), mode: eMode,
            ragUsed: result.rag_used,
            durationMs: result.duration_ms ?? (Date.now() - t0),
            agentOutputs: {
              researcher: result.researcher_findings,
              analyst: result.analyst_analysis,
              critic: result.critic_critique,
              synthesizer: result.answer,
            },
          }]);
          loadSessions();
        } else if (agentStream.error) {
          throw new Error(agentStream.error);
        }
      } else {
        // ─── Regular (non-streaming) for solo modes ───
        setA('synthesizer', 'thinking');
        const { data, error } = await sb.functions.invoke(fn, { body });
        (Object.keys(AGENTS) as AgentId[]).forEach(k => setA(k, 'done'));
        if (error) throw error;
        if (data?.session_id) setSessionId(data.session_id);

        setMsgs(p => [...p, {
          id: `s${Date.now()}`, role: 'sara',
          content: data?.answer ?? 'No response',
          ts: Date.now(), mode: eMode,
          ragUsed: data?.rag_used, webUsed: data?.web_used,
          durationMs: Date.now() - t0,
        }]);
        loadSessions();
      }
    } catch (e: unknown) {
      if (timerRef.current) clearInterval(timerRef.current);
      resetA(); agentStream.reset();
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setErrMsg(msg);
      setMsgs(p => [...p, { id: `e${Date.now()}`, role: 'sara', content: `**Error**\n\n${msg}`, ts: Date.now(), err: true }]);
      addToast('error', 'Request failed');
    } finally { setLoading(false); }
  }, [input, files, loading, mode, msgs, sb, selRepos, sessionId, cfg, addToast, agentStream]);

  // ── ASSOCIATE ──────────────────────────────────────────────────────
  const associate = useCallback(async (repoOverrides?: string[], goalOverride?: string) => {
    const sel = repoOverrides ?? selRepos.map(r => r.id);
    if (sel.length < 2) { setErrMsg('Select at least 2 repos'); return; }
    if (!sb) { setErrMsg('Configure Supabase first'); return; }
    setAssociating(true); setAssocResult(null); setErrMsg('');
    const phases = ['Browsing live repo pages…', 'Analyzing integration points…', 'Designing architecture…', 'Generating starter code…', 'Writing deploy guide…'];
    let pi = 0; setAssocPhase(phases[0]);
    const pt = setInterval(() => { pi++; if (pi < phases.length) setAssocPhase(phases[pi]); else clearInterval(pt); }, 4000);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('associate', {
        body: { repo_ids: sel, custom_goal: (goalOverride ?? assocGoal) || undefined, mode },
      });
      clearInterval(pt);
      if (fnErr) throw new Error(fnErr.message);
      if (!data?.success) throw new Error(data?.error ?? 'Failed');
      setAssocResult(data);
      setTab('market');
      addToast('success', `${data.service_name} generated!`);
    } catch (e: unknown) { clearInterval(pt); setErrMsg(e instanceof Error ? e.message : 'Error'); addToast('error', 'Association failed'); }
    finally { setAssociating(false); setAssocPhase(''); }
  }, [selRepos, sb, assocGoal, mode, addToast]);

  // ── SYNC REPO ──────────────────────────────────────────────────────
  const syncRepo = async (ownerOverride?: string, repoOverride?: string) => {
    const inputStr = ownerOverride ? `${ownerOverride}/${repoOverride}` : repoInput.trim();
    if (!inputStr || syncing || !sb) return;
    const parts = inputStr.replace('https://github.com/', '').split('/');
    if (parts.length < 2) { setSyncMsg('Format: owner/repo'); return; }
    const [owner, repo] = parts;
    setSyncing(true); setSyncMsg(`Indexing ${owner}/${repo}…`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('github-sync', { body: { owner, repo } });
      if (fnErr) throw new Error(fnErr.message);
      setSyncMsg(`✓ ${owner}/${repo} — ${data.chunks_created} chunks`);
      setRepoInput(''); await loadRepos();
      addToast('success', `${owner}/${repo} indexed`);
    } catch (e: unknown) { setSyncMsg(`✗ ${e instanceof Error ? e.message : 'Failed'}`); addToast('error', 'Sync failed'); }
    finally { setSyncing(false); }
  };

  const bulkSync = async (preset: string) => {
    if (!sb || bulkSyncing) return;
    setBulkSyncing(true); setBulkProgress(`Starting bulk sync (${preset})…`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('bulk-sync', { body: { use_preset: preset } });
      if (fnErr) throw new Error(fnErr.message);
      setBulkProgress(`✓ ${data.repos_succeeded}/${data.repos_processed} repos · ${data.total_chunks} chunks`);
      await loadRepos();
      addToast('success', `${data.repos_succeeded} repos indexed`);
    } catch (e: unknown) { setBulkProgress(`✗ ${e instanceof Error ? e.message : 'Error'}`); }
    finally { setBulkSyncing(false); }
  };

  const toggleRepo = (id: string) => setRepos(p => p.map(r => r.id === id ? { ...r, selected: !r.selected } : r));

  const buildFromTemplate = async (template: MarketTemplate) => {
    setActiveTemplate(template);
    setAssocGoal(template.description);
    const matchIds = template.repos.flatMap(repoStr => {
      const [owner, repo] = repoStr.split('/');
      return repos.filter(r => r.owner === owner && r.repo === repo).map(r => r.id);
    });
    if (matchIds.length >= 2) { await associate(matchIds, template.description); }
    else { setErrMsg(`Index these repos first: ${template.repos.join(', ')}`); addToast('error', 'Repos not indexed yet'); }
  };

  // ── Message actions ────────────────────────────────────────────────
  const copyMessage = (content: string) => { copyToClipboard(content); addToast('success', 'Copied to clipboard'); };
  const pinMessage = (id: string) => { setMsgs(p => p.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m)); };
  const deleteMessage = (id: string) => { setMsgs(p => p.filter(m => m.id !== id)); };
  const reactToMessage = (id: string, emoji: string) => {
    setMsgs(p => p.map(m => {
      if (m.id !== id) return m;
      const reactions = m.reactions ?? [];
      return { ...m, reactions: reactions.includes(emoji) ? reactions.filter(r => r !== emoji) : [...reactions, emoji] };
    }));
  };

  const navTabs: [Tab, string, string][] = [
    ['chat', 'chat', 'Chat'],
    ['market', 'market', 'Market'],
    ['repos', 'repos', `Repos${repos.length > 0 ? ` (${repos.length})` : ''}`],
    ['settings', 'settings', 'Settings'],
  ];

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', fontFamily: 'var(--f-body)', overflow: 'hidden' }} className="grain">

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 14px' : '0 24px',
        height: isMobile ? 52 : 56,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, boxShadow: 'var(--shadow-xs)', zIndex: 10,
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isMobile && (
            <button onClick={() => setSidebarOpen(p => !p)} className="btn-icon" style={{ width: 32, height: 32 }} data-tooltip={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
              <Icon name="sidebar" size={14} />
            </button>
          )}
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--g-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 16, color: 'white' }}>S</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Sara</span>
              <span className="chip chip-red" style={{ fontSize: 9, padding: '0 6px' }}>1.0</span>
            </div>
            {!isMobile && (
              <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', lineHeight: 1, marginTop: 1 }}>
                Groq · Gemini · OpenRouter · RAG
              </p>
            )}
          </div>
        </div>

        {/* Center nav — desktop only */}
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

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10 }}>
          {/* ⌘K button */}
          {!isMobile && (
            <button onClick={() => setCmdOpen(true)} className="btn-ghost" style={{ padding: '5px 10px', fontSize: 11, gap: 4 }}>
              <Icon name="command" size={12} />
              <span className="cmd-kbd" style={{ marginLeft: 2 }}>⌘K</span>
            </button>
          )}
          <ModelSelector mode={mode} setMode={setMode} isMobile={isMobile} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className={isConnected ? 'dot-live' : 'dot-err'} />
            {!isMobile && <span style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{isConnected ? 'live' : 'offline'}</span>}
          </div>
        </div>
      </header>

      {/* ── BODY ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT SIDEBAR — Chat History ─────────────────────────── */}
        {!isMobile && sidebarOpen && tab === 'chat' && (
          <aside style={{ width: 260, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slide-in 0.2s ease' }}>
            {/* New chat button */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <button className="btn-primary" onClick={newChat} style={{ width: '100%', padding: '8px 14px', fontSize: 13 }}>
                <Icon name="plus" size={14} /> New Conversation
              </button>
            </div>

            {/* Search */}
            <div style={{ padding: '8px 16px' }}>
              <div style={{ position: 'relative' }}>
                <Icon name="search" size={13} className="" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search conversations…"
                  className="sara-input"
                  style={{ fontSize: 12, padding: '7px 12px 7px 32px' }}
                />
                <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink4)' }}>
                  <Icon name="search" size={13} />
                </div>
              </div>
            </div>

            {/* Agent status */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 9, fontFamily: 'var(--f-mono)', color: 'var(--ink4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                {mode === 'multi' ? 'Pipeline 4×' : mode.includes('-') ? `Duo · ${mode.replace('-',' + ')}` : `Solo · ${mode}`}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => {
                  const isSolo = mode === 'llama' || mode === 'gemini' || mode === 'openrouter';
                  if (isSolo && id !== 'synthesizer') return null;
                  const s = aStatus[id];
                  return (
                    <div key={id} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${s !== 'idle' ? a.color + '30' : 'var(--border)'}`, background: s !== 'idle' ? a.color + '08' : 'transparent', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12 }}>{a.icon}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: s !== 'idle' ? a.color : 'var(--ink3)', flex: 1 }}>{a.label}</span>
                      <div className={s === 'done' ? 'dot-done' : s === 'thinking' ? 'dot-live' : 'dot-idle'} style={{ width: 5, height: 5, background: s === 'thinking' ? a.color : undefined }} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {sessions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink4)' }}>No conversations yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sessions
                    .filter(s => !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(s => (
                    <button key={s.id} onClick={() => loadSession(s.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 2,
                        padding: '8px 10px', borderRadius: 8, border: 'none',
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                        background: sessionId === s.id ? 'var(--red-s)' : 'transparent',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { if (sessionId !== s.id) (e.currentTarget).style.background = 'var(--s3)'; }}
                      onMouseLeave={e => { if (sessionId !== s.id) (e.currentTarget).style.background = 'transparent'; }}
                    >
                      <p style={{ fontSize: 12, fontWeight: 500, color: sessionId === s.id ? 'var(--red)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
                          {new Date(s.created_at).toLocaleDateString()}
                        </span>
                        {s.mode && <span className="chip chip-ink" style={{ fontSize: 8, padding: '0 4px' }}>{s.mode}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom stats */}
            {selRepos.length > 0 && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>⬡ {selRepos.length} repo{selRepos.length !== 1 ? 's' : ''} active</p>
              </div>
            )}
          </aside>
        )}

        {/* ── MAIN CONTENT ────────────────────────────────────────── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>

          {/* ── CHAT TAB ──────────────────────────────────────────── */}
          {tab === 'chat' && (
            <>
              {/* Messages area */}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
                {msgs.length === 0 ? (
                  <ChatEmpty mode={mode} selRepos={selRepos} onSelect={text => { setInput(text); inputRef.current?.focus(); }} isMobile={isMobile} onDropFiles={handleFiles} />
                ) : (
                  <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {msgs.map(m => (
                      <ChatBubble
                        key={m.id} msg={m} isMobile={isMobile}
                        onCopy={() => copyMessage(m.content)}
                        onPin={() => pinMessage(m.id)}
                        onDelete={() => deleteMessage(m.id)}
                        onReact={(emoji) => reactToMessage(m.id, emoji)}
                      />
                    ))}
                    {loading && (agentStream.streaming ? (
                      <LiveAgentPanel
                        agents={agentStream.agents}
                        phase={agentStream.phase}
                        elapsed={agentStream.elapsed}
                        streaming={agentStream.streaming}
                      />
                    ) : (
                      <ThinkingIndicator mode={mode} />
                    ))}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              {/* Input bar */}
              <ChatInputBar
                input={input} setInput={setInput}
                files={files} setFiles={setFiles}
                loading={loading} uploading={uploading}
                mode={mode} errMsg={errMsg}
                isMobile={isMobile}
                inputRef={inputRef}
                fileInputRef={fileInputRef}
                onSend={send}
                onHandleFiles={handleFiles}
                msgCount={msgs.length}
                onExportMd={() => { downloadFile(exportAsMarkdown(msgs), `sara-${Date.now()}.md`); addToast('success', 'Exported as Markdown'); }}
                onExportJson={() => { downloadFile(exportAsJSON(msgs), `sara-${Date.now()}.json`); addToast('success', 'Exported as JSON'); }}
              />
            </>
          )}

          {/* ── MARKET TAB ────────────────────────────────────────── */}
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

          {/* ── REPOS TAB ─────────────────────────────────────────── */}
          {tab === 'repos' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <ReposTab repos={repos} repoInput={repoInput} setRepoInput={setRepoInput}
                onSync={() => syncRepo()} syncing={syncing} syncMsg={syncMsg}
                onToggle={toggleRepo} bulkSyncing={bulkSyncing}
                bulkProgress={bulkProgress} onBulkSync={bulkSync} />
            </div>
          )}

          {/* ── SETTINGS TAB ──────────────────────────────────────── */}
          {tab === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <SettingsTab cfg={cfg} onChange={s => { setCfg(s); saveCfg(s); addToast('success', 'Settings saved'); }} envUrl={ENV_URL} envKey={ENV_KEY} />
            </div>
          )}
        </main>
      </div>

      {/* ── COMMAND PALETTE ────────────────────────────────────────── */}
      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          onNewChat={newChat}
          onExportMd={() => { if (msgs.length) { downloadFile(exportAsMarkdown(msgs), `sara-${Date.now()}.md`); addToast('success', 'Exported'); } }}
          onExportJson={() => { if (msgs.length) { downloadFile(exportAsJSON(msgs), `sara-${Date.now()}.json`); addToast('success', 'Exported'); } }}
          onToggleSidebar={() => setSidebarOpen(p => !p)}
          setTab={setTab}
          setMode={setMode}
        />
      )}

      {/* ── TOAST NOTIFICATIONS ────────────────────────────────────── */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────────────── */}
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
                  flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                  background: 'transparent', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3,
                  color: active ? 'var(--red)' : 'var(--ink4)',
                  transition: 'all 0.15s', position: 'relative',
                }}>
                {active && <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 24, height: 2, borderRadius: '0 0 2px 2px', background: 'var(--red)' }} />}
                <Icon name={icon} size={active ? 20 : 18} />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, fontFamily: 'var(--f-mono)', lineHeight: 1 }}>{labels[t]}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE (⌘K)
// ═══════════════════════════════════════════════════════════════════════════
function CommandPalette({ onClose, onNewChat, onExportMd, onExportJson, onToggleSidebar, setTab, setMode }: {
  onClose: () => void; onNewChat: () => void;
  onExportMd: () => void; onExportJson: () => void;
  onToggleSidebar: () => void;
  setTab: (t: Tab) => void; setMode: (m: Mode) => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const commands = [
    { group: 'Actions', items: [
      { icon: '➕', label: 'New conversation', hint: '⌘N', action: () => { onNewChat(); onClose(); } },
      { icon: '📋', label: 'Export as Markdown', hint: '⌘⇧E', action: () => { onExportMd(); onClose(); } },
      { icon: '📦', label: 'Export as JSON', hint: '⌘⇧J', action: () => { onExportJson(); onClose(); } },
      { icon: '📐', label: 'Toggle sidebar', hint: '⌘B', action: () => { onToggleSidebar(); onClose(); } },
    ]},
    { group: 'Navigate', items: [
      { icon: '💬', label: 'Go to Chat', hint: '', action: () => { setTab('chat'); onClose(); } },
      { icon: '🏪', label: 'Go to Market', hint: '', action: () => { setTab('market'); onClose(); } },
      { icon: '📚', label: 'Go to Repos', hint: '', action: () => { setTab('repos'); onClose(); } },
      { icon: '⚙️', label: 'Go to Settings', hint: '', action: () => { setTab('settings'); onClose(); } },
    ]},
    { group: 'Models', items: [
      { icon: '🦙', label: 'Switch to LLaMA', hint: 'solo', action: () => { setMode('llama'); onClose(); } },
      { icon: '💎', label: 'Switch to Gemini', hint: 'solo', action: () => { setMode('gemini'); onClose(); } },
      { icon: '🌐', label: 'Switch to OpenRouter', hint: 'solo', action: () => { setMode('openrouter'); onClose(); } },
      { icon: '🔥', label: 'Switch to Multi-Agent 4×', hint: 'quad', action: () => { setMode('multi'); onClose(); } },
    ]},
  ];

  const filtered = q.trim()
    ? commands.map(g => ({ ...g, items: g.items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())) })).filter(g => g.items.length)
    : commands;

  return (
    <div className="cmd-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-palette">
        <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command…" className="cmd-input"
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && filtered.length && filtered[0].items.length) { filtered[0].items[0].action(); }
          }}
        />
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.map(g => (
            <div key={g.group}>
              <p className="cmd-group-title">{g.group}</p>
              {g.items.map(item => (
                <div key={item.label} className="cmd-item" onClick={item.action}>
                  <div className="cmd-icon">{item.icon}</div>
                  <span className="cmd-label">{item.label}</span>
                  {item.hint && <span className="cmd-kbd">{item.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--ink4)' }}>No results for "{q}"</p>
            </div>
          )}
        </div>
        <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, justifyContent: 'center' }}>
          {[['↵','Select'],['↑↓','Navigate'],['esc','Close']].map(([k,l]) => (
            <span key={k} style={{ fontSize: 10, color: 'var(--ink4)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="cmd-kbd">{k}</span> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL SELECTOR
// ═══════════════════════════════════════════════════════════════════════════
function ModelSelector({ mode, setMode, isMobile }: { mode: Mode; setMode: (m: Mode) => void; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const current = MODE_LABELS[mode];

  function Section({ title, modes }: { title: string; modes: Mode[] }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>{title}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {modes.map(m => {
            const l = MODE_LABELS[m];
            const active = mode === m;
            return (
              <button key={m} onClick={() => { setMode(m); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: active ? `1px solid ${MODE_COLORS[m]}30` : '1px solid transparent', background: active ? `${MODE_COLORS[m]}08` : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', width: '100%' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: MODE_COLORS[m], flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? MODE_COLORS[m] : 'var(--ink)' }}>{l.long}</p>
                  <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 1 }}>{l.desc}</p>
                </div>
                {active && <span style={{ fontSize: 10, color: MODE_COLORS[m], fontWeight: 700 }}>●</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 9px' : '6px 12px', borderRadius: 8, border: `1px solid ${MODE_COLORS[mode]}30`, background: `${MODE_COLORS[mode]}08`, cursor: 'pointer', transition: 'all 0.15s' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: MODE_COLORS[mode] }} />
        <span style={{ fontSize: isMobile ? 10 : 12, fontWeight: 700, fontFamily: 'var(--f-mono)', color: MODE_COLORS[mode] }}>{current.short}</span>
        <span style={{ fontSize: 9, color: 'var(--ink4)', transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', zIndex: 100, padding: '12px 10px', animation: 'fade-scale 0.15s ease' }}>
          <Section title="Solo" modes={['llama', 'gemini', 'openrouter']} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 10px' }} />
          <Section title="Duo" modes={['llama-gemini', 'llama-openrouter', 'gemini-openrouter']} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 10px' }} />
          <Section title="Quad — 4× Pipeline" modes={['multi']} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THINKING INDICATOR
// ═══════════════════════════════════════════════════════════════════════════
function ThinkingIndicator({ mode }: { mode: Mode }) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => setDots(p => p.length >= 3 ? '' : p + '.'), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="anim-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--g-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 14, color: 'white' }}>S</span>
      </div>
      <div style={{ padding: '12px 18px', borderRadius: '14px 14px 14px 4px', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: MODE_COLORS[mode], animation: `dot-pulse 1.2s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
        </div>
        <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>
          {mode === 'multi' ? 'Agents working' : 'Sara thinking'}{dots}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT EMPTY — Hero + Suggestions + Drop zone
// ═══════════════════════════════════════════════════════════════════════════
function ChatEmpty({ mode, selRepos, onSelect, isMobile, onDropFiles }: {
  mode: Mode; selRepos: Repo[]; onSelect: (text: string) => void; isMobile: boolean; onDropFiles: (files: FileList | File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const suggestions = [
    { t: 'Scrape competitor prices live', d: 'Scrapling + TinyFish extract structured data', c: 'var(--red)', icon: '🕷️' },
    { t: 'Build a RAG chatbot from scratch', d: 'Supabase pgvector + LLaMA + streaming UI', c: 'var(--blue)', icon: '🤖' },
    { t: 'Train an LLM from scratch', d: 'rasbt/LLMs-from-scratch + llama.cpp inference', c: 'var(--ink)', icon: '🧠' },
    { t: 'Create an autonomous AI agent', d: 'Tool use + memory + planning loops', c: 'var(--green)', icon: '⚡' },
    { t: 'Analyze a codebase architecture', d: 'Paste or drop any file for instant review', c: 'var(--amber)', icon: '🏗️' },
    { t: 'Design a microservice system', d: 'Event-driven, containerized, auto-scaling', c: 'var(--purple)', icon: '◇' },
  ];

  return (
    <div
      style={{ maxWidth: 820, margin: isMobile ? '16px auto 0' : '32px auto 0', paddingBottom: 16, position: 'relative' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDropFiles(e.dataTransfer.files); }}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div style={{ position: 'absolute', inset: -16, background: 'var(--blue-s)', border: '2px dashed var(--blue)', borderRadius: 20, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fade-in 0.15s ease' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>📎</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>Drop files here</p>
            <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>Images, PDFs, code, data…</p>
          </div>
        </div>
      )}

      {/* Hero */}
      <div style={{ marginBottom: isMobile ? 20 : 28, display: 'flex', alignItems: 'flex-start', gap: isMobile ? 14 : 20 }}>
        <div style={{ width: isMobile ? 52 : 60, height: isMobile ? 52 : 60, borderRadius: isMobile ? 14 : 16, background: 'var(--g-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow)' }}>
          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: isMobile ? 26 : 30, color: 'white' }}>S</span>
        </div>
        <div>
          <h1 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 26 : 38, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Hello, I'm <span style={{ color: 'var(--red)' }}>Sara</span>
          </h1>
          <p style={{ color: 'var(--ink2)', fontSize: isMobile ? 13 : 15, marginTop: 6, lineHeight: 1.5, maxWidth: 480 }}>
            {mode === 'multi'
              ? '4 specialized agents analyzing your request — Researcher, Architect, Critic, Synthesizer'
              : 'Your AI engineering partner — architecture-first, live web, GitHub knowledge, multimodal vision'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="chip chip-red">LLaMA 3.3 70B</span>
            <span className="chip chip-blue">Gemini 2.5</span>
            <span className="chip chip-purple">OpenRouter</span>
            <span className="chip chip-green">pgvector RAG</span>
            {selRepos.length > 0 && <span className="chip chip-live">⬡ {selRepos.length} repos</span>}
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      {!isMobile && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {[['⌘K', 'Commands'], ['⌘N', 'New chat'], ['⌘B', 'Sidebar'], ['⌘⇧E', 'Export']].map(([k, l]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink4)' }}>
              <span className="cmd-kbd">{k}</span> <span>{l}</span>
            </span>
          ))}
        </div>
      )}

      {/* Suggestions */}
      <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Suggestions →
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: isMobile ? 8 : 10 }}>
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => onSelect(s.t)} className="card-interactive"
            style={{ padding: 16, textAlign: 'left', border: '1px solid var(--border)', fontFamily: 'var(--f-body)', animationDelay: `${i * 50}ms` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: s.c }} />
            </div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>{s.t}</p>
            <p style={{ fontSize: 11, color: 'var(--ink3)', lineHeight: 1.4 }}>{s.d}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT BUBBLE — with actions (copy, pin, react, delete)
// ═══════════════════════════════════════════════════════════════════════════
function ChatBubble({ msg, isMobile, onCopy, onPin, onDelete, onReact }: {
  msg: Msg; isMobile: boolean;
  onCopy: () => void; onPin: () => void; onDelete: () => void; onReact: (emoji: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const html = msg.role === 'sara' ? (marked.parse(msg.content) as string) : '';
  const isUser = msg.role === 'user';
  const words = wordCount(msg.content);

  return (
    <div className="anim-up"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      style={{ position: 'relative' }}
    >
      {/* Pinned indicator */}
      {msg.pinned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, marginLeft: isUser ? 'auto' : 40 }}>
          <Icon name="pin" size={10} />
          <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--f-mono)' }}>Pinned</span>
        </div>
      )}

      {isUser ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ maxWidth: isMobile ? '85%' : '72%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {/* File previews */}
            {msg.files?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                {msg.files.map(f => f.isImage ? (
                  <img key={f.id} src={f.content} alt={f.name} style={{ maxWidth: 200, maxHeight: 150, borderRadius: 10, objectFit: 'cover', boxShadow: 'var(--shadow-sm)' }} />
                ) : (
                  <div key={f.id} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink4)' }}>
                    📎 {f.name}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ padding: '12px 16px', borderRadius: '16px 16px 4px 16px', background: 'var(--ink)', color: 'white', fontSize: 14, lineHeight: 1.6, boxShadow: 'var(--shadow)', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
            <span style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{timeAgo(msg.ts)}</span>
          </div>
        </div>
      ) : (
        <div>
          {/* Sara header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--g-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 13, color: 'white' }}>S</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Sara</span>
            {msg.mode === 'multi' && <span className="chip chip-red" style={{ fontSize: 9 }}>4-agent</span>}
            {msg.mode?.includes('-') && <span className="chip chip-blue" style={{ fontSize: 9 }}>duo·{msg.mode}</span>}
            {msg.mode === 'gemini' && <span className="chip chip-blue" style={{ fontSize: 9 }}>Gemini</span>}
            {msg.ragUsed && <span className="chip chip-green" style={{ fontSize: 9 }}>⬡ RAG</span>}
            {msg.webUsed && <span className="chip chip-blue" style={{ fontSize: 9 }}>🌐 live</span>}
            {msg.err && <span className="chip chip-red" style={{ fontSize: 9 }}>error</span>}
            <span style={{ fontSize: 10, color: 'var(--ink4)', marginLeft: 'auto', fontFamily: 'var(--f-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {words}w
              {msg.durationMs && <span>· {(msg.durationMs / 1000).toFixed(1)}s</span>}
            </span>
          </div>

          {/* Message body */}
          <div className="card" style={{ padding: isMobile ? '14px 16px' : '16px 20px', borderLeft: msg.err ? '3px solid var(--red)' : msg.pinned ? '3px solid var(--amber)' : '3px solid var(--border)', overflowX: 'auto', position: 'relative' }}>
            <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />

            {/* Actions bar — on hover */}
            {showActions && !isMobile && (
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 2, animation: 'fade-in 0.1s ease', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', padding: 2, boxShadow: 'var(--shadow-sm)' }}>
                {[
                  { icon: 'copy', tip: 'Copy', fn: onCopy },
                  { icon: 'pin', tip: msg.pinned ? 'Unpin' : 'Pin', fn: onPin },
                  { icon: 'trash', tip: 'Delete', fn: onDelete },
                ].map(a => (
                  <button key={a.icon} onClick={a.fn} data-tooltip={a.tip}
                    style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)', transition: 'all 0.1s' }}
                    onMouseEnter={e => { (e.currentTarget).style.background = 'var(--s3)'; (e.currentTarget).style.color = 'var(--ink)'; }}
                    onMouseLeave={e => { (e.currentTarget).style.background = 'transparent'; (e.currentTarget).style.color = 'var(--ink3)'; }}
                  >
                    <Icon name={a.icon} size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reactions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 4 }}>
            {['👍', '🔥', '💡', '❤️'].map(emoji => {
              const active = msg.reactions?.includes(emoji);
              return (
                <button key={emoji} onClick={() => onReact(emoji)}
                  style={{ padding: '2px 6px', borderRadius: 20, border: `1px solid ${active ? 'var(--red-m)' : 'var(--border)'}`, background: active ? 'var(--red-s)' : 'transparent', cursor: 'pointer', fontSize: 12, transition: 'all 0.1s', opacity: showActions || active ? 1 : 0 }}>
                  {emoji}{active && <span style={{ fontSize: 10, marginLeft: 2, color: 'var(--red)', fontFamily: 'var(--f-mono)' }}>1</span>}
                </button>
              );
            })}
            <span style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginLeft: 4 }}>{timeAgo(msg.ts)}</span>
          </div>

          {/* Agent breakdown */}
          {msg.agentOutputs && (
            <div style={{ marginTop: 8, marginLeft: 4 }}>
              <button onClick={() => setAgentOpen(!agentOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'var(--f-mono)' }}>
                <span style={{ transition: 'transform 0.2s', transform: agentOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
                Agent breakdown
              </button>
              {agentOpen && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                  {(Object.entries(msg.agentOutputs) as [AgentId, string][]).map(([id, out]) => {
                    const a = AGENTS[id]; if (!a || !out) return null;
                    return (
                      <div key={id} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${a.color}` }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: a.color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {a.icon} {a.label}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                          {out.slice(0, 300)}{out.length > 300 ? '…' : ''}
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
// CHAT INPUT BAR
// ═══════════════════════════════════════════════════════════════════════════
function ChatInputBar({ input, setInput, files, setFiles, loading, uploading, mode, errMsg, isMobile, inputRef, fileInputRef, onSend, onHandleFiles, msgCount, onExportMd, onExportJson }: {
  input: string; setInput: (v: string) => void;
  files: AttachedFile[]; setFiles: (fn: (p: AttachedFile[]) => AttachedFile[]) => void;
  loading: boolean; uploading: boolean;
  mode: Mode; errMsg: string; isMobile: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSend: () => void; onHandleFiles: (f: FileList | File[]) => void;
  msgCount: number; onExportMd: () => void; onExportJson: () => void;
}) {
  const [showExport, setShowExport] = useState(false);

  return (
    <div
      style={{ flexShrink: 0, padding: isMobile ? '10px 14px 14px' : '12px 24px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}
      onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'var(--blue-s)'; }}
      onDragLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}
      onDrop={e => { e.preventDefault(); e.currentTarget.style.background = 'var(--surface)'; onHandleFiles(e.dataTransfer.files); }}
    >
      {errMsg && (
        <div style={{ maxWidth: 780, margin: '0 auto 8px', padding: '8px 12px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, fontFamily: 'var(--f-mono)' }}>
          {errMsg}
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div style={{ maxWidth: 780, margin: '0 auto 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 6px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 12, maxWidth: 200 }}>
              {f.isImage ? <img src={f.content} alt={f.name} style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                : <span style={{ fontSize: 13 }}>{f.name.endsWith('.pdf') ? '📄' : '📝'}</span>}
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
              <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink4)', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8 }}>
        <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }}
          onChange={e => e.target.files && onHandleFiles(e.target.files)} />

        {/* Attach */}
        <button onClick={() => fileInputRef.current?.click()} disabled={loading} className="btn-icon"
          style={{ alignSelf: 'stretch', color: files.length > 0 ? 'var(--green)' : 'var(--ink3)', position: 'relative' }}
          data-tooltip="Attach files">
          {uploading ? <Spin /> : <span style={{ fontSize: 16 }}>📎</span>}
          {files.length > 0 && <div className="badge" style={{ top: -2, right: -2 }}>{files.length}</div>}
        </button>

        {/* Input */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          onPaste={e => {
            const items = Array.from(e.clipboardData.items);
            const img = items.find(i => i.type.startsWith('image/'));
            if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); onHandleFiles([f]); } }
          }}
          placeholder={files.length > 0 ? 'Instructions for this file… (Enter for auto-analysis)' : mode === 'multi' ? 'Multi-agent 4×…' : `Ask Sara (${MODE_LABELS[mode].short})…`}
          rows={isMobile ? 1 : 2}
          disabled={loading}
          className="sara-input"
          style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
        />

        {/* Export button */}
        {msgCount > 0 && !isMobile && (
          <div style={{ position: 'relative', alignSelf: 'stretch' }}>
            <button onClick={() => setShowExport(p => !p)} className="btn-icon" data-tooltip="Export" style={{ alignSelf: 'stretch', height: '100%' }}>
              <Icon name="export" size={14} />
            </button>
            {showExport && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 4, width: 160, animation: 'fade-scale 0.15s ease', zIndex: 50 }}>
                <button onClick={() => { onExportMd(); setShowExport(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', width: '100%', fontSize: 12, color: 'var(--ink2)', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget).style.background = 'var(--s3)'}
                  onMouseLeave={e => (e.currentTarget).style.background = 'transparent'}>
                  📋 Markdown
                </button>
                <button onClick={() => { onExportJson(); setShowExport(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', width: '100%', fontSize: 12, color: 'var(--ink2)', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget).style.background = 'var(--s3)'}
                  onMouseLeave={e => (e.currentTarget).style.background = 'transparent'}>
                  📦 JSON
                </button>
              </div>
            )}
          </div>
        )}

        {/* Send */}
        <button onClick={onSend} disabled={(!input.trim() && !files.length) || loading} className="btn-red"
          style={{ padding: isMobile ? '0 14px' : '0 20px', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'stretch', flexShrink: 0, borderRadius: 'var(--r)' }}>
          {loading ? <Spin /> : <Icon name="send" size={14} />}
          {!isMobile && (loading ? 'Wait' : 'Send')}
        </button>
      </div>

      {/* Bottom hints */}
      {!isMobile && (
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
          {MODE_LABELS[mode].long} · Enter ↵ send · Shift+Enter ↵ newline · 📎 drag & drop files
        </p>
      )}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// MARKET TAB
// ═══════════════════════════════════════════════════════════════════════════
function MarketTab({ repos, templates, assocResult, associating, assocGoal, setAssocGoal, assocPhase, errMsg, toggleRepo, selRepos, onAssociate, onBuildTemplate, activeTemplate, isMobile }: {
  repos: Repo[]; templates: MarketTemplate[]; assocResult: AssocResult | null;
  associating: boolean; assocGoal: string; setAssocGoal: (v: string) => void;
  assocPhase: string; errMsg: string; toggleRepo: (id: string) => void;
  selRepos: Repo[]; onAssociate: () => void; onBuildTemplate: (t: MarketTemplate) => void;
  activeTemplate: MarketTemplate | null; isMobile: boolean;
}) {
  const difficultyColor: Record<string, string> = { starter: 'var(--green)', intermediate: 'var(--amber)', advanced: 'var(--red)' };
  const difficultyIcon: Record<string, string> = { starter: '🟢', intermediate: '🟡', advanced: '🔴' };

  return (
    <div style={{ padding: isMobile ? '16px 14px' : 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h2 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 22 : 30, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                  Association Market
                </h2>
                <span className="chip chip-red" style={{ fontSize: 9 }}>Beta</span>
              </div>
              <p style={{ color: 'var(--ink3)', fontSize: 13, maxWidth: 520 }}>
                Combine GitHub repos into fully functional services. Sara analyzes each repo, designs architecture, writes starter code, and creates a deploy guide.
              </p>
            </div>
            {selRepos.length >= 2 && (
              <button className="btn-red" onClick={onAssociate} disabled={associating}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, padding: '12px 24px', fontSize: 14 }}>
                {associating ? <><Spin /> <span>{assocPhase || 'Building…'}</span></> : <><Icon name="zap" size={16} /> Build {selRepos.length} repos</>}
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {errMsg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠</span> {errMsg}
          </div>
        )}

        {/* Association result */}
        {assocResult && <AssocResultCard result={assocResult} isMobile={isMobile} />}

        {/* Custom association */}
        <div className="card" style={{ padding: isMobile ? 16 : 24, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--g-red)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 18 }}>⚗️</span>
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Custom Association</p>
              <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Select repos → describe goal → generate service</p>
            </div>
            <span className="chip chip-red" style={{ fontSize: 9, marginLeft: 'auto' }}>Sara exclusive</span>
          </div>

          <input value={assocGoal} onChange={e => setAssocGoal(e.target.value)}
            placeholder="e.g. Build a competitor price monitor that scrapes 10 sites every hour…"
            className="sara-input" style={{ marginBottom: 14, fontSize: 13 }}
          />

          {repos.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {repos.slice(0, 20).map(r => (
                <button key={r.id} onClick={() => toggleRepo(r.id)} className="btn-pill"
                  style={{ background: r.selected ? 'var(--red-s)' : undefined, borderColor: r.selected ? 'var(--red)' : undefined, color: r.selected ? 'var(--red)' : undefined }}>
                  {r.selected ? '✓ ' : ''}{r.owner}/{r.repo}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: 16, borderRadius: 10, background: 'var(--bg2)', textAlign: 'center', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--ink4)' }}>No repos indexed yet. Go to <strong>Repos</strong> tab first.</p>
            </div>
          )}

          {/* Progress bar during association */}
          {associating && (
            <div style={{ marginBottom: 16 }}>
              <div className="progress-indeterminate" style={{ marginBottom: 8 }} />
              <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', textAlign: 'center' }}>{assocPhase}</p>
            </div>
          )}

          <button className="btn-primary" onClick={onAssociate} disabled={associating || selRepos.length < 2}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center', padding: '12px 20px' }}>
            {associating ? <><Spin /> {assocPhase}</> : <><Icon name="zap" size={14} /> Generate Service ({selRepos.length} repos selected)</>}
          </button>
        </div>

        {/* Templates section */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
                Ready-to-Build Templates
              </h3>
              <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>Pre-configured repo combinations — one click to generate</p>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['All', 'Starter', 'Advanced'].map(f => (
                <span key={f} className="btn-pill" style={{ cursor: 'default' }}>{f}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16 }}>
          {templates.map((t, i) => {
            const isActive = activeTemplate?.id === t.id;
            return (
              <div key={t.id} className="market-card"
                style={{ border: isActive ? `2px solid ${t.color}` : undefined, animationDelay: `${i * 60}ms` }}
                onClick={() => onBuildTemplate(t)}
              >
                <div style={{ padding: '20px 20px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: t.color + '10', border: `1px solid ${t.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                      {t.icon}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11 }}>{difficultyIcon[t.difficulty]}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: difficultyColor[t.difficulty] + '10', color: difficultyColor[t.difficulty], border: `1px solid ${difficultyColor[t.difficulty]}25`, fontFamily: 'var(--f-mono)', fontWeight: 600 }}>
                        {t.difficulty}
                      </span>
                    </div>
                  </div>
                  <h4 style={{ fontFamily: 'var(--f-head)', fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 2, letterSpacing: '-0.01em' }}>{t.name}</h4>
                  <p style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginBottom: 8 }}>{t.tagline}</p>
                  <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, marginBottom: 14 }}>{t.description}</p>
                </div>
                <div style={{ padding: '10px 20px', background: 'var(--bg2)', display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--border)' }}>
                  {t.repos.map(r => (
                    <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>
                      {r.split('/')[1]}
                    </span>
                  ))}
                </div>
                <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: t.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="zap" size={12} /> {isActive ? 'Building…' : 'Build this'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{t.category}</span>
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
function AssocResultCard({ result, isMobile }: { result: AssocResult; isMobile: boolean }) {
  const [activeTab, setActiveTab] = useState<'arch' | 'code' | 'deploy'>('arch');
  const content = activeTab === 'arch' ? result.architecture : activeTab === 'code' ? result.starter_code : result.deployment_strategy;
  const html = marked.parse(content) as string;

  return (
    <div className="card-float" style={{ marginBottom: 28, overflow: 'hidden' }}>
      {/* Header with gradient */}
      <div style={{ padding: isMobile ? '16px 16px' : '24px 28px', borderBottom: '1px solid var(--border)', background: 'var(--g-mesh)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="chip chip-red" style={{ fontSize: 10 }}>✓ generated</span>
              <span className="chip chip-green" style={{ fontSize: 10 }}>{result.duration_seconds.toFixed(1)}s</span>
              {result.live_web_used && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live web</span>}
            </div>
            <h3 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 20 : 26, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>
              {result.service_name}
            </h3>
            <p style={{ color: 'var(--ink2)', fontSize: 14 }}>{result.tagline}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 280 }}>
            {result.repos_combined.map(r => (
              <a key={r.repo} href={`https://github.com/${r.owner}/${r.repo}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink2)', fontFamily: 'var(--f-mono)', textDecoration: 'none', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={e => e.stopPropagation()}>
                {r.owner}/{r.repo} <span style={{ fontSize: 9, color: 'var(--amber)' }}>★{r.stars?.toLocaleString()}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', overflowX: 'auto' }}>
        {([['arch', '🏗️ Architecture'], ['code', '💻 Starter Code'], ['deploy', '🚀 Deploy Guide']] as ['arch' | 'code' | 'deploy', string][]).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '12px 22px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', background: 'transparent', color: activeTab === t ? 'var(--red)' : 'var(--ink3)', borderBottom: `2px solid ${activeTab === t ? 'var(--red)' : 'transparent'}`, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: isMobile ? '16px 16px' : '24px 28px', overflowX: 'auto' }}>
        <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 28px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--bg2)' }}>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => { copyToClipboard(content); }}>
          <Icon name="copy" size={12} /> Copy
        </button>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => { downloadFile(result.architecture + '\n\n---\n\n' + result.starter_code + '\n\n---\n\n' + result.deployment_strategy, `${result.service_name.replace(/\s/g, '-')}.md`); }}>
          <Icon name="download" size={12} /> Download All
        </button>
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
  const [filterLang, setFilterLang] = useState('');
  const languages = [...new Set(repos.map(r => r.language).filter(Boolean))] as string[];
  const filtered = filterLang ? repos.filter(r => r.language === filterLang) : repos;

  const presets = [
    { key: 'top20', label: 'Top 20 AI/ML', desc: 'jackfrued, microsoft, rasbt, openai…', count: 20, icon: '🔬' },
    { key: 'scraping', label: 'Web Scraping', desc: 'Scrapling, TinyFish, Scrapy…', count: 5, icon: '🕷️' },
    { key: 'ai', label: 'AI/LLM Stack', desc: 'LangChain, HuggingFace, llama.cpp…', count: 5, icon: '🧠' },
    { key: 'supabase_stack', label: 'SaaS Stack', desc: 'Supabase, Next.js, Tailwind…', count: 5, icon: '🚀' },
  ];

  const totalChunks = repos.reduce((s, r) => s + (r.chunk_count || 0), 0);
  const totalStars = repos.reduce((s, r) => s + (r.stars || 0), 0);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header with stats */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>
              GitHub Knowledge Base
            </h2>
            <p style={{ color: 'var(--ink3)', fontSize: 13 }}>Index repos into pgvector. Sara uses them as live context.</p>
          </div>
          {repos.length > 0 && (
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { label: 'Repos', value: repos.length, color: 'var(--red)' },
                { label: 'Chunks', value: totalChunks.toLocaleString(), color: 'var(--green)' },
                { label: 'Stars', value: totalStars >= 1000 ? `${(totalStars / 1000).toFixed(0)}k` : totalStars, color: 'var(--amber)' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: 'var(--f-head)' }}>{s.value}</p>
                  <p style={{ fontSize: 9, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk sync */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 18 }}>📦</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Bulk Index — Pre-built Packs</p>
            <p style={{ fontSize: 11, color: 'var(--ink3)' }}>One click to index top repos by category</p>
          </div>
          <span className="chip chip-amber" style={{ fontSize: 9, marginLeft: 'auto' }}>1-click</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {presets.map(p => (
            <button key={p.key} onClick={() => onBulkSync(p.key)} disabled={bulkSyncing}
              className="card-interactive" style={{ textAlign: 'left', padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22 }}>{p.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>{p.label}</p>
                <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{p.desc}</p>
              </div>
              <span className="chip chip-ink" style={{ fontSize: 10 }}>{p.count}</span>
            </button>
          ))}
        </div>
        {bulkSyncing && (
          <div style={{ marginTop: 14 }}>
            <div className="progress-indeterminate" />
            <p style={{ marginTop: 6, fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', textAlign: 'center' }}>Indexing repos…</p>
          </div>
        )}
        {bulkProgress && (
          <p style={{ marginTop: 10, fontSize: 12, fontFamily: 'var(--f-mono)', color: bulkProgress.startsWith('✓') ? 'var(--green)' : bulkProgress.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>
            {bulkProgress}
          </p>
        )}
      </div>

      {/* Single repo sync */}
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
            {syncing ? <><Spin /> Indexing…</> : <><Icon name="download" size={14} /> Index</>}
          </button>
        </div>
        {syncMsg && (
          <p style={{ marginTop: 8, fontSize: 12, fontFamily: 'var(--f-mono)', color: syncMsg.startsWith('✓') ? 'var(--green)' : syncMsg.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>
            {syncMsg}
          </p>
        )}
      </div>

      {/* Language filter */}
      {repos.length > 0 && languages.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setFilterLang('')} className="btn-pill" style={!filterLang ? { background: 'var(--red-s)', borderColor: 'var(--red)', color: 'var(--red)' } : {}}>All</button>
          {languages.map(l => (
            <button key={l} onClick={() => setFilterLang(filterLang === l ? '' : l)} className="btn-pill"
              style={filterLang === l ? { background: 'var(--red-s)', borderColor: 'var(--red)', color: 'var(--red)' } : {}}>
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Repo list */}
      {repos.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>◇</p>
          <p style={{ color: 'var(--ink3)', fontSize: 14, marginBottom: 4 }}>No repos indexed yet</p>
          <p style={{ color: 'var(--ink4)', fontSize: 12 }}>Use Bulk Index above to get started in one click</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => (
            <div key={r.id} className="card-interactive" onClick={() => onToggle(r.id)}
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, border: r.selected ? '1px solid var(--red)' : undefined, background: r.selected ? 'var(--red-s)' : undefined }}>
              {/* Checkbox */}
              <div style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${r.selected ? 'var(--red)' : 'var(--border2)'}`, background: r.selected ? 'var(--red)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                {r.selected && <Icon name="check" size={12} className="" />}
                {r.selected && <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--f-mono)', color: r.selected ? 'var(--red)' : 'var(--ink)' }}>{r.owner}/{r.repo}</span>
                  {r.language && <span className="chip chip-ink" style={{ fontSize: 9, padding: '0 6px' }}>{r.language}</span>}
                  {r.indexed_at && <span className="chip chip-green" style={{ fontSize: 8, padding: '0 5px' }}>indexed</span>}
                </div>
                {r.description && <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</p>}
              </div>
              {/* Stats */}
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
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════════
function SettingsTab({ cfg, onChange, envUrl, envKey }: {
  cfg: Settings; onChange: (s: Settings) => void; envUrl: string; envKey: string;
}) {
  const [local, setLocal] = useState(cfg);
  const set = (k: keyof Settings, v: string | number | boolean) => setLocal(p => ({ ...p, [k]: v }));

  function Section({ title, icon, color = 'var(--ink)', children }: { title: string; icon: string; color?: string; children: React.ReactNode }) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <p style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--f-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</p>
        </div>
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
    { value: 'engineer', label: '🏗️ Principal Engineer — architecture-first' },
    { value: 'researcher', label: '🔬 Research Scientist — papers, citations' },
    { value: 'founder', label: '🚀 Technical Co-Founder — product × engineering' },
    { value: 'tutor', label: '📚 Patient Tutor — step by step' },
    { value: 'hacker', label: '⚡ Speed Hacker — fast, direct' },
  ];

  const hasEnvCreds = !!(envUrl && envKey);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>Configuration</h2>
        <span className="chip chip-ink" style={{ fontSize: 9 }}>v1.0</span>
      </div>

      {/* Supabase */}
      <Section title="Supabase — Backend" icon="◈" color="var(--red)">
        {hasEnvCreds ? (
          <div style={{ padding: 16, borderRadius: 10, background: 'var(--green-s)', border: '1px solid var(--green-m)' }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot-done" /> Connected via environment variables
            </p>
            <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
              VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY injected at build time. Update in Vercel → Settings → Environment Variables.
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="dot-err" /> Not connected
              </p>
              <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, or enter manually below.
              </p>
            </div>
            <Field label="Project URL" field="supabaseUrl" ph="https://xxxx.supabase.co" />
            <Field label="Anon Key" field="supabaseKey" type="password" ph="eyJhbGci…" />
          </>
        )}
      </Section>

      {/* AI Model */}
      <Section title="AI Model — Groq" icon="⚡" color="var(--green)">
        <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, background: 'var(--green-s)', border: '1px solid var(--green-m)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>Groq API key → Supabase Secret</p>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 4, lineHeight: 1.6 }}>
            Supabase Dashboard → Edge Functions → Secrets → GROQ_API_KEY
          </p>
          <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--green)', display: 'inline-block', marginTop: 4 }}>
            → Free key at console.groq.com
          </a>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>Model</label>
          <select value={local.model} onChange={e => set('model', e.target.value)} className="sara-input" style={{ cursor: 'pointer' }}>
            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>Persona</label>
          <select value={local.persona} onChange={e => set('persona', e.target.value)} className="sara-input" style={{ cursor: 'pointer' }}>
            {personas.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </Section>

      {/* Web */}
      <Section title="Live Web Intelligence" icon="🌐" color="var(--blue)">
        <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, background: 'var(--blue-s)', border: '1px solid var(--blue-m)' }}>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
            Set TINYFISH_API_KEY + GEMINI_API_KEY + OPENROUTER_API_KEY as Supabase Secrets.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            <a href="https://tinyfish.ai" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--blue)' }}>tinyfish.ai</a>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--blue)' }}>Gemini key</a>
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--blue)' }}>OpenRouter key</a>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
          {[
            { field: 'webEnabled' as const, label: 'Web browsing' },
            { field: 'scrapingEnabled' as const, label: 'Scrapling' },
          ].map(c => (
            <label key={c.field} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
              <input type="checkbox" checked={!!local[c.field]} onChange={e => set(c.field, e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--red)' }} />
              {c.label}
            </label>
          ))}
        </div>
      </Section>

      {/* Generation */}
      <Section title="Generation Parameters" icon="◆" color="var(--ink2)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Temperature', field: 'temperature' as const, min: 0, max: 2, step: 0.05, fmt: (v: number) => v.toFixed(2), note: '0 = precise · 2 = creative' },
            { label: 'Max Tokens', field: 'maxTokens' as const, min: 512, max: 8192, step: 256, fmt: (v: number) => v.toLocaleString(), note: 'Max response length' },
            { label: 'Context', field: 'contextWindow' as const, min: 2, max: 20, step: 1, fmt: (v: number) => `${v} msgs`, note: 'History depth' },
            { label: 'RAG Chunks', field: 'ragChunks' as const, min: 1, max: 15, step: 1, fmt: (v: number) => `${v}`, note: 'Knowledge per query' },
          ].map(p => (
            <div key={p.field}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>{p.label}</label>
                <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>{p.fmt(Number(local[p.field]))}</span>
              </div>
              <input type="range" min={p.min} max={p.max} step={p.step} value={Number(local[p.field])} onChange={e => set(p.field, Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--red)' }} />
              <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 3 }}>{p.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* System prompt */}
      <Section title="Custom System Prompt" icon="◈" color="var(--ink3)">
        <textarea value={local.systemPrompt} onChange={e => set('systemPrompt', e.target.value)}
          placeholder="Leave empty for Sara's default persona. Add domain expertise here…"
          className="sara-input" rows={4} style={{ resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
        <p style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 6 }}>
          Injected AFTER Sara's core identity.
        </p>
      </Section>

      {/* Deploy checklist */}
      <div style={{ borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: 20, background: 'var(--ink)', color: 'white' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            Deploy Checklist
          </p>
          <pre style={{ fontSize: 11, lineHeight: 2, color: '#d4f0c0', fontFamily: 'var(--f-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{`# Vercel Environment Variables
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci…

# Supabase Secrets (Edge Functions)
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-...
TINYFISH_API_KEY=tf_...
GITHUB_TOKEN=ghp_...

# Deploy Edge Functions
npx supabase functions deploy chat
npx supabase functions deploy chat-gemini
npx supabase functions deploy chat-openrouter
npx supabase functions deploy chat-duo
npx supabase functions deploy multiagent
npx supabase functions deploy associate
npx supabase functions deploy github-sync
npx supabase functions deploy bulk-sync`}</pre>
        </div>
      </div>

      {/* Save button */}
      <button className="btn-red" onClick={() => onChange(local)}
        style={{ width: '100%', padding: '14px 20px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow), var(--red-glow)' }}>
        <Icon name="check" size={16} /> Save Configuration
      </button>
    </div>
  );
}