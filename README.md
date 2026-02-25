# Sara AI — 1.0 02B

**Sara** = LLaMA 3.3 70B + Supabase + TinyFish + Scrapling + GitHub RAG + 4-Agent pipeline

## Absorbed Repos
| Repo | Power gained |
|------|-------------|
| D4Vinci/Scrapling | Adaptive scraping, Cloudflare bypass, stealth mode, spider crawls |
| tinyfish-io/tinyfish-cookbook | Any website → structured JSON, real browser agent |
| Top 20 AI/ML repos | Training data: LangChain, SAM, LLMs-from-scratch, etc. |

## Association Market
New feature: select 2–5 indexed repos → Sara generates a **complete working service** with architecture, starter code, and deployment guide. Pre-built templates included.

## Setup (15 min, $0)

```bash
# 1. Create Supabase project → run SQL migration
# 2. Get keys: Groq (console.groq.com) + TinyFish (tinyfish.ai)
# 3. Deploy 5 edge functions:
npx supabase login && npx supabase link --project-ref YOUR_REF
npx supabase functions deploy chat multiagent associate github-sync bulk-sync
# 4. Set secrets in Supabase Dashboard:
#    GROQ_API_KEY, TINYFISH_API_KEY, GITHUB_TOKEN (optional)
# 5. npm install && npm run dev → Settings → paste Supabase URL+Key
```

## Key Features
- **Solo mode**: LLaMA 3.3 70B + RAG + live web
- **4-Agent mode**: Researcher (live web) → Architect → Critic → Synthesizer
- **Association Market**: 6 pre-built templates + custom combinations
- **Bulk sync**: Index Top 20 AI repos in 1 click
- **Scrapling**: Python adaptive scraping in every code answer
