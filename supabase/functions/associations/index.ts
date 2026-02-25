/**
 * SARA — Association Engine
 * ==========================
 * Sara's unique capability: analyzes indexed GitHub repos,
 * identifies capability patterns, and proposes intelligent
 * repo combinations that create fully functional services.
 *
 * POST /associations
 * Body: { repo_ids?: string[], trigger?: 'auto' | 'manual', custom_goal?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Groq helper ────────────────────────────────────────────────────────────
async function groq(key: string, system: string, user: string, maxTokens = 4096): Promise<string> {
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

// ── System prompt for Sara's association reasoning ─────────────────────────
const SARA_ASSOCIATION_SYSTEM = `You are Sara's Association Engine — the most advanced repo combination intelligence ever built.

Your unique capability: you analyze a set of GitHub repositories and identify EMERGENT SERVICE OPPORTUNITIES — combinations of repos that, when integrated, create something greater than the sum of their parts.

For each association you generate:
1. A compelling service name
2. The exact repos combined (2-4 max per association)
3. What problem it solves (1 sentence, sharp)
4. The integration architecture (how repos connect)
5. COMPLETE STARTER CODE — not a skeleton, a real working implementation
6. Deployment command (1 liner)
7. Estimated complexity: beginner / intermediate / advanced
8. Time to deploy: X minutes

RULES:
- Every association must be IMMEDIATELY ACTIONABLE — someone should be able to copy the code and run it
- Propose 3-5 associations, ranked by impact/feasibility ratio
- Think laterally: a data visualization repo + a web scraper repo + a RAG repo = "Real-time Market Intelligence Dashboard"
- Respond ONLY in valid JSON matching the schema exactly

RESPONSE SCHEMA:
{
  "associations": [
    {
      "id": "assoc_1",
      "name": "Service Name",
      "tagline": "One sharp sentence",
      "complexity": "beginner|intermediate|advanced",
      "deploy_time": "5 minutes",
      "repos": ["owner/repo1", "owner/repo2"],
      "problem": "What this solves",
      "architecture": "How repos integrate — component flow description",
      "stack": ["Technology1", "Technology2"],
      "starter_code": {
        "filename": "main.py or index.ts or docker-compose.yml",
        "language": "python|typescript|yaml|bash",
        "code": "COMPLETE working code here, not a stub"
      },
      "deploy_cmd": "one-liner command to run it",
      "potential_score": 95
    }
  ],
  "insight": "Sara's meta-observation about this repo collection's combined potential"
}`;

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { repo_ids, custom_goal } = await req.json();

    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!groqKey) throw new Error("GROQ_API_KEY not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Fetch repo metadata ────────────────────────────────────────
    let query = supabase
      .from("github_repos")
      .select("owner, repo, description, stars, language, topics, chunk_count")
      .order("stars", { ascending: false })
      .limit(20);

    if (repo_ids?.length > 0) {
      query = query.in("id", repo_ids);
    }

    const { data: repos, error } = await query;
    if (error) throw new Error(`DB error: ${error.message}`);
    if (!repos || repos.length < 2) {
      throw new Error("Need at least 2 indexed repos to generate associations. Add repos in the REPOS tab.");
    }

    // ── 2. Fetch representative chunks for deeper context ─────────────
    const repoList = repos.map((r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`).join(", ");
    const repoBriefs = repos.map((r: { owner: string; repo: string; description: string | null; language: string | null; stars: number; topics?: string[] }) =>
      `REPO: ${r.owner}/${r.repo}
  Description: ${r.description ?? "No description"}
  Language: ${r.language ?? "Unknown"}
  Stars: ${r.stars?.toLocaleString() ?? 0}
  Topics: ${r.topics?.join(", ") ?? "none"}`
    ).join("\n\n");

    // Fetch some actual content chunks to give Sara real knowledge
    let chunkContext = "";
    try {
      const { data: chunks } = await supabase
        .from("document_chunks")
        .select("content, source_path, github_repos!inner(owner, repo)")
        .limit(12);

      if (chunks?.length) {
        chunkContext = "\n\nACTUAL REPO CONTENT (from indexed chunks):\n" +
          chunks.map((c: { github_repos: { owner: string; repo: string }; source_path: string; content: string }) =>
            `[${c.github_repos.owner}/${c.github_repos.repo} — ${c.source_path}]\n${c.content.slice(0, 300)}`
          ).join("\n---\n");
      }
    } catch (_) { /* optional */ }

    const goalLine = custom_goal
      ? `\nUSER'S GOAL: ${custom_goal}\nPrioritize associations that serve this goal.`
      : "";

    const userPrompt = `Analyze these ${repos.length} GitHub repositories and propose intelligent service associations:

${repoBriefs}${chunkContext}${goalLine}

Generate associations that are creative, immediately deployable, and powerful.
Each association should feel like something a senior engineer would build on a weekend and ship.`;

    // ── 3. Call Sara (Groq LLaMA 3.3 70B) ────────────────────────────
    let rawJson = await groq(groqKey, SARA_ASSOCIATION_SYSTEM, userPrompt, 4096);

    // Strip markdown code fences if present
    rawJson = rawJson.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (_) {
      // Try to extract JSON from response
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Sara returned non-JSON response. Try again.");
    }

    // Persist associations to DB for caching
    try {
      await supabase.from("user_settings").upsert({
        key: "last_associations",
        value: { ...parsed, repos_used: repoList, generated_at: new Date().toISOString() }
      }, { onConflict: "key" });
    } catch (_) { /* non-critical */ }

    return new Response(JSON.stringify({
      success: true,
      ...parsed,
      repos_analyzed: repos.length,
      model: "llama-3.3-70b-versatile",
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
