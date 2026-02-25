/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_KEY: string | undefined;
  readonly VITE_GROQ_KEY: string | undefined;
  readonly VITE_GITHUB_TOKEN: string | undefined;
  readonly VITE_TINYFISH_KEY: string | undefined;
  readonly VITE_SCRAPLING_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
