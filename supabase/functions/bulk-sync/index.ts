/**
 * Sara — Bulk Sync Edge Function
 * ================================
 * Indexes multiple GitHub repos in one call.
 * Pre-loaded with Top 20 AI/ML repositories.
 *
 * POST /bulk-sync
 * Body: { repos?: Array<{owner, repo}>, use_preset?: "top20" | "ai" | "scraping" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Top repos presets (from the top 20 Jupyter/AI repos + Scrapling) ────────
const PRESETS: Record<string, Array<{ owner: string; repo: string }>> = {
  top20: [
    { owner: "jackfrued", repo: "Python-100-Days" },
    { owner: "microsoft", repo: "generative-ai-for-beginners" },
    { owner: "rasbt", repo: "LLMs-from-scratch" },
    { owner: "microsoft", repo: "ML-For-Beginners" },
    { owner: "CompVis", repo: "stable-diffusion" },
    { owner: "openai", repo: "openai-cookbook" },
    { owner: "pathwaycom", repo: "llm-app" },
    { owner: "facebookresearch", repo: "segment-anything" },
    { owner: "microsoft", repo: "ai-agents-for-beginners" },
    { owner: "jakevdp", repo: "PythonDataScienceHandbook" },
    { owner: "GokuMohandas", repo: "Made-With-ML" },
    { owner: "microsoft", repo: "AI-For-Beginners" },
    { owner: "aymericdamien", repo: "TensorFlow-Examples" },
    { owner: "DataExpert-io", repo: "data-engineer-handbook" },
    { owner: "suno-ai", repo: "bark" },
    { owner: "google-research", repo: "google-research" },
    { owner: "DataTalksClub", repo: "data-engineering-zoomcamp" },
    { owner: "microsoft", repo: "Data-Science-For-Beginners" },
    { owner: "openai", repo: "CLIP" },
    { owner: "anthropics", repo: "claude-cookbooks" },
  ],
  scraping: [
    { owner: "D4Vinci", repo: "Scrapling" },
    { owner: "tinyfish-io", repo: "tinyfish-cookbook" },
    { owner: "scrapy", repo: "scrapy" },
    { owner: "microsoft", repo: "playwright" },
    { owner: "puppeteer", repo: "puppeteer" },
  ],
  ai: [
    { owner: "langchain-ai", repo: "langchain" },
    { owner: "huggingface", repo: "transformers" },
    { owner: "ggerganov", repo: "llama.cpp" },
    { owner: "ollama", repo: "ollama" },
    { owner: "vllm-project", repo: "vllm" },
  ],
  supabase_stack: [
    { owner: "supabase", repo: "supabase" },
    { owner: "supabase", repo: "pg_net" },
    { owner: "vercel", repo: "next.js" },
    { owner: "tailwindlabs", repo: "tailwindcss" },
    { owner: "vitejs", repo: "vite" },
  ],
};

const GITHUB_API = "https://api.github.com";
const TARGET_FILES = [
  "README.md", "readme.md", "ARCHITECTURE.md",
  "src/index.ts", "src/index.js", "src/main.py", "src/app.py",
  "lib/index.ts", "index.ts", "index.js", "main.py", "app.py",
  "package.json", "pyproject.toml", "setup.py", "requirements.txt",
  "docs/README.md", "CONTRIBUTING.md",
];

function chunkText(text: string, maxChars = 1800, overlap = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    start += maxChars - overlap;
    if (start >= text.length) break;
  }
  return chunks.filter(c => c.trim().length > 80);
}

async function fetchFile(owner: string, repo: string, path: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = { "Accept": "application/vnd.github.v3.raw", "User-Agent": "SaraAI/1.0" };
  if (token) headers["Authorization"] = `token ${token}`;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, { headers });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 15000);
  } catch { return null; }
}

async function fetchMeta(owner: string, repo: string, token?: string): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { "Accept": "application/vnd.github.v3+json", "User-Agent": "SaraAI/1.0" };
  if (token) headers["Authorization"] = `token ${token}`;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function syncOneRepo(
  supabase: ReturnType<typeof createClient>,
  owner: string,
  repo: string,
  token?: string
): Promise<{ owner: string; repo: string; chunks: number; status: string }> {
  try {
    const meta = await fetchMeta(owner, repo, token);
    if (!meta) return { owner, repo, chunks: 0, status: "not_found" };

    const { data: repoRecord } = await supabase
      .from("github_repos")
      .upsert({
        owner, repo,
        description: meta.description as string,
        stars: meta.stargazers_count as number,
        language: meta.language as string,
        topics: (meta.topics as string[]) ?? [],
      }, { onConflict: "owner,repo" })
      .select().single();

    if (!repoRecord) return { owner, repo, chunks: 0, status: "db_error" };

    // Fetch files
    const files: Array<{ path: string; content: string }> = [];
    for (const filePath of TARGET_FILES) {
      const content = await fetchFile(owner, repo, filePath, token);
      if (content) files.push({ path: filePath, content });
    }

    if (files.length === 0) return { owner, repo, chunks: 0, status: "no_files" };

    // Delete old chunks + insert new
    await supabase.from("document_chunks").delete().eq("repo_id", repoRecord.id);

    let totalChunks = 0;
    for (const file of files) {
      const chunks = chunkText(file.content);
      for (let i = 0; i < chunks.length; i++) {
        await supabase.from("document_chunks").insert({
          repo_id: repoRecord.id,
          source_path: file.path,
          content: chunks[i],
          chunk_index: i,
          metadata: { repo: `${owner}/${repo}` },
        });
        totalChunks++;
      }
    }

    await supabase.from("github_repos").update({
      indexed_at: new Date().toISOString(),
      chunk_count: totalChunks,
    }).eq("id", repoRecord.id);

    return { owner, repo, chunks: totalChunks, status: "ok" };
  } catch (e: unknown) {
    return { owner, repo, chunks: 0, status: e instanceof Error ? e.message : "error" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { repos, use_preset } = await req.json();
    const token = Deno.env.get("GITHUB_TOKEN");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Determine repo list
    let targets: Array<{ owner: string; repo: string }> = [];
    if (use_preset && PRESETS[use_preset]) {
      targets = PRESETS[use_preset];
    } else if (repos?.length) {
      targets = repos;
    } else {
      targets = PRESETS.top20;
    }

    // Process in batches of 3 (GitHub rate limiting)
    const results = [];
    for (let i = 0; i < targets.length; i += 3) {
      const batch = targets.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(r => syncOneRepo(supabase, r.owner, r.repo, token)));
      results.push(...batchResults);
      // Small delay between batches
      if (i + 3 < targets.length) await new Promise(r => setTimeout(r, 500));
    }

    const succeeded = results.filter(r => r.status === "ok").length;
    const totalChunks = results.reduce((s, r) => s + r.chunks, 0);

    return new Response(JSON.stringify({
      success: true,
      repos_processed: results.length,
      repos_succeeded: succeeded,
      total_chunks: totalChunks,
      results,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: cors });
  }
});

export { PRESETS };
