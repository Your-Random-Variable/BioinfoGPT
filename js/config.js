/* ============================================================
 *  BioinfoGPT — global configuration
 *  ------------------------------------------------------------
 *  Edit the values below ONCE, then push the repo to GitHub.
 *  Visitors never touch this file — they just use the site.
 * ============================================================ */
window.CONFIG = {
  /* ------------------------------------------------------------------
   * 1) Cloudflare Worker proxy URL (the default "no API key" mode)
   * ------------------------------------------------------------------
   * Deploy the worker in /worker (see README), then paste your URL here.
   * Example: "https://bioinfogpt-worker.my-account.workers.dev"
   * Leave the placeholder until you have deployed it — the site will
   * still work in "Bring-your-own-key" mode from Settings.
   */
  PROXY_URL: "https://bioinfogpt-worker.YOUR-SUBDOMAIN.workers.dev",

  /* ------------------------------------------------------------------
   * 2) BUILT-IN GROQ API KEY (the "no setup" default)
   * ------------------------------------------------------------------
   * The site uses this key directly from the browser, so visitors need
   * nothing. Users can still paste their OWN key in Settings to override.
   *
   * ⚠ SECURITY WARNING: this key is embedded in the frontend and WILL be
   * visible to anyone who views your page source. Anyone can copy it and
   * use (or drain) your Groq quota. Only acceptable for personal/trusted
   * sites. For a public deployment, prefer keeping the key as a secret on
   * the Cloudflare Worker (apiMode "proxy") instead, and leave this empty.
   * You can rotate the key anytime at https://console.groq.com/keys
   */
  DEFAULT_GROQ_KEY: "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",

  /* Optional secondary Groq keys for rotation/fallback (free) */
  SECONDARY_GROQ_KEYS: [],

  /* ------------------------------------------------------------------
   * 3) Optional shared secret (anti-abuse)
   * ------------------------------------------------------------------
   * If you set APP_SECRET on the Worker (`wrangler secret put APP_SECRET`),
   * mirror the exact same value here. Set to "" to disable the check.
   */
  APP_SECRET: "",

  /* ------------------------------------------------------------------
   * 4) Free alternative providers (no credit card) - GOOD LIMITS
   * ------------------------------------------------------------------ */
  GITHUB_MODELS_URL: "https://models.github.ai/inference",
  OPENROUTER_URL: "https://openrouter.ai/api/v1",
  CEREBRAS_URL: "https://api.cerebras.ai/v1",
  GEMINI_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  MISTRAL_URL: "https://api.mistral.ai/v1",
  POLLINATIONS_URL: "https://gen.pollinations.ai",
  DEFAULT_GITHUB_TOKEN: "",
  DEFAULT_OPENROUTER_KEY: "",
  DEFAULT_CEREBRAS_KEY: "", // removed - Cerebras not giving free queries
  DEFAULT_GEMINI_KEY: "",
  DEFAULT_MISTRAL_KEY: "",
  DEFAULT_POLLINATIONS_KEY: "",
  DEFAULT_POLLINATIONS_MODEL: "openai",

  GITHUB_FALLBACK_MODELS: [
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "Meta-Llama-3.1-405B-Instruct",
    "cohere/cohere-command-r-plus",
  ],
  OPENROUTER_FALLBACK_MODELS: [
    "openai/gpt-4o-mini:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "qwen/qwen-2-7b-instruct:free",
  ],
  CEREBRAS_FALLBACK_MODELS: [
    "llama3.1-8b",
    "llama-3.3-70b",
    "qwen-3-32b",
    "llama3.1-70b",
  ],
  GEMINI_FALLBACK_MODELS: [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ],
  MISTRAL_FALLBACK_MODELS: [
    "mistral-large-latest",
    "mistral-small-latest",
    "codestral-latest",
    "open-mistral-7b",
  ],
  POLLINATIONS_FALLBACK_MODELS: [
    "openai",
    "openai-large",
    "mistral",
    "llama",
  ],

  /* ------------------------------------------------------------------
   * 5) Local model mode (Ollama / LM Studio / any OpenAI-compatible
   *    server on your machine or LAN). Fully offline — no API key.
   * ------------------------------------------------------------------ */
  LOCAL_BASE_URL: "http://localhost:11434/v1",   // Ollama default; LM Studio = http://localhost:1234/v1
  LOCAL_FALLBACK_MODELS: ["llama3.1", "qwen2.5-coder:7b", "deepseek-coder-v2:16b"],

  /* ------------------------------------------------------------------
   * 6) Defaults
   * ------------------------------------------------------------------ */
  DEFAULT_MODEL: "llama-3.3-70b-versatile",
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 4096,

  /* Model picker contents. Kept deliberately small and curated —
   * llama-3.3-70b-versatile is the default and handles bioinformatics well.
   * Any other model ID can still be typed into Settings → Custom model ID.
   */
  MODELS: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
  ],

  /* Legacy alias — some code paths still read FALLBACK_MODELS. */
  get FALLBACK_MODELS() { return this.MODELS.map((m) => m.id); },

  /* Base system prompt. Users can override it in Settings. */
  DEFAULT_SYSTEM_PROMPT:
    "You are BioinfoGPT, an expert assistant specialized in bioinformatics and computational biology. " +
    "You answer questions about genomics, transcriptomics, proteomics, sequence analysis, phylogenetics, " +
    "structural biology, NGS data analysis, and related fields. " +
    "When the user asks for code, provide correct, well-commented code in the requested language " +
    "(Python/Biopython, R/Bioconductor, shell, etc.) and briefly explain how it works. " +
    "Be precise about tools and versions (e.g. Biopython, samtools, GATK, DESeq2) and flag approximations. " +
    "If something is outside bioinformatics, say so briefly and steer back to bioinformatics."
};
