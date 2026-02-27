/**
 * Sara — Multi-Agent Edge Function
 * ==================================
 * 4 agents × Groq LLaMA 3.3 70B
 * + pgvector RAG (GitHub knowledge base)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function groq(key: string, system: string, user: string, maxTokens = 1400): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.7, max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();

  try {
    const { message, session_id, history = [], repos = [] } = await req.json();
    if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: cors });

    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!groqKey) throw new Error("GROQ_API_KEY not set");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── 0. RAG context ───────────────────────────────────────────────
    let ragContext = "";
    try {
      const { data: emb } = await supabase.functions.invoke("embed", { body: { text: message } });
      if (emb?.embedding) {
        const { data: chunks } = await supabase.rpc("search_chunks", {
          query_embedding: emb.embedding, match_count: 8,
          filter_repo_id: repos.length === 1 ? repos[0] : null,
        });
        if (chunks?.length > 0) {
          ragContext = `\n\n<github_knowledge_base>\n${chunks.map((c: { source_path: string; content: string }) => `[${c.source_path}]\n${c.content}`).join("\n---\n")}\n</github_knowledge_base>`;
        }
      }
    } catch (_) {}

    const baseQuery = `TASK: ${message}${ragContext}`;

    // ── AGENT 1: RESEARCHER ───────────────────────────────────────────
    const research = await groq(groqKey,
      `You are Sara's Researcher agent. You have access to an indexed GitHub knowledge base (RAG).
      
MISSION: Phase 1 (Discovery) + Phase 2 (Planning)
- Identify the REAL need behind the request
- Use github knowledge_base to ground technical recommendations
- Identify required services, APIs, dependencies
- Challenge assumptions. What's the actual problem?
- 200-300 words, structured, specific.`,
      baseQuery, 1200
    );

    // ── AGENT 2: ANALYST/ARCHITECT ────────────────────────────────────
    const analysis = await groq(groqKey,
      `You are Sara's Architect agent — FAANG principal engineer, architecture-first.

MISSION: Deep technical analysis + design
- State: target filepath | purpose | dependencies | consumers
- Strict separation: frontend / backend / shared
- Identify patterns, risks, complexity
- Reference specific code from github knowledge if available
- 200-300 words, precise.`,
      `TASK: ${message}${ragContext}\n\n<researcher>\n${research}\n</researcher>`,
      1200
    );

    // ── AGENT 3: CRITIC ───────────────────────────────────────────────
    const critique = await groq(groqKey,
      `You are Sara's Critic agent — world-class devil's advocate.

MISSION: Find what they missed
- Hidden risks and failure modes
- Wrong assumptions in Researcher + Architect's analysis
- The simpler path they overlooked
- Scale problems, UX gaps, security holes
- 150-200 words, ruthless but constructive.`,
      `TASK: ${message}\n\n<researcher>\n${research}\n</researcher>\n\n<analyst>\n${analysis}\n</analyst>`,
      1000
    );

    // ── AGENT 4: SYNTHESIZER ──────────────────────────────────────────
    const synthesis = await groq(groqKey,
      `You are Sara's Synthesizer — final decision maker with full context.

MISSION: Deliver the definitive, production-ready answer
- Integrate all 3 agents, resolve conflicts clearly
- Include exact steps, ready-to-run code if needed
- Deployment notes
- End with: v2 improvements (3 bullet points)

This is what the user sees. Make it outstanding. Use markdown.`,
      `TASK: ${message}${ragContext}\n\n<researcher>\n${research}\n</researcher>\n\n<analyst>\n${analysis}\n</analyst>\n\n<critic>\n${critique}\n</critic>`,
      2500
    );

    const duration = (Date.now() - t0) / 1000;

    // ── Persist ───────────────────────────────────────────────────────
    let sid = session_id;
    if (!sid) {
      const { data: s } = await supabase.from("chat_sessions").insert({ title: message.slice(0, 60), mode: "multiagent" }).select().single();
      sid = s?.id;
    }
    if (sid) {
      await supabase.from("chat_messages").insert([
        { session_id: sid, role: "user", content: message },
        { session_id: sid, role: "assistant", content: synthesis, metadata: {
          mode: "multiagent", model: "llama-3.3-70b-versatile",
          duration_seconds: duration, rag_used: ragContext.length > 0,
          agents: { research, analysis, critique }
        }},
      ]);
    }

    return new Response(JSON.stringify({
      success: true, answer: synthesis,
      researcher_findings: research, analyst_analysis: analysis, critic_critique: critique,
      session_id: sid, model: "llama-3.3-70b-versatile", provider: "groq",
      duration_seconds: duration, rag_used: ragContext.length > 0,
      agents_ran: 4,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: cors });
  }
});
