/**
 * Sara — Configuration
 * ====================
 * Les clés sont lues depuis les variables d'environnement Vite.
 * Remplir .env à la racine du projet (copier .env.example).
 * Les Edge Functions Supabase lisent leurs clés via Deno.env (secrets Supabase Dashboard).
 */

export const ENV = {
  supabaseUrl:  import.meta.env.VITE_SUPABASE_URL  ?? '',
  supabaseKey:  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  groqKey:      import.meta.env.VITE_GROQ_API_KEY  ?? '',
  tinyfishKey:  import.meta.env.VITE_TINYFISH_API_KEY ?? '',
  githubToken:  import.meta.env.VITE_GITHUB_TOKEN   ?? '',
} as const;

export const IS_CONFIGURED = !!(ENV.supabaseUrl && ENV.supabaseKey);
