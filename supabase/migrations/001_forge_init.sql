-- ══════════════════════════════════════════════════════════════════
-- FORGE AI — Supabase Schema
-- Run in Supabase SQL Editor or via: supabase db push
-- ══════════════════════════════════════════════════════════════════

-- Enable pgvector extension for RAG embeddings
create extension if not exists vector;

-- ── Chat sessions ──────────────────────────────────────────────────
create table if not exists chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  mode        text default 'solo',  -- 'solo' | 'multiagent'
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Chat messages ──────────────────────────────────────────────────
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references chat_sessions(id) on delete cascade,
  role        text not null,        -- 'user' | 'assistant' | 'system'
  content     text not null,
  metadata    jsonb default '{}',   -- agent logs, tools used, duration...
  created_at  timestamptz default now()
);

create index if not exists idx_messages_session on chat_messages(session_id);
create index if not exists idx_messages_created on chat_messages(created_at desc);

-- ── GitHub repos registry ──────────────────────────────────────────
create table if not exists github_repos (
  id          uuid primary key default gen_random_uuid(),
  owner       text not null,
  repo        text not null,
  description text,
  stars       integer default 0,
  language    text,
  topics      text[],
  indexed_at  timestamptz,
  chunk_count integer default 0,
  created_at  timestamptz default now(),
  unique(owner, repo)
);

-- ── Document chunks (RAG knowledge base) ───────────────────────────
create table if not exists document_chunks (
  id          uuid primary key default gen_random_uuid(),
  repo_id     uuid references github_repos(id) on delete cascade,
  source_path text not null,         -- e.g. "README.md", "src/index.ts"
  content     text not null,
  chunk_index integer default 0,
  embedding   vector(384),           -- gte-small embeddings
  metadata    jsonb default '{}',
  created_at  timestamptz default now()
);

create index if not exists idx_chunks_repo on document_chunks(repo_id);
-- IVFFlat index for fast similarity search
create index if not exists idx_chunks_embedding on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ── Settings / user config ─────────────────────────────────────────
create table if not exists user_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

-- Insert default config
insert into user_settings (key, value) values
  ('ai_config', '{
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "temperature": 0.7,
    "max_tokens": 4096
  }'::jsonb)
on conflict (key) do nothing;

-- ── Semantic search function ───────────────────────────────────────
create or replace function search_chunks(
  query_embedding vector(384),
  match_count      int default 5,
  filter_repo_id   uuid default null
)
returns table (
  id          uuid,
  content     text,
  source_path text,
  repo_id     uuid,
  similarity  float
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.source_path,
    c.repo_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  where
    (filter_repo_id is null or c.repo_id = filter_repo_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ── RLS policies (open for local dev, tighten for production) ──────
alter table chat_sessions     enable row level security;
alter table chat_messages     enable row level security;
alter table github_repos      enable row level security;
alter table document_chunks   enable row level security;
alter table user_settings     enable row level security;

-- Service role can do everything (used by Edge Functions)
create policy "service_all" on chat_sessions     for all using (true);
create policy "service_all" on chat_messages     for all using (true);
create policy "service_all" on github_repos      for all using (true);
create policy "service_all" on document_chunks   for all using (true);
create policy "service_all" on user_settings     for all using (true);
