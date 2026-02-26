import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import { useIsMobile } from './hooks/use-mobile';

marked.setOptions({ breaks: true, gfm: true });

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type Tab = 'chat' | 'market' | 'repos' | 'settings';
type Mode = 'llama' | 'gemini' | 'openrouter' | 'llama-gemini' | 'llama-openrouter' | 'gemini-openrouter' | 'multi';
type AgentId = 'researcher' | 'analyst' | 'critic' | 'synthesizer';
type AgentStatus = 'idle' | 'thinking' | 'done';

interface AttachedFile {
  id: string; name: string; type: string; size: number;
  content: string; isImage: boolean; isText: boolean;
  url?: string; extracting?: boolean;
}

interface Msg {
  id: string; role: 'user' | 'sara'; content: string; ts: number;
  mode?: Mode; ragUsed?: boolean; webUsed?: boolean; scrapingUsed?: boolean;
  durationMs?: number; err?: boolean; agentOutputs?: Partial<Record<AgentId, string>>;
  files?: AttachedFile[];
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

// â”€â”€ Agents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AGENTS: Record<AgentId, { label: string; color: string; icon: string }> = {
  researcher:  { label: 'Researcher',  color: '#1a4a8b', icon: 'ðŸ”' },
  analyst:     { label: 'Architect',   color: '#1a7a4a', icon: 'ðŸ—ï¸' },
  critic:      { label: 'Critic',      color: '#8b1a1a', icon: 'âš¡' },
  synthesizer: { label: 'Synthesizer', color: '#7a4a0a', icon: 'âœ¦' },
};

// â”€â”€ Market templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MARKET_TEMPLATES: MarketTemplate[] = [
  { id: 'neural-scraper', name: 'NeuralScraper', tagline: 'Web intelligence platform â€” Scrapling + TinyFish + LLaMA', category: 'Web Intelligence', repos: ['D4Vinci/Scrapling', 'tinyfish-io/tinyfish-cookbook'], difficulty: 'intermediate', color: '#8b1a1a', icon: 'ðŸ•·ï¸', description: 'Adaptive scraping with anti-bot bypass + AI-powered data extraction. Handles Cloudflare, dynamic JS, auto-recovers broken selectors.' },
  { id: 'llm-data-forge', name: 'LLM DataForge', tagline: 'Live data pipeline â€” LLM App + Data Engineer Handbook', category: 'Data Pipeline', repos: ['pathwaycom/llm-app', 'DataExpert-io/data-engineer-handbook'], difficulty: 'advanced', color: '#1a4a8b', icon: 'âš™ï¸', description: 'Real-time LLM data pipeline with streaming ingestion, vector indexing, and production data engineering patterns.' },
  { id: 'agent-academy', name: 'AgentAcademy', tagline: 'AI agent builder â€” ai-agents-for-beginners + openai-cookbook', category: 'AI Agents', repos: ['microsoft/ai-agents-for-beginners', 'openai/openai-cookbook'], difficulty: 'starter', color: '#1a7a4a', icon: 'ðŸ¤–', description: 'Build autonomous AI agents using Microsoft best practices + OpenAI patterns. Includes tool use, memory, and planning loops.' },
  { id: 'vision-api', name: 'VisionAPI', tagline: 'Image generation service â€” Stable Diffusion + SAM + CLIP', category: 'Computer Vision', repos: ['CompVis/stable-diffusion', 'facebookresearch/segment-anything', 'openai/CLIP'], difficulty: 'advanced', color: '#7a4a0a', icon: 'ðŸŽ¨', description: 'Image generation + segmentation + understanding pipeline. Generate, segment, and semantically search images in one API.' },
  { id: 'llm-from-scratch', name: 'TrainYourLLM', tagline: 'Build and train LLMs from scratch', category: 'Foundation Models', repos: ['rasbt/LLMs-from-scratch', 'ggerganov/llama.cpp'], difficulty: 'advanced', color: '#4a1a7a', icon: 'ðŸ§ ', description: 'Full LLM training pipeline from tokenizer to transformer, with llama.cpp for efficient local inference.' },
  { id: 'data-science-hub', name: 'DataScienceHub', tagline: 'End-to-end ML platform â€” Python 100 Days + Pandas + TF', category: 'Machine Learning', repos: ['jackfrued/Python-100-Days', 'aymericdamien/TensorFlow-Examples'], difficulty: 'starter', color: '#1a6a4a', icon: 'ðŸ“Š', description: 'Complete data science environment with Python best practices, TensorFlow examples, and structured learning path.' },
];

