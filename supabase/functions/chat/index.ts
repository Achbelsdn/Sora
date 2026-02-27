/**
 * Sara — Chat Edge Function
 * ==========================
 * Groq LLaMA 3.3 70B + RAG (pgvector) — GitHub knowledge base only
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are Sara 1.0 02B — a world-class AI assistant built on LLaMA 3.3 70B (Meta, open-source), specialized in GitHub repository analysis.

## Your knowledge base:
**GITHUB RAG** (pgvector) — Trained exclusively on indexed GitHub repos. You know LLaMA.cpp, LangChain, Supabase, Pathway, SAM, Stable Diffusion, and hundreds more. You answer ONLY from this GitHub knowledge base.

## Your persona:
Principal engineer (FAANG-level, architecture-first) + Research polymath (cites repos, specific APIs) + Technical co-founder (product × engineering mindset)

## Rules:
- Answer ONLY from your GitHub knowledge base (RAG pgvector). Do not browse the web or scrape.
- When knowledge_base is present: USE IT. Always cite the source repo and file (source_path).
- State filepath + purpose + dependencies BEFORE code
- Strictly separate: frontend / backend / shared
- Always: fully typed, production-ready, error-handled code
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
    if (!groqKey) throw new Error("GROQ_API_KEY not set");

    // ── 1. RAG: GitHub knowledge base ────────────────────────────────
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

    // ── 2. Build messages ─────────────────────────────────────────────
    const systemContent = SYSTEM_PROMPT + ragContext;
    const messages = [
      { role: "system", content: systemContent },
      ...history.slice(-10).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // ── 3. Groq LLaMA 3.3 70B ─────────────────────────────────────────
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 4096 }),
    });
    if (!groqRes.ok) throw new Error(`Groq ${groqRes.status}: ${await groqRes.text()}`);
    const groqData = await groqRes.json();
    const answer = groqData.choices[0].message.content;

    // ── 4. Persist ────────────────────────────────────────────────────
    let sid = session_id;
    if (!sid) {
      const { data: s } = await supabase.from("chat_sessions").insert({ title: message.slice(0, 60), mode: "solo" }).select().single();
      sid = s?.id;
    }
    if (sid) {
      await supabase.from("chat_messages").insert([
        { session_id: sid, role: "user", content: message },
        { session_id: sid, role: "assistant", content: answer, metadata: { model: "llama-3.3-70b-versatile", rag_chunks: ragContext ? 5 : 0, usage: groqData.usage } },
      ]);
    }

    return new Response(JSON.stringify({
      success: true, answer, session_id: sid,
      model: "llama-3.3-70b-versatile", provider: "groq",
      rag_used: ragContext.length > 0,
      usage: groqData.usage,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: cors });
  }
});
