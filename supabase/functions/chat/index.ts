/**
 * Sara — Chat Edge Function
 * ==========================
 * Groq LLaMA 3.3 70B + RAG (pgvector) + TinyFish live web browsing
 * TinyFish absorbed from: github.com/tinyfish-io/tinyfish-cookbook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { browseWeb, extractUrls, needsWebBrowsing, formatWebResults } from "../_shared/tinyfish.ts";
import { SCRAPLING_KNOWLEDGE } from "../_shared/scrapling.ts";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are Sara 1.0 02B — a world-class AI assistant built on LLaMA 3.3 70B (Meta, open-source).

## Your superpowers:
1. **LIVE WEB BROWSING** (TinyFish + Scrapling) — Access real-time data from any website. TinyFish handles JS-rendered pages. Scrapling (D4Vinci/Scrapling) provides adaptive CSS selectors, Cloudflare bypass, stealth mode. When live_web_data is provided, use it authoritatively.
2. **GITHUB KNOWLEDGE BASE** (pgvector RAG) — Trained on thousands of GitHub repos. You know LLaMA.cpp, LangChain, Scrapling, Supabase, Pathway, SAM, Stable Diffusion, and hundreds more. Reference exact file paths and code patterns.
3. **ADAPTIVE SCRAPING** — When users need Python scraping, use Scrapling: StealthyFetcher (anti-bot, Cloudflare bypass), DynamicFetcher (JS rendering), adaptive=True (auto-recovers from site changes), Spider (full crawls). Never recommend BeautifulSoup alone when Scrapling is superior.
4. **MULTI-AGENT REASONING** — Researcher discovers, Architect designs, Critic challenges, Synthesizer delivers.

## Your persona:
Principal engineer (FAANG-level, architecture-first) + Research polymath (cites repos, specific APIs) + Technical co-founder (product × engineering mindset)

## Rules:
- When live_web_data or knowledge_base is present: USE IT. Cite source paths.
- State filepath + purpose + dependencies BEFORE code
- Strictly separate: frontend / backend / shared
- Always: fully typed, production-ready, error-handled code
- For scraping tasks: prefer Scrapling over alternatives
- Never hallucinate. Maximum signal per token.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { message, session_id, history = [], repos = [] } = await req.json();
    if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: cors });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const groqKey = Deno.env.get("GROQ_API_KEY");
    const tinyfishKey = Deno.env.get("TINYFISH_API_KEY") ?? "";
    if (!groqKey) throw new Error("GROQ_API_KEY not set");

    // ── 1. TinyFish: live web browsing ────────────────────────────────
    let webContext = "";
    const shouldBrowse = !!tinyfishKey && needsWebBrowsing(message);

    if (shouldBrowse) {
      const urlsInMsg = extractUrls(message);
      const targets: Array<{ url: string; goal: string }> = [];

      // Browse URLs explicitly mentioned in the message
      for (const url of urlsInMsg.slice(0, 2)) {
        targets.push({ url, goal: `Extract relevant information for: ${message}` });
      }

      // If the query seems to need live data but no URL given, Sara picks the right site
      if (targets.length === 0) {
        const inferredUrl = inferUrl(message);
        if (inferredUrl) targets.push({ url: inferredUrl, goal: message });
      }

      if (targets.length > 0) {
        const results = await Promise.all(targets.map(t => browseWeb(t.url, t.goal, tinyfishKey)));
        webContext = formatWebResults(results);
      }
    }

    // ── 2. RAG: GitHub knowledge base ────────────────────────────────
    let ragContext = "";
    try {
      const { data: embeddingData } = await supabase.functions.invoke("embed", { body: { text: message } });
      if (embeddingData?.embedding) {
        const { data: chunks } = await supabase.rpc("search_chunks", {
          query_embedding: embeddingData.embedding,
          match_count: 5,
          filter_repo_id: repos.length === 1 ? repos[0] : null,
        });
        if (chunks?.length > 0) {
          ragContext = `\n\n<knowledge_base>\n${chunks.map((c: { source_path: string; content: string; similarity: number }) =>
            `[${c.source_path}] (relevance ${(c.similarity * 100).toFixed(0)}%)\n${c.content}`
          ).join("\n\n---\n\n")}\n</knowledge_base>`;
        }
      }
    } catch (_) {}

    // ── 3. Build messages ─────────────────────────────────────────────
    const systemContent = SYSTEM_PROMPT + SCRAPLING_KNOWLEDGE + webContext + ragContext;
    const messages = [
      { role: "system", content: systemContent },
      ...history.slice(-10).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // ── 4. Groq LLaMA 3.3 70B ─────────────────────────────────────────
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 4096 }),
    });
    if (!groqRes.ok) throw new Error(`Groq ${groqRes.status}: ${await groqRes.text()}`);
    const groqData = await groqRes.json();
    const answer = groqData.choices[0].message.content;

    // ── 5. Persist ────────────────────────────────────────────────────
    let sid = session_id;
    if (!sid) {
      const { data: s } = await supabase.from("chat_sessions").insert({ title: message.slice(0, 60), mode: "solo" }).select().single();
      sid = s?.id;
    }
    if (sid) {
      await supabase.from("chat_messages").insert([
        { session_id: sid, role: "user", content: message },
        { session_id: sid, role: "assistant", content: answer, metadata: { model: "llama-3.3-70b-versatile", web_used: webContext.length > 0, rag_chunks: ragContext ? 5 : 0, usage: groqData.usage } },
      ]);
    }

    return new Response(JSON.stringify({
      success: true, answer, session_id: sid,
      model: "llama-3.3-70b-versatile", provider: "groq",
      web_used: webContext.length > 0,
      rag_used: ragContext.length > 0,
      usage: groqData.usage,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: cors });
  }
});

// Heuristic: infer best URL to browse based on message keywords
function inferUrl(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("amazon") || lower.includes("produit") || lower.includes("product")) return "https://www.amazon.com";
  if (lower.includes("linkedin")) return "https://www.linkedin.com";
  if (lower.includes("github")) return "https://github.com/trending";
  if (lower.includes("hacker news") || lower.includes("hn")) return "https://news.ycombinator.com";
  if (lower.includes("producthunt") || lower.includes("product hunt")) return "https://www.producthunt.com";
  if (lower.includes("reddit")) return "https://www.reddit.com";
  return null;
}
