# Sara AI — 1.0 02B

**Sara** = LLaMA 3.3 70B + Supabase + GitHub RAG + 4-Agent pipeline

## Setup (15 min, $0)

```bash
# 1. Create Supabase project → run SQL migration
# 2. Get keys: Groq (console.groq.com)
# 3. Deploy 5 edge functions:
npx supabase login && npx supabase link --project-ref YOUR_REF
npx supabase functions deploy chat multiagent associate github-sync bulk-sync
# 4. Set secrets in Supabase Dashboard:
#    GROQ_API_KEY, GITHUB_TOKEN (optional)
# 5. npm install && npm run dev → Settings → paste Supabase URL+Key
```

## Key Features
- **Solo mode**: LLaMA 3.3 70B + GitHub RAG
- **4-Agent mode**: Researcher (RAG) → Architect → Critic → Synthesizer
- **Association Market**: 6 pre-built templates + custom combinations
- **Bulk sync**: Index Top 20 AI repos in 1 click
