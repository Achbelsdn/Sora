/**
 * FORGE AI — GitHub Sync Edge Function
 * ======================================
 * Fetches GitHub repo content → chunks → embeds → stores in pgvector
 * 
 * POST /github-sync
 * Body: { owner, repo }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GITHUB_API = "https://api.github.com";

// Files to fetch per repo (most valuable for RAG)
const TARGET_FILES = [
  "README.md", "readme.md",
  "ARCHITECTURE.md", "CONTRIBUTING.md", "DOCS.md",
  "docs/README.md", "documentation/README.md",
  "src/index.ts", "src/index.js", "src/main.ts", "src/app.ts",
  "lib/index.ts", "index.ts", "index.js",
  "package.json", "Cargo.toml", "pyproject.toml", "go.mod",
];

// Simple text chunker — ~500 tokens per chunk with 50-token overlap
function chunkText(text: string, maxChars = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    start += maxChars - overlap;
    if (start >= text.length) break;
  }
  return chunks.filter(c => c.trim().length > 100);
}

async function fetchGitHubFile(owner: string, repo: string, path: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3.raw",
    "User-Agent": "ForgeAI/1.0",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, { headers });
  if (!res.ok) return null;
  return await res.text();
}

async function fetchRepoMeta(owner: string, repo: string, token?: string) {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "ForgeAI/1.0",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!res.ok) return null;
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { owner, repo } = await req.json();
    if (!owner || !repo) {
      return new Response(JSON.stringify({ error: "owner and repo required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const githubToken = Deno.env.get("GITHUB_TOKEN");

    // ── 1. Fetch repo metadata ────────────────────────────────────────
    const meta = await fetchRepoMeta(owner, repo, githubToken);
    if (!meta) throw new Error(`GitHub repo ${owner}/${repo} not found or rate limited`);

    // ── 2. Upsert repo record ─────────────────────────────────────────
    const { data: repoRecord, error: repoErr } = await supabase
      .from("github_repos")
      .upsert({
        owner,
        repo,
        description: meta.description,
        stars: meta.stargazers_count,
        language: meta.language,
        topics: meta.topics ?? [],
      }, { onConflict: "owner,repo" })
      .select()
      .single();

    if (repoErr) throw new Error(`DB error: ${repoErr.message}`);

    // ── 3. Fetch files ────────────────────────────────────────────────
    const fetchedFiles: Array<{ path: string; content: string }> = [];

    for (const filePath of TARGET_FILES) {
      const content = await fetchGitHubFile(owner, repo, filePath, githubToken);
      if (content && content.length > 50) {
        fetchedFiles.push({ path: filePath, content: content.slice(0, 20000) });
      }
    }

    // Also try to get top-level src files via tree API
    try {
      const treeHeaders: Record<string, string> = { "User-Agent": "ForgeAI/1.0" };
      if (githubToken) treeHeaders["Authorization"] = `token ${githubToken}`;
      const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=0`, { headers: treeHeaders });
      if (treeRes.ok) {
        const tree = await treeRes.json();
        const srcFiles = (tree.tree || [])
          .filter((f: { type: string; path: string }) => f.type === "blob" && 
            (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".py") || f.path.endsWith(".md")) &&
            !f.path.includes("node_modules") && !f.path.includes(".min."))
          .slice(0, 10);

        for (const file of srcFiles) {
          if (!fetchedFiles.find(f => f.path === file.path)) {
            const content = await fetchGitHubFile(owner, repo, file.path, githubToken);
            if (content && content.length > 100) {
              fetchedFiles.push({ path: file.path, content: content.slice(0, 10000) });
            }
          }
        }
      }
    } catch (_) { /* optional */ }

    // ── 4. Delete old chunks ──────────────────────────────────────────
    await supabase.from("document_chunks").delete().eq("repo_id", repoRecord.id);

    // ── 5. Chunk + embed + insert ─────────────────────────────────────
    let totalChunks = 0;

    for (const file of fetchedFiles) {
      const chunks = chunkText(file.content);

      for (let i = 0; i < chunks.length; i++) {
        // Generate embedding via the embed function
        let embedding = null;
        try {
          const { data: embData } = await supabase.functions.invoke("embed", {
            body: { text: chunks[i] },
          });
          embedding = embData?.embedding ?? null;
        } catch (_) { /* embed optional */ }

        await supabase.from("document_chunks").insert({
          repo_id: repoRecord.id,
          source_path: file.path,
          content: chunks[i],
          chunk_index: i,
          embedding,
          metadata: { repo: `${owner}/${repo}`, file: file.path },
        });

        totalChunks++;
      }
    }

    // ── 6. Update indexed_at + chunk_count ───────────────────────────
    await supabase.from("github_repos").update({
      indexed_at: new Date().toISOString(),
      chunk_count: totalChunks,
    }).eq("id", repoRecord.id);

    return new Response(JSON.stringify({
      success: true,
      repo: `${owner}/${repo}`,
      repo_id: repoRecord.id,
      files_indexed: fetchedFiles.length,
      chunks_created: totalChunks,
      files: fetchedFiles.map(f => f.path),
      stars: meta.stargazers_count,
      language: meta.language,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
