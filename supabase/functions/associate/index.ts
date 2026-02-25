/**
 * Sara — Association Engine
 * ==========================
 * Takes 2-5 GitHub repos → generates a complete working service.
 * Now powered by TinyFish: browses live docs/demos of each repo.
 * Absorbed: github.com/tinyfish-io/tinyfish-cookbook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { browseWeb, formatWebResults } from "../_shared/tinyfish.ts";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function groq(key: string, system: string, user: string, maxTokens = 1500): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.7, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();

  try {
    const { repo_ids, custom_goal } = await req.json();
    if (!repo_ids || repo_ids.length < 1) return new Response(JSON.stringify({ error: "At least 1 repo_id required" }), { status: 400, headers: cors });

    const groqKey = Deno.env.get("GROQ_API_KEY");
    const tinyfishKey = Deno.env.get("TINYFISH_API_KEY") ?? "";
    if (!groqKey) throw new Error("GROQ_API_KEY not set");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── 1. Fetch repo metadata + chunks ───────────────────────────────
    const { data: repos } = await supabase.from("github_repos").select("*").in("id", repo_ids);
    if (!repos?.length) throw new Error("No repos found");

    const chunksByRepo: Record<string, string[]> = {};
    for (const repo of repos) {
      const { data: chunks } = await supabase.from("document_chunks").select("content,source_path").eq("repo_id", repo.id).limit(4);
      chunksByRepo[repo.id] = (chunks || []).map((c) => `[${c.source_path}]\n${c.content.slice(0, 600)}`);
    }

    // ── 2. TinyFish: browse live GitHub pages for each repo ───────────
    let liveWebContext = "";
    if (tinyfishKey) {
      const browseTargets = repos.map(r => ({
        url: `https://github.com/${r.owner}/${r.repo}`,
        goal: `Extract: main purpose, key features, primary exports/APIs, integration patterns, example usage. Format as structured summary.`,
      }));
      const webResults = await Promise.all(browseTargets.map(t => browseWeb(t.url, t.goal, tinyfishKey, 20000)));
      liveWebContext = formatWebResults(webResults.filter(r => r.success));
    }

    const repoSummary = repos.map((r) => {
      const chunks = chunksByRepo[r.id] || [];
      return `### ${r.owner}/${r.repo} (★${r.stars?.toLocaleString() || 0} | ${r.language || "?"})\n${r.description || ""}\n\nIndexed content:\n${chunks.join("\n---\n").slice(0, 1000)}`;
    }).join("\n\n========\n\n");

    const goalLine = custom_goal ? `\nUser goal: "${custom_goal}"` : "";
    const fullContext = `${repoSummary}${liveWebContext}${goalLine}`;

    // ── 3. RESEARCHER: Deep analysis ──────────────────────────────────
    const research = await groq(groqKey,
      `You are Sara's Researcher. Analyze these GitHub repos deeply.
Use any live_web_data provided — it's real-time from the actual repo pages.
For each repo: PURPOSE | KEY EXPORTS/APIs | INTEGRATION POINTS | IDEAL COMBINATIONS
Be specific about functions, hooks, CLI commands, SDK methods exposed.`,
      `Analyze these repos:\n${fullContext}`, 1400
    );

    // ── 4. ARCHITECT: Design the combined service ─────────────────────
    const architecture = await groq(groqKey,
      `You are Sara's Architect. Design a service that elegantly combines these repos.
Output format (exact):
SERVICE NAME: [creative, memorable name]
TAGLINE: [one sentence]
WHAT IT DOES: [2-3 sentences of concrete functionality]
ARCHITECTURE:
  - Layer 1: [repo] → [responsibility]
  - Layer 2: [repo] → [responsibility]
  ...
DATA FLOW: [how data moves between layers]
WHY IT WORKS: [technical reasoning]`,
      `Repos: ${repos.map(r => `${r.owner}/${r.repo}: ${r.description}`).join("\n")}\n\nResearcher:\n${research}${liveWebContext}${goalLine}`, 1200
    );

    // ── 5. SYNTHESIZER: Generate real starter code ────────────────────
    const starterCode = await groq(groqKey,
      `You are Sara's Code Synthesizer. Write the main integration file.
Rules:
- Wire all repos together in one file
- Proper imports, config, working example
- Comments at every integration point
- Fully typed TypeScript or Python
- Package.json deps at the end
- Markdown code block with language tag`,
      `Architecture:\n${architecture}\n\nRepos: ${repos.map(r => `${r.owner}/${r.repo}`).join(", ")}${liveWebContext}${goalLine}`, 2500
    );

    // ── 6. STRATEGIST: Deploy guide ───────────────────────────────────
    const strategy = await groq(groqKey,
      `You are Sara's Deployment Strategist.
Write a concise deploy guide:
## Quick Start (≤5 steps)
## File Structure (tree)
## Environment Variables (table)
## Deploy to Production (2 platforms)
## v2 Ideas (3 bullets)`,
      `Service:\n${architecture}\nRepos: ${repos.map(r => `${r.owner}/${r.repo}`).join(", ")}`, 1400
    );

    const serviceNameMatch = architecture.match(/SERVICE NAME:\s*(.+)/i);
    const taglineMatch = architecture.match(/TAGLINE:\s*(.+)/i);
    const serviceName = serviceNameMatch?.[1]?.trim() || repos.map(r => r.repo).join(" + ");
    const tagline = taglineMatch?.[1]?.trim() || "Generated by Sara";

    return new Response(JSON.stringify({
      success: true,
      service_name: serviceName, tagline,
      repos_combined: repos.map(r => ({ owner: r.owner, repo: r.repo, stars: r.stars, language: r.language })),
      research, architecture, starter_code: starterCode, deployment_strategy: strategy,
      duration_seconds: (Date.now() - t0) / 1000,
      live_web_used: liveWebContext.length > 0,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: cors });
  }
});
