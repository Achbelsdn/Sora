import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';
import { useIsMobile } from './hooks/use-mobile';

marked.setOptions({ breaks: true, gfm: true });

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'chat' | 'market' | 'repos' | 'settings';
type Mode = 'llama' | 'gemini' | 'openrouter' | 'llama-gemini' | 'llama-openrouter' | 'gemini-openrouter' | 'multi';
type AgentId = 'researcher' | 'analyst' | 'critic' | 'synthesizer';
type AgentStatus = 'idle' | 'thinking' | 'done';

interface AttachedFile {
  id: string; name: string; type: string; size: number;
  content: string; isImage: boolean; isText: boolean;
  url?: string; extracting?: boolean; preview?: string;
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
interface GitHubSearchRepo {
  github_id: number; full_name: string; name: string; owner: string;
  avatar_url: string; description: string | null; stars: number;
  language: string | null; topics: string[]; url: string;
  updated_at: string; license: string | null; forks: number;
  issues: number; default_branch: string;
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

// ── Market templates (suggestions rapides) ─────────────────────────────────
const MARKET_TEMPLATES: MarketTemplate[] = [
  { id: 'neural-scraper', name: 'NeuralScraper', tagline: 'Web intelligence — Scrapling + TinyFish + LLaMA', category: 'Web Intelligence', repos: ['D4Vinci/Scrapling', 'tinyfish-io/tinyfish-cookbook'], difficulty: 'intermediate', color: '#8b1a1a', icon: '🕷️', description: 'Adaptive scraping with anti-bot bypass + AI data extraction.' },
  { id: 'llm-data-forge', name: 'LLM DataForge', tagline: 'Live data pipeline — LLM App + Data Engineer Handbook', category: 'Data Pipeline', repos: ['pathwaycom/llm-app', 'DataExpert-io/data-engineer-handbook'], difficulty: 'advanced', color: '#1a4a8b', icon: '⚙️', description: 'Real-time LLM data pipeline with streaming ingestion and vector indexing.' },
  { id: 'agent-academy', name: 'AgentAcademy', tagline: 'AI agent builder — Microsoft + OpenAI', category: 'AI Agents', repos: ['microsoft/ai-agents-for-beginners', 'openai/openai-cookbook'], difficulty: 'starter', color: '#1a7a4a', icon: '🤖', description: 'Build autonomous AI agents with tool use, memory, and planning.' },
  { id: 'vision-api', name: 'VisionAPI', tagline: 'Image pipeline — SD + SAM + CLIP', category: 'Computer Vision', repos: ['CompVis/stable-diffusion', 'facebookresearch/segment-anything', 'openai/CLIP'], difficulty: 'advanced', color: '#7a4a0a', icon: '🎨', description: 'Generate, segment, and search images in one API.' },
  { id: 'llm-from-scratch', name: 'TrainYourLLM', tagline: 'Build LLMs from scratch', category: 'Foundation Models', repos: ['rasbt/LLMs-from-scratch', 'ggerganov/llama.cpp'], difficulty: 'advanced', color: '#4a1a7a', icon: '🧠', description: 'Full LLM training from tokenizer to inference.' },
  { id: 'data-science-hub', name: 'DataScienceHub', tagline: 'End-to-end ML platform', category: 'Machine Learning', repos: ['jackfrued/Python-100-Days', 'aymericdamien/TensorFlow-Examples'], difficulty: 'starter', color: '#1a6a4a', icon: '📊', description: 'Complete data science environment with examples.' },
];

// ── File type detection ────────────────────────────────────────────────────
function detectFileCategory(name: string, type: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (['ts','tsx','js','jsx','py','rs','go','java','c','cpp','h','rb','php','swift','kt','scala','sh','bash','sql','vue','svelte','astro','zig','lua','r','m','mm'].includes(ext)) return 'code';
  if (['csv','json','jsonl','xml','yaml','yml','toml','ini','env','xls','xlsx','parquet','ndjson'].includes(ext)) return 'data';
  if (['md','mdx','txt','rtf','pdf','doc','docx','html','htm','tex','rst','org','adoc'].includes(ext)) return 'document';
  if (['zip','tar','gz','rar','7z','bz2','xz','tgz'].includes(ext)) return 'archive';
  if (['svg','eps','ai','psd','fig','sketch'].includes(ext)) return 'design';
  if (['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return 'audio';
  if (['mp4','webm','avi','mov','mkv'].includes(ext)) return 'video';
  if (['wasm','bin','exe','dll','so','dylib'].includes(ext)) return 'binary';
  return 'other';
}

function fileIcon(name: string, type: string): string {
  const cat = detectFileCategory(name, type);
  const icons: Record<string, string> = {
    code: '💻', data: '📊', document: '📄', image: '🖼️', archive: '📦',
    design: '🎨', audio: '🎵', video: '🎬', binary: '⚙️', other: '📎',
  };
  return icons[cat] || '📎';
}

// ── Env vars ───────────────────────────────────────────────────────────────
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

// ── Icons ──────────────────────────────────────────────────────────────────
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
    search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    trending: 'M23 6l-9.5 9.5-5-5L1 18',
    arrow: 'M5 12h14M12 5l7 7-7 7',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
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
  const [dragOver, setDragOver] = useState(false);
  const [filePreview, setFilePreview] = useState<AttachedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setA = useCallback((id: AgentId, status: AgentStatus) => {
    setAStatus(p => ({ ...p, [id]: status }));
  }, []);
  const resetA = useCallback(() => {
    setAStatus({ researcher: 'idle', analyst: 'idle', critic: 'idle', synthesizer: 'idle' });
  }, []);

  const sbRef = useRef<ReturnType<typeof createClient> | null>(null);
  const loadRepos = useCallback(async () => {
    if (!sbRef.current) return;
    const { data } = await sbRef.current.from('github_repos').select('*').order('stars', { ascending: false });
    if (data) setRepos(data.map((r: Repo) => ({ ...r, selected: false })));
  }, []);

  useEffect(() => {
    sbRef.current = (cfg.supabaseUrl && cfg.supabaseKey) ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
    if (sbRef.current) loadRepos();
  }, [cfg.supabaseUrl, cfg.supabaseKey, loadRepos]);

  const sb = sbRef.current ?? ((cfg.supabaseUrl && cfg.supabaseKey) ? createClient(cfg.supabaseUrl, cfg.supabaseKey) : null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // ── ADVANCED FILE EXTRACTION ─────────────────────────────────────────
  const extractFileContent = async (file: File): Promise<AttachedFile> => {
    const id = `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const isImage = file.type.startsWith('image/');
    const cat = detectFileCategory(file.name, file.type);
    const isText = cat === 'code' || cat === 'data' || cat === 'document' || file.type.startsWith('text/');

    // Images → base64 for Gemini multimodal
    if (isImage) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          const content = e.target?.result as string;
          resolve({ id, name: file.name, type: file.type, size: file.size, content, isImage: true, isText: false, preview: content });
        };
        reader.readAsDataURL(file);
      });
    }

    // PDF — extract text from raw bytes
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      try {
        const buf = await file.arrayBuffer();
        const rawStr = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
        // Extract text between parentheses (PDF text objects)
        const textMatches = rawStr.match(/\(([^)]{4,500})\)/g) ?? [];
        let text = textMatches
          .map(m => m.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\/g, ''))
          .filter(t => t.trim().length > 3 && /[a-zA-Z]/.test(t))
          .join(' ').replace(/\s+/g, ' ').slice(0, 15000);
        // Also try extracting streams
        if (text.length < 200) {
          const streamMatches = rawStr.match(/stream\r?\n([\s\S]*?)endstream/g) ?? [];
          const streamText = streamMatches.map(s => {
            const inner = s.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '');
            return inner.replace(/[^\x20-\x7E\n]/g, '').trim();
          }).filter(t => t.length > 20).join('\n').slice(0, 10000);
          if (streamText.length > text.length) text = streamText;
        }
        const preview = `📄 PDF: ${file.name}\n${(file.size / 1024).toFixed(0)} KB · ${text.split(' ').length} words extracted\n\n${text.slice(0, 500)}…`;
        return { id, name: file.name, type: file.type, size: file.size, content: text || `[PDF binary — ${(file.size/1024).toFixed(0)}KB]`, isImage: false, isText: true, preview };
      } catch {
        return { id, name: file.name, type: file.type, size: file.size, content: `[PDF: ${file.name}]`, isImage: false, isText: true };
      }
    }

    // CSV/Excel — parse as text
    if (file.name.match(/\.(csv|tsv|xls|xlsx)$/i)) {
      try {
        const buf = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 12000);
        const lines = text.split('\n');
        const preview = `📊 ${file.name}\n${lines.length} rows · ${lines[0]?.split(/[,\t;]/).length || '?'} columns\n\nHeader: ${lines[0]?.slice(0, 200)}\nSample: ${lines.slice(1, 4).join('\n')}`;
        return { id, name: file.name, type: file.type, size: file.size, content: text, isImage: false, isText: true, preview };
      } catch {
        return { id, name: file.name, type: file.type, size: file.size, content: `[Data: ${file.name}]`, isImage: false, isText: true };
      }
    }

    // JSON/YAML/XML/TOML — structured data
    if (file.name.match(/\.(json|jsonl|yaml|yml|xml|toml|ini|env|ndjson)$/i)) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          const content = (e.target?.result as string).slice(0, 20000);
          let preview = `📊 ${file.name} · ${(file.size / 1024).toFixed(1)}KB`;
          try {
            if (file.name.endsWith('.json')) {
              const parsed = JSON.parse(content);
              const keys = Array.isArray(parsed) ? `Array[${parsed.length}]` : Object.keys(parsed).slice(0, 8).join(', ');
              preview += `\nStructure: ${keys}`;
            }
          } catch { /* not valid JSON */ }
          preview += `\n\n${content.slice(0, 400)}`;
          resolve({ id, name: file.name, type: file.type, size: file.size, content, isImage: false, isText: true, preview });
        };
        reader.readAsText(file);
      });
    }

    // Code files
    if (isText) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          const content = (e.target?.result as string).slice(0, 25000);
          const lines = content.split('\n');
          const preview = `💻 ${file.name} · ${lines.length} lines · ${(file.size / 1024).toFixed(1)}KB\n\n${content.slice(0, 500)}`;
          resolve({ id, name: file.name, type: file.type, size: file.size, content, isImage: false, isText: true, preview });
        };
        reader.onerror = () => resolve({ id, name: file.name, type: file.type, size: file.size, content: `[File: ${file.name}]`, isImage: false, isText: false });
        reader.readAsText(file);
      });
    }

    // Archives
    if (cat === 'archive') {
      return { id, name: file.name, type: file.type, size: file.size, content: `[Archive: ${file.name} — ${(file.size / 1024).toFixed(0)}KB]`, isImage: false, isText: false, preview: `📦 ${file.name}\n${(file.size / 1024).toFixed(0)}KB — archive file` };
    }

    // Audio/Video — metadata only, send to Gemini
    if (cat === 'audio' || cat === 'video') {
      return { id, name: file.name, type: file.type, size: file.size, content: `[${cat}: ${file.name} — ${(file.size / (1024*1024)).toFixed(1)}MB]`, isImage: false, isText: false, preview: `${cat === 'audio' ? '🎵' : '🎬'} ${file.name}\n${(file.size / (1024*1024)).toFixed(1)}MB` };
    }

    // Fallback — try as text
    try {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          const content = (e.target?.result as string).slice(0, 15000);
          resolve({ id, name: file.name, type: file.type, size: file.size, content, isImage: false, isText: true, preview: `📎 ${file.name}\n${content.slice(0, 300)}` });
        };
        reader.onerror = () => resolve({ id, name: file.name, type: file.type, size: file.size, content: `[File: ${file.name}]`, isImage: false, isText: false });
        reader.readAsText(file);
      });
    } catch {
      return { id, name: file.name, type: file.type, size: file.size, content: `[File: ${file.name}]`, isImage: false, isText: false };
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
    for (const f of arr) {
      const extracted = await extractFileContent(f);
      const url = await uploadFileToStorage(f);
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
      const cat = detectFileCategory(results[0].name, results[0].type);
      const autoMsg = results[0].isImage
        ? 'Analyse cette image en détail : décris le contenu, extrais tout texte visible (OCR), identifie les éléments clés.'
        : cat === 'code' ? `Analyse ce code (${results[0].name}) : explique la logique, trouve les bugs, suggère des améliorations.`
        : cat === 'data' ? `Analyse ces données (${results[0].name}) : résume la structure, identifie les patterns, donne des insights.`
        : `Analyse ce fichier : ${results[0].name}`;
      setInput(autoMsg);
    }
  };

  // ── SEND ─────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    const readyFiles = files.filter(f => !f.extracting);
    if ((!text && !readyFiles.length) || loading || !sb) {
      if (!sb) setErrMsg('Configure Supabase dans Settings');
      return;
    }
    const msgText = text || `Analyse ce fichier : ${readyFiles[0]?.name}`;
    setInput(''); resetA(); setErrMsg(''); setFiles([]);
    setMsgs(p => [...p, { id: `u${Date.now()}`, role: 'user', content: msgText, ts: Date.now(), files: readyFiles.length ? readyFiles : undefined }]);
    setLoading(true);

    const history = msgs.slice(-cfg.contextWindow).map(m => ({ role: m.role === 'sara' ? 'assistant' : 'user', content: m.content }));
    const hasImages = readyFiles.some(f => f.isImage);

    // Route: images → Gemini (multimodal), else → selected mode
    const isDuo = mode === 'llama-gemini' || mode === 'llama-openrouter' || mode === 'gemini-openrouter';
    let fn: string;
    if (hasImages && mode !== 'gemini') {
      // Force Gemini for image analysis — it's multimodal
      fn = 'chat-gemini';
    } else {
      fn = mode === 'multi' ? 'multiagent'
        : mode === 'gemini' ? 'chat-gemini'
        : mode === 'openrouter' ? 'chat-openrouter'
        : isDuo ? 'chat-duo'
        : 'chat';
    }

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
        content: f.isImage ? f.content.slice(0, 500000) : f.content.slice(0, 25000),
        url: f.url,
      }));

      const body: Record<string, unknown> = {
        message: msgText, session_id: sessionId, history,
        repos: repos.filter(r => r.selected).map(r => r.id),
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
        content: data?.answer ?? 'Pas de réponse', ts: Date.now(), mode: hasImages && fn === 'chat-gemini' ? 'gemini' : mode,
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

  // ── ASSOCIATE ─────────────────────────────────────────────────────────
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', fontFamily: 'var(--f-body)', overflow: 'hidden' }} className="grain">

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0 14px' : '0 24px', height: isMobile ? 52 : 56, background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--shadow-sm)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 16, color: 'white' }}>S</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Sara</span>
              <span className="chip chip-ink" style={{ fontSize: 10 }}>1.0</span>
            </div>
            {!isMobile && <p style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', lineHeight: 1, marginTop: 1 }}>Groq · Gemini · OpenRouter · RAG</p>}
          </div>
        </div>
        {!isMobile && (
          <nav style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 4, borderRadius: 10 }}>
            {navTabs.map(([t, icon, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', transition: 'all 0.15s', background: tab === t ? 'var(--surface)' : 'transparent', color: tab === t ? 'var(--ink)' : 'var(--ink3)', boxShadow: tab === t ? 'var(--shadow-sm)' : 'none' }}>
                <Icon name={icon} size={14} />{label}
              </button>
            ))}
          </nav>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
          <ModelSelector mode={mode} setMode={setMode} isMobile={isMobile} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className={isConnected ? 'dot-live' : 'dot-err'} />
            {!isMobile && <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{isConnected ? 'live' : 'offline'}</span>}
          </div>
        </div>
      </header>

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {!isMobile && tab === 'chat' && (
          <aside style={{ width: 200, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {mode === 'multi' ? 'Pipeline 4×' : mode.includes('-') ? `Duo · ${mode.replace('-',' + ')}` : `Solo · ${mode}`}
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
                <p style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>⬡ {selRepos.length} repo{selRepos.length !== 1 ? 's' : ''}</p>
                <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>Knowledge active</p>
              </div>
            )}
          </aside>
        )}

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>

          {/* ── CHAT TAB ──────────────────────────────────────────────── */}
          {tab === 'chat' && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
                {msgs.length === 0 ? (
                  <ChatEmpty mode={mode} selRepos={selRepos} onSelect={text => setInput(text)} isMobile={isMobile} onDropFiles={handleFiles} />
                ) : (
                  <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {msgs.map(m => <ChatBubble key={m.id} msg={m} isMobile={isMobile} onPreviewFile={setFilePreview} />)}
                    {loading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: 14, color: 'white' }}>S</span>
                        </div>
                        <div style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {[0,1,2].map(i => <div key={i} className="dot-live" style={{ width: 6, height: 6, animationDelay: `${i * 0.2}s` }} />)}
                          <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Sara thinking…</span>
                        </div>
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              {/* ── INPUT BAR + DRAG & DROP ZONE ────────────────────────── */}
              <div
                style={{ flexShrink: 0, padding: isMobile ? '10px 14px 14px' : '16px 24px 20px', background: dragOver ? 'var(--blue-s)' : 'var(--surface)', borderTop: `2px solid ${dragOver ? 'var(--blue)' : 'var(--border)'}`, transition: 'all 0.2s', position: 'relative' }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              >
                {/* Drag overlay */}
                {dragOver && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,74,139,0.08)', borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
                    <div style={{ padding: '20px 40px', borderRadius: 16, background: 'var(--surface)', border: '2px dashed var(--blue)', boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Icon name="upload" size={32} />
                      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>Drop files here</p>
                      <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>Images · PDF · Code · CSV · JSON · Any file</p>
                    </div>
                  </div>
                )}

                {errMsg && (
                  <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12, fontFamily: 'var(--f-mono)', lineHeight: 1.5 }}>
                    {errMsg}
                  </div>
                )}

                {/* File preview chips */}
                {files.length > 0 && (
                  <div style={{ maxWidth: 780, margin: '0 auto 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {files.map(f => (
                      <div key={f.id}
                        onClick={() => !f.extracting && setFilePreview(f)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 8px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 12, maxWidth: 240, cursor: f.extracting ? 'wait' : 'pointer', transition: 'all 0.15s' }}>
                        {f.extracting ? <Spin /> : f.isImage ? (
                          <img src={f.content} alt={f.name} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 16 }}>{fileIcon(f.name, f.type)}</span>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                          <p style={{ fontSize: 9, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{(f.size / 1024).toFixed(0)}KB · {detectFileCategory(f.name, f.type)}</p>
                        </div>
                        {f.url && <span style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'var(--f-mono)' }}>↑</span>}
                        <button onClick={ev => { ev.stopPropagation(); setFiles(p => p.filter(x => x.id !== f.id)); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink4)', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8 }}>
                  <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }}
                    onChange={e => e.target.files && handleFiles(e.target.files)} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                    style={{ padding: '0 12px', borderRadius: 10, border: `1px solid ${files.length > 0 ? 'var(--green)' : 'var(--border)'}`, background: files.length > 0 ? 'var(--green-s)' : 'var(--bg2)', cursor: 'pointer', flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 4, color: files.length > 0 ? 'var(--green)' : 'var(--ink3)', fontSize: 14, transition: 'all 0.15s' }}
                    title="Joindre un fichier — images, PDF, code, CSV, JSON, archives…">
                    {uploading ? <Spin /> : <Icon name="upload" size={16} />}
                    {files.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--f-mono)', fontWeight: 700 }}>{files.length}</span>}
                  </button>
                  <textarea
                    value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    onPaste={e => {
                      const items = Array.from(e.clipboardData.items);
                      const imageItem = items.find(i => i.type.startsWith('image/'));
                      if (imageItem) { const f = imageItem.getAsFile(); if (f) { e.preventDefault(); handleFiles([f]); } }
                    }}
                    placeholder={files.length > 0 ? 'Instructions pour ce fichier… (ou Entrée pour analyse auto)' : mode === 'multi' ? 'Multi-agent 4×…' : `Ask Sara (${mode})…`}
                    rows={isMobile ? 1 : 2} disabled={loading}
                    className="sara-input" style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
                  />
                  <button onClick={send} disabled={(!input.trim() && !files.length) || loading}
                    className="btn-primary" style={{ padding: isMobile ? '0 14px' : '0 20px', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'stretch', flexShrink: 0 }}>
                    {loading ? <Spin /> : <Icon name="send" size={14} />}
                    {!isMobile && (loading ? 'Wait' : 'Send')}
                  </button>
                </div>
                {!isMobile && (
                  <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
                    📎 Drag & drop any file · Paste images · {mode === 'multi' ? '4 agents' : mode} · Enter ↵
                  </p>
                )}
              </div>
            </>
          )}

          {tab === 'market' && (
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <MarketTab
                sb={sb} repos={repos} templates={MARKET_TEMPLATES}
                assocResult={assocResult} associating={associating}
                assocGoal={assocGoal} setAssocGoal={setAssocGoal}
                assocPhase={assocPhase} errMsg={errMsg}
                toggleRepo={toggleRepo} selRepos={selRepos}
                onAssociate={() => associate()} onBuildTemplate={buildFromTemplate}
                activeTemplate={activeTemplate} isMobile={isMobile}
                onSyncRepo={async (owner: string, repo: string) => {
                  if (!sb) return;
                  setSyncMsg(`Indexing ${owner}/${repo}…`);
                  try {
                    await sb.functions.invoke('github-sync', { body: { owner, repo } });
                    await loadRepos();
                  } catch { /* ignore */ }
                }}
              />
            </div>
          )}

          {tab === 'repos' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px' : 24, WebkitOverflowScrolling: 'touch' }}>
              <ReposTab repos={repos} repoInput={repoInput} setRepoInput={setRepoInput}
                onSync={syncRepo} syncing={syncing} syncMsg={syncMsg}
                onToggle={toggleRepo}                bulkSyncing={bulkSyncing} bulkProgress={bulkProgress} onBulkSync={bulkSync}
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

      {/* ── FILE PREVIEW MODAL ──────────────────────────────────────────── */}
      {filePreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setFilePreview(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxWidth: 700, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <span style={{ fontSize: 24 }}>{fileIcon(filePreview.name, filePreview.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filePreview.name}</p>
                <p style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>
                  {(filePreview.size / 1024).toFixed(1)}KB · {detectFileCategory(filePreview.name, filePreview.type)} · {filePreview.type || 'unknown'}
                </p>
              </div>
              <button onClick={() => setFilePreview(null)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <Icon name="x" size={14} />
              </button>
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {filePreview.isImage ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <img src={filePreview.content} alt={filePreview.name} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 12, objectFit: 'contain', boxShadow: 'var(--shadow)' }} />
                  <p style={{ fontSize: 12, color: 'var(--ink3)', fontFamily: 'var(--f-mono)', textAlign: 'center' }}>
                    🖼️ {filePreview.name} · {(filePreview.size / 1024).toFixed(0)}KB
                    <br />Images are analyzed by Gemini (multimodal) — OCR, description, element detection
                  </p>
                </div>
              ) : (
                <div>
                  {filePreview.preview && (
                    <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                      <pre style={{ fontSize: 12, fontFamily: 'var(--f-mono)', color: 'var(--ink2)', whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
                        {filePreview.preview}
                      </pre>
                    </div>
                  )}
                  <div style={{ padding: 16, borderRadius: 10, background: 'var(--ink)', overflowX: 'auto' }}>
                    <pre style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: '#90e080', whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
                      {filePreview.content.slice(0, 8000)}
                      {filePreview.content.length > 8000 && '\n\n… (truncated)'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn-primary" onClick={() => {
                const cat = detectFileCategory(filePreview.name, filePreview.type);
                const prompt = filePreview.isImage
                  ? 'Analyse cette image en détail : décris le contenu, extrais tout texte (OCR), identifie les éléments.'
                  : cat === 'code' ? `Analyse ce code (${filePreview.name}) : explique chaque fonction, trouve les bugs, suggère des améliorations.`
                  : cat === 'data' ? `Analyse ces données (${filePreview.name}) : structure, patterns, anomalies, insights.`
                  : `Analyse ce fichier en profondeur : ${filePreview.name}`;
                setInput(prompt);
                setFiles(p => p.some(f => f.id === filePreview.id) ? p : [...p, filePreview]);
                setFilePreview(null);
                setTab('chat');
              }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Icon name="zap" size={14} /> Analyze with Sara
              </button>
              {filePreview.url && (
                <a href={filePreview.url} target="_blank" rel="noreferrer" className="btn-ghost"
                  style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                  <Icon name="download" size={14} /> Download
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────────────────── */}
      {isMobile && (
        <nav style={{ flexShrink: 0, display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--border)', boxShadow: '0 -2px 12px rgba(26,14,8,0.08)', zIndex: 20, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {navTabs.map(([t, icon]) => {
            const labels: Record<Tab, string> = { chat: 'Chat', market: 'Market', repos: 'Repos', settings: 'Settings' };
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex: 1, padding: '10px 4px 10px', border: 'none', cursor: 'pointer', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: active ? 'var(--ink)' : 'var(--ink4)', transition: 'all 0.15s', position: 'relative' }}>
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
// MODEL SELECTOR
// ═══════════════════════════════════════════════════════════════════════════
const MODE_COLORS: Record<Mode, string> = {
  llama: '#1a1a1a', gemini: '#1a5a8b', openrouter: '#5a1a8b',
  'llama-gemini': '#1a6a5a', 'llama-openrouter': '#4a1a6a', 'gemini-openrouter': '#2a3a8b',
  multi: '#8b1a1a',
};
const MODE_LABELS: Record<Mode, { short: string; long: string; desc: string }> = {
  llama:              { short: 'LLaMA',  long: 'LLaMA 3.3 70B',               desc: 'Groq · ultra-rapide' },
  gemini:             { short: 'Gemini', long: 'Gemini 2.0 Flash',            desc: 'Google AI · multimodal' },
  openrouter:         { short: 'Router', long: 'OpenRouter',                  desc: '200+ modèles' },
  'llama-gemini':     { short: 'L+G',   long: 'LLaMA × Gemini',              desc: 'Duo · 2 agents' },
  'llama-openrouter': { short: 'L+R',   long: 'LLaMA × OpenRouter',          desc: 'Duo · 2 agents' },
  'gemini-openrouter':{ short: 'G+R',   long: 'Gemini × OpenRouter',         desc: 'Duo · 2 agents' },
  multi:              { short: '4×',     long: 'LLaMA + Gemini + OpenRouter', desc: '4 agents · synthèse' },
};

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
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>{title}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {modes.map(m => {
            const l = MODE_LABELS[m]; const active = mode === m;
            return (
              <button key={m} onClick={() => { setMode(m); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: active ? `1px solid ${MODE_COLORS[m]}40` : '1px solid transparent', background: active ? `${MODE_COLORS[m]}12` : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', width: '100%' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: MODE_COLORS[m], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: active ? MODE_COLORS[m] : 'var(--ink)', fontFamily: 'var(--f-body)', lineHeight: 1.2 }}>{l.long}</p>
                  <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', lineHeight: 1.3, marginTop: 1 }}>{l.desc}</p>
                </div>
                {active && <span style={{ fontSize: 10, color: MODE_COLORS[m], fontFamily: 'var(--f-mono)', fontWeight: 700 }}>●</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 9px' : '6px 12px', borderRadius: 8, border: `1px solid ${MODE_COLORS[mode]}40`, background: `${MODE_COLORS[mode]}12`, cursor: 'pointer', transition: 'all 0.15s' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: MODE_COLORS[mode] }} />
        <span style={{ fontSize: isMobile ? 10 : 12, fontWeight: 700, fontFamily: 'var(--f-mono)', color: MODE_COLORS[mode] }}>{current.short}</span>
        <span style={{ fontSize: 9, color: 'var(--ink4)', transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 230, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 100, padding: '12px 10px' }}>
          <Section title="Solo" modes={['llama', 'gemini', 'openrouter']} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 12px' }} />
          <Section title="Duo — n-agent" modes={['llama-gemini', 'llama-openrouter', 'gemini-openrouter']} />
          <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 12px' }} />
          <Section title="Quad — 4× pipeline" modes={['multi']} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT EMPTY — with drop zone
// ═══════════════════════════════════════════════════════════════════════════
function ChatEmpty({ mode, selRepos, onSelect, isMobile, onDropFiles }: {
  mode: Mode; selRepos: Repo[]; onSelect: (text: string) => void; isMobile: boolean;
  onDropFiles: (files: FileList | File[]) => void;
}) {
  const [dropHover, setDropHover] = useState(false);
  const suggestions = [
    { t: 'Scrape competitor prices live', d: 'Scrapling + TinyFish extract structured data', c: 'var(--red)' },
    { t: 'Build a RAG chatbot', d: 'Supabase pgvector + LangChain + streaming', c: 'var(--blue)' },
    { t: 'Train an LLM from scratch', d: 'rasbt/LLMs-from-scratch + llama.cpp', c: 'var(--ink)' },
    { t: 'Create an AI agent pipeline', d: 'microsoft/ai-agents + tool use + memory', c: 'var(--green)' },
  ];

  return (
    <div style={{ maxWidth: 780, margin: isMobile ? '16px auto 0' : '40px auto 0', paddingBottom: 16 }}>
      {/* Hero */}
      <div style={{ marginBottom: isMobile ? 24 : 32, display: 'flex', alignItems: 'flex-start', gap: isMobile ? 14 : 20 }}>
        <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: isMobile ? 14 : 16, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow)' }}>
          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 800, fontSize: isMobile ? 24 : 28, color: 'white' }}>S</span>
        </div>
        <div>
          <h1 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 26 : 36, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Hello, I'm Sara</h1>
          <p style={{ color: 'var(--ink2)', fontSize: isMobile ? 13 : 15, marginTop: 6 }}>
            {mode === 'multi' ? '4 specialized agents analyzing your request' : 'Your AI engineering partner — multimodal analysis'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="chip chip-ink">LLaMA 3.3 70B</span>
            <span className="chip chip-red">Gemini 2.0</span>
            <span className="chip chip-blue">OpenRouter</span>
            <span className="chip chip-green">pgvector RAG</span>
            {selRepos.length > 0 && <span className="chip chip-amber">⬡ {selRepos.length} repos</span>}
          </div>
        </div>
      </div>

      {/* DROP ZONE */}
      <div
        onDragOver={e => { e.preventDefault(); setDropHover(true); }}
        onDragLeave={() => setDropHover(false)}
        onDrop={e => { e.preventDefault(); setDropHover(false); onDropFiles(e.dataTransfer.files); }}
        style={{
          marginBottom: 24, padding: dropHover ? 32 : 24, borderRadius: 16,
          border: `2px dashed ${dropHover ? 'var(--blue)' : 'var(--border)'}`,
          background: dropHover ? 'var(--blue-s)' : 'var(--surface)',
          transition: 'all 0.2s', cursor: 'pointer', textAlign: 'center',
        }}
        onClick={() => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.multiple = true; inp.accept = '*/*';
          inp.onchange = () => inp.files && onDropFiles(inp.files);
          inp.click();
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>{dropHover ? '📥' : '📎'}</div>
        <p style={{ fontWeight: 700, fontSize: 16, color: dropHover ? 'var(--blue)' : 'var(--ink)', marginBottom: 4 }}>
          {dropHover ? 'Drop it!' : 'Drop any file to analyze'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5 }}>
          Images (OCR + description) · PDF · Code · CSV/JSON/XML · Excel · Archives
        </p>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          {['🖼️ Images', '📄 PDF', '💻 Code', '📊 Data', '📦 Archives'].map(t => (
            <span key={t} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Suggestions */}
      <p style={{ fontSize: 10, color: 'var(--ink4)', fontFamily: 'var(--f-mono)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tap to try →</p>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 8 : 12 }}>
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => onSelect(s.t)}
            style={{ padding: 16, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow-sm)', transition: 'all 0.15s', width: '100%', fontFamily: 'var(--f-body)' }}
            onMouseEnter={e => { (e.currentTarget).style.boxShadow = 'var(--shadow)'; (e.currentTarget).style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { (e.currentTarget).style.boxShadow = 'var(--shadow-sm)'; (e.currentTarget).style.transform = 'translateY(0)'; }}>
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
function ChatBubble({ msg, isMobile, onPreviewFile }: { msg: Msg; isMobile: boolean; onPreviewFile: (f: AttachedFile) => void }) {
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
                  <img key={f.id} src={f.content} alt={f.name} onClick={() => onPreviewFile(f)}
                    style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover', cursor: 'pointer' }} />
                ) : (
                  <div key={f.id} onClick={() => onPreviewFile(f)}
                    style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{fileIcon(f.name, f.type)}</span>
                    {f.name}
                    <span style={{ fontSize: 9, color: 'var(--ink4)' }}>{(f.size/1024).toFixed(0)}KB</span>
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
            {msg.mode === 'gemini' && <span className="chip chip-blue" style={{ fontSize: 10 }}>Gemini</span>}
            {msg.mode?.includes('-') && <span className="chip chip-blue" style={{ fontSize: 10 }}>duo·{msg.mode}</span>}
            {msg.ragUsed && <span className="chip chip-green" style={{ fontSize: 10 }}>⬡ RAG</span>}
            {msg.webUsed && <span className="chip chip-blue" style={{ fontSize: 10 }}>🌐 live</span>}
            {msg.err && <span className="chip chip-ink" style={{ fontSize: 10, color: 'var(--red)' }}>error</span>}
            {msg.durationMs && <span style={{ fontSize: 11, color: 'var(--ink4)', marginLeft: 'auto', fontFamily: 'var(--f-mono)' }}>{(msg.durationMs / 1000).toFixed(1)}s</span>}
          </div>
          <div className="card" style={{ padding: isMobile ? '14px 16px' : '16px 20px', borderLeft: msg.err ? '3px solid var(--red)' : '3px solid var(--border)', overflowX: 'auto' }}>
            <div className="sara-md" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {msg.agentOutputs && (
            <div style={{ marginTop: 8, marginLeft: 4 }}>
              <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'var(--f-mono)' }}>
                <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
                Agent breakdown
              </button>
              {open && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
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
// MARKET TAB — with GitHub search + AI repo suggestions
// ═══════════════════════════════════════════════════════════════════════════
function MarketTab({ sb, repos, templates, assocResult, associating, assocGoal, setAssocGoal, assocPhase, errMsg, toggleRepo, selRepos, onAssociate, onBuildTemplate, activeTemplate, isMobile, onSyncRepo }: {
  sb: ReturnType<typeof createClient> | null;
  repos: Repo[]; templates: MarketTemplate[]; assocResult: AssocResult | null;
  associating: boolean; assocGoal: string; setAssocGoal: (v: string) => void;
  assocPhase: string; errMsg: string; toggleRepo: (id: string) => void;
  selRepos: Repo[]; onAssociate: () => void; onBuildTemplate: (t: MarketTemplate) => void;
  activeTemplate: MarketTemplate | null; isMobile: boolean;
  onSyncRepo: (owner: string, repo: string) => Promise<void>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GitHubSearchRepo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchLang, setSearchLang] = useState('');
  const [selectedGH, setSelectedGH] = useState<Set<string>>(new Set());
  const [indexingRepo, setIndexingRepo] = useState<string | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  const searchGitHub = async () => {
    if (!searchQuery.trim() || !sb) return;
    setSearching(true); setSearchResults([]);
    try {
      const { data, error } = await sb.functions.invoke('github-search', {
        body: { query: searchQuery, language: searchLang || undefined, sort: 'stars', per_page: 20 },
      });
      if (error) throw error;
      setSearchResults(data?.repos ?? []);
    } catch (e: unknown) {
      console.error('GitHub search failed:', e);
      // Fallback: search GitHub API directly
      try {
        let q = searchQuery;
        if (searchLang) q += ` language:${searchLang}`;
        const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`, {
          headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Sara-AI' },
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults((data.items ?? []).map((r: any) => ({
            github_id: r.id, full_name: r.full_name, name: r.name,
            owner: r.owner.login, avatar_url: r.owner.avatar_url,
            description: r.description, stars: r.stargazers_count,
            language: r.language, topics: r.topics ?? [],
            url: r.html_url, updated_at: r.updated_at,
            license: r.license?.spdx_id, forks: r.forks_count,
            issues: r.open_issues_count, default_branch: r.default_branch,
          })));
        }
      } catch { /* ignore */ }
    } finally { setSearching(false); }
  };

  const askAiForRepos = async () => {
    if (!assocGoal.trim() || !sb) return;
    setAiSuggesting(true); setAiSuggestions([]);
    try {
      const { data } = await sb.functions.invoke('chat', {
        body: {
          message: `I want to build: "${assocGoal}". Suggest exactly 5 GitHub repositories (format: owner/repo) that I should combine to build this. Only output the 5 repos, one per line, nothing else. Choose popular, well-maintained repos.`,
          history: [],
        },
      });
      const answer = data?.answer ?? '';
      const repos = answer.match(/[\w.-]+\/[\w.-]+/g) ?? [];
      setAiSuggestions(repos.slice(0, 8));
      // Auto-search each suggested repo
      for (const repo of repos.slice(0, 5)) {
        setSearchQuery(repo);
        try {
          const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(repo)}&sort=stars&per_page=3`, {
            headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Sara-AI' },
          });
          if (res.ok) {
            const d = await res.json();
            const newRepos = (d.items ?? []).map((r: any) => ({
              github_id: r.id, full_name: r.full_name, name: r.name,
              owner: r.owner.login, avatar_url: r.owner.avatar_url,
              description: r.description, stars: r.stargazers_count,
              language: r.language, topics: r.topics ?? [], url: r.html_url,
              updated_at: r.updated_at, license: r.license?.spdx_id,
              forks: r.forks_count, issues: r.open_issues_count,
              default_branch: r.default_branch,
            }));
            setSearchResults(prev => {
              const existing = new Set(prev.map(r => r.full_name));
              return [...prev, ...newRepos.filter((r: GitHubSearchRepo) => !existing.has(r.full_name))];
            });
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    finally { setAiSuggesting(false); }
  };

  const indexAndSelect = async (r: GitHubSearchRepo) => {
    setIndexingRepo(r.full_name);
    await onSyncRepo(r.owner, r.name);
    setSelectedGH(p => new Set(p).add(r.full_name));
    setIndexingRepo(null);
  };

  const difficultyColor: Record<string, string> = { starter: 'var(--green)', intermediate: 'var(--amber)', advanced: 'var(--red)' };
  const languages = ['', 'Python', 'TypeScript', 'JavaScript', 'Rust', 'Go', 'Java', 'C++'];

  return (
    <div style={{ padding: isMobile ? '16px 14px' : 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--f-head)', fontSize: isMobile ? 22 : 28, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 4 }}>
            Project Builder
          </h2>
          <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: 600 }}>
            Search any GitHub repo, let Sara suggest the best combinations, and build a functional project directly.
          </p>
        </div>

        {errMsg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', color: 'var(--red)', fontSize: 12 }}>{errMsg}</div>
        )}

        {assocResult && <AssocResultCard result={assocResult} />}

        {/* ── AI-POWERED PROJECT BUILDER ─────────────────────────────── */}
        <div className="card" style={{ padding: isMobile ? 16 : 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>Build a Project</p>
            <span className="chip chip-red" style={{ fontSize: 10 }}>AI-powered</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 12 }}>
            Describe what you want to build. Sara will find the best GitHub repos and generate a working project.
          </p>

          <textarea value={assocGoal} onChange={e => setAssocGoal(e.target.value)}
            placeholder="e.g. A real-time competitor price monitor that scrapes 10 e-commerce sites every hour, stores in Supabase, and sends Slack alerts…"
            className="sara-input" rows={3} style={{ marginBottom: 12, resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button className="btn-primary" onClick={askAiForRepos} disabled={aiSuggesting || !assocGoal.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {aiSuggesting ? <><Spin /> Sara is finding repos…</> : <><Icon name="zap" size={14} /> Find repos with AI</>}
            </button>
            {selRepos.length >= 2 && (
              <button className="btn-red" onClick={onAssociate} disabled={associating}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {associating ? <><Spin /> {assocPhase || 'Building…'}</> : <><Icon name="zap" size={14} /> Build Project ({selRepos.length} repos)</>}
              </button>
            )}
          </div>

          {/* AI suggestions */}
          {aiSuggestions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink3)', marginBottom: 8 }}>Sara recommends:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {aiSuggestions.map(r => (
                  <span key={r} style={{ padding: '4px 10px', borderRadius: 20, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.3)', color: 'var(--green)', fontSize: 11, fontFamily: 'var(--f-mono)' }}>
                    ✦ {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── GITHUB SEARCH ─────────────────────────────────────────── */}
        <div className="card" style={{ padding: isMobile ? 16 : 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Icon name="github" size={18} />
            <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Search GitHub</p>
            <span className="chip chip-ink" style={{ fontSize: 10 }}>All public repos</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchGitHub()}
              placeholder="Search any repo… e.g. web scraping, LLM, dashboard…"
              className="sara-input" style={{ flex: 1 }}
            />
            <select value={searchLang} onChange={e => setSearchLang(e.target.value)}
              className="sara-input" style={{ width: 130, cursor: 'pointer' }}>
              {languages.map(l => <option key={l} value={l}>{l || 'Any language'}</option>)}
            </select>
            <button className="btn-primary" onClick={searchGitHub} disabled={searching || !searchQuery.trim()}
              style={{ padding: '0 16px', flexShrink: 0 }}>
              {searching ? <Spin /> : <Icon name="search" size={14} />}
            </button>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {searchResults.map(r => {
                const isIndexed = selectedGH.has(r.full_name);
                const isIndexing = indexingRepo === r.full_name;
                return (
                  <div key={r.github_id} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${isIndexed ? 'var(--green)' : 'var(--border)'}`, background: isIndexed ? 'var(--green-s)' : 'var(--bg)', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.15s' }}>
                    <img src={r.avatar_url} alt={r.owner} style={{ width: 32, height: 32, borderRadius: 8 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--f-mono)', color: 'var(--ink)', textDecoration: 'none' }}>{r.full_name}</a>
                        {r.language && <span className="chip chip-ink" style={{ fontSize: 9 }}>{r.language}</span>}
                      </div>
                      {r.description && <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</p>}
                      {r.topics?.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {r.topics.slice(0, 4).map(t => (
                            <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'var(--bg2)', color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--amber)', fontFamily: 'var(--f-mono)', fontWeight: 600 }}>★ {r.stars?.toLocaleString()}</p>
                      <p style={{ fontSize: 9, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>{r.forks} forks</p>
                    </div>
                    <button onClick={() => indexAndSelect(r)} disabled={isIndexing || isIndexed}
                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${isIndexed ? 'var(--green)' : 'var(--border)'}`, background: isIndexed ? 'var(--green)' : 'var(--surface)', color: isIndexed ? 'white' : 'var(--ink2)', fontSize: 11, cursor: isIndexed ? 'default' : 'pointer', fontFamily: 'var(--f-mono)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {isIndexing ? <Spin /> : isIndexed ? '✓ Indexed' : '+ Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── INDEXED REPOS SELECTION ───────────────────────────────── */}
        {repos.length > 0 && (
          <div className="card" style={{ padding: isMobile ? 16 : 20, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>⬡</span>
              <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Your Indexed Repos</p>
              <span className="chip chip-green" style={{ fontSize: 10 }}>{repos.length} available</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {repos.slice(0, 20).map(r => (
                <button key={r.id} onClick={() => toggleRepo(r.id)}
                  style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${r.selected ? 'var(--red)' : 'var(--border)'}`, background: r.selected ? 'var(--red-s)' : 'transparent', color: r.selected ? 'var(--red)' : 'var(--ink2)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--f-mono)', transition: 'all 0.15s' }}>
                  {r.selected ? '✓ ' : ''}{r.owner}/{r.repo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── QUICK TEMPLATES ───────────────────────────────────────── */}
        <h3 style={{ fontFamily: 'var(--f-head)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Quick Templates</h3>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
          {templates.map(t => {
            const isActive = activeTemplate?.id === t.id;
            return (
              <div key={t.id} className="market-card" style={{ border: isActive ? `2px solid ${t.color}` : undefined, cursor: 'pointer' }}
                onClick={() => onBuildTemplate(t)}>
                <div style={{ padding: '16px 16px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: t.color + '15', border: `1px solid ${t.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{t.icon}</div>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: difficultyColor[t.difficulty] + '15', color: difficultyColor[t.difficulty], border: `1px solid ${difficultyColor[t.difficulty]}30`, fontFamily: 'var(--f-mono)' }}>{t.difficulty}</span>
                  </div>
                  <h4 style={{ fontFamily: 'var(--f-head)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{t.name}</h4>
                  <p style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, marginBottom: 12 }}>{t.description}</p>
                </div>
                <div style={{ padding: '10px 16px', background: 'var(--bg)', display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--border)' }}>
                  {t.repos.map(r => <span key={r} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink3)', fontFamily: 'var(--f-mono)' }}>{r.split('/')[1]}</span>)}
                </div>
                <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: t.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="zap" size={12} /> Build</span>
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
            {result.repos_combined.map(r => <span key={r.repo} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--s3)', border: '1px solid var(--border)', color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>{r.owner}/{r.repo}</span>)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', overflowX: 'auto' }}>
        {([['arch', 'Architecture'], ['code', 'Starter Code'], ['deploy', 'Deploy Guide']] as ['arch' | 'code' | 'deploy', string][]).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--f-body)', background: 'transparent', color: activeTab === t ? 'var(--red)' : 'var(--ink3)', borderBottom: `2px solid ${activeTab === t ? 'var(--red)' : 'transparent'}`, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>{l}</button>
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
        <h2 style={{ fontFamily: 'var(--f-head)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>GitHub Knowledge Base</h2>
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
        {bulkSyncing && <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Spin /><span style={{ fontSize: 12, color: 'var(--ink2)', fontFamily: 'var(--f-mono)' }}>Syncing…</span></div>}
        {bulkProgress && <p style={{ marginTop: 10, fontSize: 12, fontFamily: 'var(--f-mono)', color: bulkProgress.startsWith('✓') ? 'var(--green)' : bulkProgress.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>{bulkProgress}</p>}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>Add Single Repository</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={repoInput} onChange={e => setRepoInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSync()}
            placeholder="owner/repo or https://github.com/owner/repo" className="sara-input" style={{ flex: 1 }} />
          <button className="btn-primary" onClick={onSync} disabled={syncing || !repoInput.trim()} style={{ padding: '0 20px', flexShrink: 0 }}>
            {syncing ? <><Spin /> Indexing…</> : 'Index'}
          </button>
        </div>
        {syncMsg &&          <p style={{ marginTop: 8, fontSize: 12, fontFamily: 'var(--f-mono)', color: syncMsg.startsWith('✓') ? 'var(--green)' : syncMsg.startsWith('✗') ? 'var(--red)' : 'var(--ink3)' }}>{syncMsg}</p>}
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
            <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 4 }}>✓ Connected via environment variables</p>
            <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY injected at build time.</p>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--red-s)', border: '1px solid var(--red-m)', marginBottom: 14 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>⚠ Not connected</p>
              <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, or enter below.</p>
            </div>
            <Field label="Project URL" field="supabaseUrl" ph="https://xxxx.supabase.co" />
            <Field label="Anon Key" field="supabaseKey" type="password" ph="eyJhbGci…" />
          </>
        )}
      </Section>

      <Section title="⚡ AI Providers" color="var(--green)">
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: 'var(--green-s)', border: '1px solid rgba(26,122,74,0.2)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>API keys → Supabase Secrets</p>
          <p style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'var(--f-mono)', marginTop: 2, lineHeight: 1.8 }}>
            Supabase Dashboard → Edge Functions → Secrets:
            <br />• GROQ_API_KEY=gsk_… (required — LLaMA)
            <br />• GEMINI_API_KEY=AIza… (required — Gemini)
            <br />• OPENROUTER_API_KEY=sk-or-… (required — OpenRouter)
            <br />• TINYFISH_API_KEY=tf_… (optional — web browsing)
            <br />• GITHUB_TOKEN=ghp_… (optional — higher rate limits)
          </p>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--f-mono)' }}>Groq Model</label>
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
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={local.webEnabled} onChange={e => set('webEnabled', e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--red)' }} />
            Web browsing (TinyFish)
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
            { label: 'Max Tokens', field: 'maxTokens' as const, min: 512, max: 8192, step: 256, fmt: (v: number) => v.toLocaleString(), note: 'Response length' },
            { label: 'Context', field: 'contextWindow' as const, min: 2, max: 20, step: 1, fmt: (v: number) => `${v} msgs`, note: 'History window' },
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
          placeholder="Leave empty for Sara's default persona…"
          className="sara-input" rows={4} style={{ resize: 'vertical', fontFamily: 'var(--f-mono)', fontSize: 12 }} />
      </Section>

      <div className="card" style={{ padding: 20, marginBottom: 20, background: 'var(--ink)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--f-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Deploy Checklist</p>
        <pre style={{ fontSize: 11, lineHeight: 2, color: '#90e080', fontFamily: 'var(--f-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{`# Vercel Environment Variables
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci…

# Supabase Secrets (Edge Functions)
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-...
TINYFISH_API_KEY=tf_...        # optional
GITHUB_TOKEN=ghp_...           # optional

# Edge Functions deployed:
# chat, chat-gemini, chat-openrouter, chat-duo
# multiagent, associate, github-sync, bulk-sync
# github-search (NEW)`}</pre>
      </div>

      <button className="btn-red" onClick={() => onChange(local)}
        style={{ width: '100%', padding: '14px 20px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow)' }}>
        <Icon name="check" size={16} /> Save Configuration
      </button>
    </div>
  );
}