// â”€â”€ Env vars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ENV_URL = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
const ENV_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

// â”€â”€ Defaults & persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Icons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN APP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export default function Sara() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('chat');
  const [mode, setMode] = useState<Mode>('llama');
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
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // â•â•â• FIX #1: refs manquants â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // â•â•â• FIX #2: helpers agent status manquants â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const setA = useCallback((id: AgentId, status: AgentStatus) => {
    setAStatus(p => ({ ...p, [id]: status }));
  }, []);

  const resetA = useCallback(() => {
    setAStatus({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });
  }, []);

  // â•â•â• Supabase client â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const sbRef = useRef<ReturnType<typeof createClient> | null>(null);

  const loadRepos = useCallback(async () => {
    if (!sbRef.current) return;
    const { data } = await sbRef.current.from('github_repos').select('*').order('stars', { ascending: false });
    if (data) setRepos(data.map((r: Repo) => ({ ...r, selected: false })));
  }, []);

  useEffect(() => {
    sbRef.current = (cfg.supabaseUrl && cfg.supabaseKey)
      ? createClient(cfg.supabaseUrl, cfg.supabaseKey)
      : null;
    if (sbRef.current) loadRepos();
  }, [cfg.supabaseUrl, cfg.supabaseKey, loadRepos]);

  const sb = sbRef.current ?? ((cfg.supabaseUrl && cfg.supabaseKey) ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // â”€â”€ FILE EXTRACTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const extractFileContent = async (file: File): Promise<AttachedFile> => {
    const id = `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml|toml|env|sh|sql)$/i.test(file.name);
    const isPDF = file.type === 'application/pdf';
    const isZip = file.type === 'application/zip' || file.name.endsWith('.zip') || file.name.endsWith('.gz');
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');

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
        const uint8 = new Uint8Array(buf);
        const rawStr = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
        const textMatches = rawStr.match(/\(([^)]{4,500})\)/g) ?? [];
        const text = textMatches
          .map(m => m.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\/g, ''))
          .filter(t => t.trim().length > 3 && /[a-zA-Z]/.test(t))
          .join(' ')
          .replace(/\s+/g, ' ')
          .slice(0, 12000);
        return { id, name: file.name, type: file.type, size: file.size, content: text || `[PDF: ${file.name} â€” contenu binaire]`, isImage: false, isText: true };
      } catch {
        return { id, name: file.name, type: file.type, size: file.size, content: `[PDF: ${file.name}]`, isImage: false, isText: true };
      }
    }

    if (isExcel) {
      try {
        const buf = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 8000);
        return { id, name: file.name, type: file.type, size: file.size, content: text, isImage: false, isText: true };
      } catch {
        return { id, name: file.name, type: file.type, size: file.size, content: `[Excel: ${file.name}]`, isImage: false, isText: true };
      }
    }

    if (isZip) {
      return { id, name: file.name, type: file.type, size: file.size, content: `[Archive: ${file.name} â€” ${(file.size / 1024).toFixed(0)} KB]`, isImage: false, isText: false };
    }

    try {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve({ id, name: file.name, type: file.type, size: file.size, content: (e.target?.result as string).slice(0, 10000), isImage: false, isText: true });
        reader.onerror = () => resolve({ id, name: file.name, type: file.type, size: file.size, content: `[Fichier: ${file.name}]`, isImage: false, isText: false });
        reader.readAsText(file);
      });
    } catch {
      return { id, name: file.name, type: file.type, size: file.size, content: `[Fichier: ${file.name}]`, isImage: false, isText: false };
    }
  };

  const uploadFileToStorage = async (file: File): Promise<string | undefined> => {
    if (!sb) return undefined;
    try {
      const path = `${sessionId ?? 'anon'}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error } = await sb.storage.from('sara-uploads').upload(path, file, { upsert: true });
      if (error) return undefined;
      const { data } = sb.storage.from('sara-uploads').getPublicUrl(path);
      return data?.publicUrl;
    } catch { return undefined; }
  };

  const handleFiles = async (rawFiles: FileList | File[]) => {
    const arr = Array.from(rawFiles);
    if (!arr.length) return;
    const placeholders: AttachedFile[] = arr.map(f => ({
      id: `f${Date.now()}_${f.name}`, name: f.name, type: f.type, size: f.size,
      content: '', isImage: f.type.startsWith('image/'), isText: false, extracting: true,
    }));
    setFiles(p => [...p, ...placeholders]);
    setUploading(true);
    const results: AttachedFile[] = [];
    for (let i = 0; i < arr.length; i++) {
      const extracted = await extractFileContent(arr[i]);
      const url = await uploadFileToStorage(arr[i]);
      if (url) extracted.url = url;
      extracted.extracting = false;
      results.push(extracted);
    }
    setFiles(p => p.map(f => {
      const match = results.find(r => r.name === f.name && f.extracting);
      return match ?? f;
    }));
    setUploading(false);
    if (!input.trim() && results.length === 1) {
      const autoMsg = results[0].isImage ? 'Analyse cette image et dÃ©cris son contenu en dÃ©tail.' : `Analyse ce fichier : ${results[0].name}`;
      setInput(autoMsg);
    }
  };

  // â”€â”€ SEND â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const send = useCallback(async () => {
    const text = input.trim();
    const readyFiles = files.filter(f => !f.extracting);
    if ((!text && !readyFiles.length) || loading || !sb) {
      if (!sb) setErrMsg('Configure Supabase dans Settings');
      return;
    }
    const msgText = text || `Analyse ce fichier : ${readyFiles[0]?.name}`;
    setInput(''); resetA(); setErrMsg('');
    setFiles([]);
    setMsgs(p => [...p, { id: `u${Date.now()}`, role: 'user', content: msgText, ts: Date.now(), files: readyFiles.length ? readyFiles : undefined }]);
    setLoading(true);

    const history = msgs.slice(-cfg.contextWindow).map(m => ({
      role: m.role === 'sara' ? 'assistant' : 'user',
      content: m.content,
    }));

    const isDuo = mode === 'llama-gemini' || mode === 'llama-openrouter' || mode === 'gemini-openrouter';
    const fn = mode === 'multi' ? 'multiagent'
      : mode === 'gemini' ? 'chat-gemini'
      : mode === 'openrouter' ? 'chat-openrouter'
      : isDuo ? 'chat-duo'
      : 'chat';

    try {
      if (mode === 'multi') {
        const order: AgentId[] = ['researcher', 'analyst', 'critic', 'synthesizer'];
        let i = 0;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          if (i > 0) setA(order[i - 1], 'done');
          if (i < order.length) { setA(order[i], 'thinking'); i++; }
          else { if (timerRef.current) clearInterval(timerRef.current); }
        }, 2100);
      } else if (isDuo) {
        setA('researcher', 'thinking'); setA('critic', 'thinking');
        setTimeout(() => { setA('researcher', 'done'); setA('critic', 'done'); setA('synthesizer', 'thinking'); }, 3500);
      } else {
        setA('synthesizer', 'thinking');
      }

      const t0 = Date.now();
      const serializedFiles = readyFiles.map(f => ({
        name: f.name, type: f.type, size: f.size, isImage: f.isImage, isText: f.isText,
        content: f.isImage ? f.content.slice(0, 500000) : f.content.slice(0, 20000),
        url: f.url,
      }));

      const body: Record<string, unknown> = {
        message: msgText, session_id: sessionId,
        history, repos: repos.filter(r => r.selected).map(r => r.id),
        files: serializedFiles.length ? serializedFiles : undefined,
      };
      if (isDuo) body.models = mode.split('-');

      const { data, error } = await sb.functions.invoke(fn, { body });

      if (timerRef.current) clearInterval(timerRef.current);
      (Object.keys(AGENTS) as AgentId[]).forEach(k => setA(k, 'done'));
      if (error) throw error;

      if (data?.session_id) setSessionId(data.session_id);
      setMsgs(p => [...p, {
        id: `s${Date.now()}`, role: 'sara',
        content: data?.answer ?? 'Pas de rÃ©ponse',
        ts: Date.now(), mode,
        ragUsed: data?.rag_used, webUsed: data?.web_used,
        durationMs: Date.now() - t0,
        agentOutputs: (mode === 'multi' || isDuo)
          ? { researcher: data?.researcher_findings, analyst: data?.analyst_analysis, critic: data?.critic_critique, synthesizer: data?.answer }
          : undefined,
      }]);
    } catch (e: unknown) {
      if (timerRef.current) clearInterval(timerRef.current);
      resetA();
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      setErrMsg(msg);
      setMsgs(p => [...p, { id: `e${Date.now()}`, role: 'sara', content: `**Erreur**\n\n${msg}`, ts: Date.now(), err: true }]);
    } finally { setLoading(false); }
  }, [input, files, loading, mode, msgs, sb, repos, sessionId, cfg, setA, resetA]);

  // â”€â”€ ASSOCIATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const associate = useCallback(async (repoOverrides?: string[], goalOverride?: string) => {
    const sel = repoOverrides ?? repos.filter(r => r.selected).map(r => r.id);
    if (sel.length < 2) { setErrMsg('Select at least 2 repos'); return; }
    if (!sb) { setErrMsg('Configure Supabase first'); return; }
    setAssociating(true); setAssocResult(null); setErrMsg('');
    const phases = ['Browsing live repo pagesâ€¦', 'Analyzing integration pointsâ€¦', 'Designing architectureâ€¦', 'Generating starter codeâ€¦', 'Writing deploy guideâ€¦'];
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
    } catch (e: unknown) { clearInterval(pt); setErrMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setAssociating(false); setAssocPhase(''); }
  }, [repos, sb, assocGoal, mode]);

  // â”€â”€ SYNC REPO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const syncRepo = async () => {
    if (!repoInput.trim() || syncing || !sb) return;
    const parts = repoInput.trim().replace('https://github.com/', '').split('/');
    if (parts.length < 2) { setSyncMsg('Format: owner/repo'); return; }
    const [owner, repo] = parts;
    setSyncing(true); setSyncMsg(`Indexing ${owner}/${repo}â€¦`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('github-sync', { body: { owner, repo } });
      if (fnErr) throw new Error(fnErr.message);
      setSyncMsg(`âœ“ ${owner}/${repo} â€” ${data.chunks_created} chunks`);
      setRepoInput(''); await loadRepos();
    } catch (e: unknown) { setSyncMsg(`âœ— ${e instanceof Error ? e.message : 'Failed'}`); }
    finally { setSyncing(false); }
  };

  // â”€â”€ BULK SYNC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const bulkSync = async (preset: string) => {
    if (!sb || bulkSyncing) return;
    setBulkSyncing(true); setBulkProgress(`Starting bulk sync (${preset})â€¦`);
    try {
      const { data, error: fnErr } = await sb.functions.invoke('bulk-sync', { body: { use_preset: preset } });
      if (fnErr) throw new Error(fnErr.message);
      setBulkProgress(`âœ“ ${data.repos_succeeded}/${data.repos_processed} repos Â· ${data.total_chunks} chunks`);
      await loadRepos();
    } catch (e: unknown) { setBulkProgress(`âœ— ${e instanceof Error ? e.message : 'Error'}`); }
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // RENDER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', fontFamily: 'var(--f-body)', overflow: 'hidden' }}
      className="grain"
    >
      {/* â”€â”€ HEADER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 14px' : '0 24px',
        height: isMobile ? 52 : 56,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, boxShadow: 'var(--shadow-sm)', zIndex: 10,
      }}>
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
                Groq Â· LLaMA 3.3 70B Â· Gemini Â· OpenRouter
              </p>
            )}
          </div>
        </div>

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

        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
          <ModelSelector mode={mode} setMode={setMode} isMobile={isMobile} />
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

      {/* â”€â”€ BODY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {!isMobile && tab === 'chat' && (
          <aside style={{ width: 200, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {mode === 'multi' ? 'Pipeline 4Ã—' : mode.includes('-') ? `Duo Â· ${mode.replace('-',' + ')}` : `Solo Â· ${mode}`}
              </p>
            </div>
            <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => {
                const isSolo = mode === 'llama' || mode === 'gemini' || mode === 'openrouter';
                if (isSolo && id !== 'synthesizer') return null;
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
                <p style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>â¬¡ {selRepos.length} repo{selRepos.length !== 1 ? 's' : ''}</p>
                <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>Knowledge active</p>
              </div>
            )}
          </aside>
        )}

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>

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
                          <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Sara thinkingâ€¦</span>
                        </div>
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div
                style={{ flexShrink: 0, padding: isMobile ? '10px 14px 14px' : '16px 24px 20px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'var(--bg2)'; }}
                onDragLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.background = 'var(--surface)'; handleFiles(e.dataTransfer.files); }}
              >
                {errMsg && (
                  <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, fontFamily: 'var(--f-mono)', lineHeight: 1.5 }}>
                    {errMsg}
                  </div>
                )}
                {files.length > 0 && (
                  <div style={{ maxWidth: 780, margin: '0 auto 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {files.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 6px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 12, maxWidth: 200 }}>
                        {f.extracting ? (
                          <Spin />
                        ) : f.isImage ? (
                          <img src={f.content} alt={f.name} style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 14 }}>{f.name.endsWith('.pdf') ? 'ðŸ“„' : f.name.endsWith('.zip') ? 'ðŸ“¦' : f.name.match(/\.(xls|xlsx|csv)$/) ? 'ðŸ“Š' : 'ðŸ“'}</span>
                        )}
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                        {f.url && <span style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'var(--f-mono)' }}>â†‘</span>}
                        <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink4)', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>Ã—</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8 }}>
                  <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }}
                    onChange={e => e.target.files && handleFiles(e.target.files)} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                    style={{ padding: '0 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', cursor: 'pointer', flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', color: files.length > 0 ? 'var(--green)' : 'var(--ink3)', fontSize: 16, transition: 'all 0.15s' }}
                    title="Joindre un fichier">
                    {uploading ? <Spin /> : 'ðŸ“Ž'}
                    {files.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--green)', marginLeft: 2 }}>{files.length}</span>}
                  </button>
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    onPaste={e => {
                      const items = Array.from(e.clipboardData.items);
                      const imageItem = items.find(i => i.type.startsWith('image/'));
                      if (imageItem) { const f = imageItem.getAsFile(); if (f) { e.preventDefault(); handleFiles([f]); } }
                    }}
                    placeholder={files.length > 0 ? 'Instructions pour ce fichierâ€¦ (ou EntrÃ©e pour analyse auto)' : mode === 'multi' ? 'Multi-agent 4Ã—â€¦' : mode.includes('-') ? `Duo ${mode}â€¦` : `Ask Sara (${mode})â€¦`}
                    rows={isMobile ? 1 : 2}
                    disabled={loading}
                    className="sara-input"
                    style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
                  />
                  <button
                    onClick={send}
                    disabled={(!input.trim() && !files.length) || loading}
                    className="btn-primary"
                    style={{ padding: isMobile ? '0 14px' : '0 20px', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'stretch', flexShrink: 0 }}
                  >
                    {loading ? <Spin /> : <Icon name="send" size={14} />}
                    {!isMobile && (loading ? 'Wait' : 'Send')}
                  </button>
                </div>
                {!isMobile && (
                  <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
                    {mode === 'multi' ? 'LLaMA Ã— Gemini Ã— OpenRouter Â· 4 agents' : mode.includes('-') ? `${mode.replace('-',' + ')} Â· duo` : `${mode} Â· solo`} Â· ðŸ“Ž glisser-dÃ©poser Â· Enter â†µ
                  </p>
                )}
              </div>
            </>
          )}

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

          {tab === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <SettingsTab cfg={cfg} onChange={s => { setCfg(s); saveCfg(s); }} envUrl={ENV_URL} envKey={ENV_KEY} />
            </div>
          )}
        </main>
      </div>

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MODEL SELECTOR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const MODE_COLORS: Record<Mode, string> = {
  llama: '#1a1a1a', gemini: '#1a5a8b', openrouter: '#5a1a8b',
  'llama-gemini': '#1a6a5a', 'llama-openrouter': '#4a1a6a', 'gemini-openrouter': '#2a3a8b',
  multi: '#8b1a1a',
};
const MODE_LABELS: Record<Mode, { short: string; long: string; desc: string }> = {
  llama:              { short: 'LLaMA',   long: 'LLaMA 3.3 70B',              desc: 'Groq Â· ultra-rapide' },
  gemini:             { short: 'Gemini',  long: 'Gemini 2.0 Flash',           desc: 'Google AI' },
  openrouter:         { short: 'Router',  long: 'OpenRouter',                 desc: '200+ modÃ¨les' },
  'llama-gemini':     { short: 'L+G',     long: 'LLaMA Ã— Gemini',            desc: 'Duo Â· 2 agents parallÃ¨les' },
  'llama-openrouter': { short: 'L+R',     long: 'LLaMA Ã— OpenRouter',        desc: 'Duo Â· 2 agents parallÃ¨les' },
  'gemini-openrouter':{ short: 'G+R',     long: 'Gemini Ã— OpenRouter',       desc: 'Duo Â· 2 agents parallÃ¨les' },
  multi:              { short: '4Ã—',      long: 'LLaMA + Gemini + OpenRouter', desc: '4 agents Â· synthÃ¨se LLaMA' },
};

function ModelSelector({ mode, setMode, isMobile }: { mode: Mode; setMode: (m: Mode) => void; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const solos: Mode[] = ['llama', 'gemini', 'openrouter'];
  const current = MODE_LABELS[mode];
  const duos: Mode[] = ['llama-gemini', 'llama-openrouter', 'gemini-openrouter'];

  function Section({ title, modes }: { title: string; modes: Mode[] }) {
    return (
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>{title}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {modes.map(m => {
            const l = MODE_LABELS[m];
            const active = mode === m;
            return (
              <button key={m} onClick={() => { setMode(m); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8, border: active ? `1px solid ${MODE_COLORS[m]}40` : '1px solid transparent',
                  background: active ? `${MODE_COLORS[m]}12` : 'transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', width: '100%',
                }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: MODE_COLORS[m], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? MODE_COLORS[m] : 'var(--ink)', fontFamily: 'var(--f-body)', lineHeight: 1.2 }}>{l.long}</p>
                  <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', lineHeight: 1.3, marginTop: 1 }}>{l.desc}</p>
                </div>
                {active && <span style={{ fontSize: 10, color: MODE_COLORS[m], fontFamily: 'var(--f-mono)', fontWeight: 700 }}>â—</span>}
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
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: isMobile ? '5px 9px' : '6px 12px',
          borderRadius: 8, border: `1px solid ${MODE_COLORS[mode]}40`,
          background: `${MODE_COLORS[mode]}12`,
          cursor: 'pointer', transition: 'all 0.15s',
        }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: MODE_COLORS[mode] }} />
        <span style={{ fontSize: isMobile ? 10 : 12, fontWeight: 700, fontFamily: 'var(--f-mono)', color: MODE_COLORS[mode] }}>
          {current.short}
        </span>
        <span style={{ fontSize: 9, color: 'var(--ink4)', transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>â–¾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 230, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 100,
          padding:        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 230, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 100,
          padding: '12px 10px',
        }}>
          <Section title="Solo" modes={solos} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 12px' }} />
          <Section title="Duo — n-agent" modes={duos} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 12px' }} />
          <Section title="Quad — 4× pipeline" modes={['multi']} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT EMPTY
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
            <span className="chip chip-red">Gemini 2.0</span>
            <span className="chip chip-blue">OpenRouter</span>
            <span className="chip chip-green">pgvector RAG</span>
            {selRepos.length > 0 && <span className="chip chip-amber">⬡ {selRepos.length} repos active</span>}
          </div>
        </div>
      </div>

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
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
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
          <div style={{ maxWidth: isMobile ? '85%' : '72%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {msg.files?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                {msg.files.map(f => f.isImage ? (
                  <img key={f.id} src={f.content} alt={f.name} style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div key={f.id} style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink2)' }}>
                    {f.name.endsWith('.pdf') ? '📄' : f.name.endsWith('.zip') ? '📦' : '📝'} {f.name}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ padding: '12px 16px', borderRadius: '16px 16px 4px 16px', background: 'var(--ink)', color: 'white', fontSize: 14, lineHeight: 1.6, boxShadow: 'var(--shadow-sm)', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
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
            {msg.mode?.includes('-') && <span className="chip chip-blue" style={{ fontSize: 10 }}>duo·{msg.mode}</span>}
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

        <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
          Ready-to-Build Templates
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
          {templates.map(t => {
            const isActive = activeTemplate?.id === t.id;
            return (
              <div key={t.id} className="market-card"
                style={{ border: isActive ? `2px solid ${t.color}` : undefined, cursor: 'pointer' }}
                onClick={() => onBuildTemplate(t)}>
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
// SETTINGS TAB
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

      <Section title="◈ Supabase — Backend" color="var(--red)">
        {hasEnvCreds ? (
          <div style={{ padding: 14, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.25)' }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 4 }}>
              ✓ Connected via Vercel environment variables
            </p>
            <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
              VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are injected at build time.
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>⚠ Not connected</p>
              <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, or enter below.
              </p>
            </div>
            <Field label="Project URL" field="supabaseUrl" ph="https://xxxx.supabase.co" hint="Supabase Dashboard → Settings → API" />
            <Field label="Anon Key" field="supabaseKey" type="password" ph="eyJhbGci…" hint="Supabase Dashboard → Settings → API" />
          </>
        )}
      </Section>

      <Section title="⚡ AI Model — Groq" color="var(--green)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.2)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>API keys → Supabase Secrets</p>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 2, lineHeight: 1.6 }}>
            Supabase Dashboard → Edge Functions → Secrets → Add GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
          </p>
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

      <Section title="🌐 Live Web Intelligence" color="var(--blue)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--blue-s)', border: '1px solid rgba(26,74,139,0.2)' }}>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
            Set TINYFISH_API_KEY as Supabase Secret to enable live web browsing.
          </p>
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

      <Section title="◈ Custom System Prompt" color="var(--ink3)">
        <textarea value={local.systemPrompt} onChange={e => set('systemPrompt', e.target.value)}
          placeholder="Leave empty to use Sara's default engineering persona…"
          className="sara-input" rows={4} style={{ resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
        <p style={{ fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginTop: 6 }}>
          Injected AFTER Sara's core identity. Use to add domain expertise.
        </p>
      </Section>

      <div className="card" style={{ padding: 20, marginBottom: 20, background: 'var(--ink)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Complete Deploy Checklist
        </p>
        <pre style={{ fontSize: 11, lineHeight: 2, color: '#90e080', fontFamily: 'var(--f-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{`# ── Vercel Environment Variables ────────────────
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci…

# ── Supabase Secrets (Edge Functions) ────────────
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-...
TINYFISH_API_KEY=tf_...        # optional
GITHUB_TOKEN=ghp_...           # optional`}</pre>
      </div>

      <button className="btn-red" onClick={() => onChange(local)}
        style={{ width: '100%', padding: '14px 20px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow)' }}>
        <Icon name="check" size={16} /> Save Configuration
      </button>
    </div>
  );
}