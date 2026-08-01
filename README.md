# 🧬 BioinfoGPT

<p align="center">
  <img src="images/bioinfogpt-banner.png" alt="BioinfoGPT banner" width="720" />
</p>

**An advanced AI assistant for bioinformatics** — answers questions, writes working code (Python/Biopython, R/Bioconductor, shell), and ships built-in sequence tools. Hosted free on **GitHub Pages**, powered by **Groq** (fast, free-tier API).

**Visitors need no API key.** The site ships with a **built-in Groq key**, so chat works
out of the box — no server, no setup, no Worker required. Four ways to run the brain:

1. **Groq — built-in key** *(default)* — the site calls Groq directly from the browser with
   the key in `js/config.js`. Visitors need nothing; works the instant it's on GitHub Pages.
2. **Groq — your own key** — anyone (or any visitor) can paste their own key in Settings to
   use their own quota instead of yours.
3. **Cloudflare Worker proxy** — your key lives server-side in a free cloud Worker. Best
   for public sites that want to hide the key.
4. **Local model** (Ollama / LM Studio on your own machine or lab LAN) — fully offline,
   zero keys, private.

---

## 🖥 No computer? Do it all from a browser (~5 min)

You don't need a terminal, a laptop, or any local software. The site already contains a
Groq key, so **chat works immediately once it's on GitHub Pages** — the Cloudflare Worker
step is now optional (only if you want to hide the key on a public site).

### Step 1 — Create the GitHub repo & upload the files
1. Sign up free at **github.com** → **New repository** → name it `bioinfogpt` (Public) → **Create repository**.
2. On the repo page: **Add file ▾ → Upload files** → drag the contents of this
   `bioinfogpt/` folder into the box → **Commit changes**.

### Step 2 — Publish (automatic)
1. Repo → **Settings** → **Pages** → **Source: GitHub Actions** → **Save**.
2. The included workflow (`deploy.yml`) builds automatically on every push.
3. Wait ~1 minute → **your site is live** at `https://<you>.github.io/bioinfogpt/` 🎉
   Chat works out of the box with the built-in Groq key.

### Step 3 — Optional: hide your key behind a Worker (public sites)
1. Get a free Groq key: **console.groq.com/keys** → Create API key (no credit card).
2. Sign up free at **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Worker** → **Deploy**.
3. Click **Edit code**, delete the sample, paste the entire contents of **`worker/worker.js`** → **Deploy**.
4. Note your Worker URL. Then Worker → **Settings** → **Variables and Secrets** → **Add** →
   `GROQ_API_KEY` = your key → **Save**.
5. In your repo, edit **`js/config.js`** → set `PROXY_URL` to your Worker URL and
   `DEFAULT_GROQ_KEY` to `""`; set the site default to proxy mode in
   `js/app.js` → `DEFAULT_SETTINGS.apiMode = "proxy"` → **Commit** (auto re-deploys).

> 💡 Want a free GitHub-provided model instead of Groq? **GitHub Models** (preview)
> hands out a free token — use it as the `GROQ_API_KEY` secret on the Worker, or
> paste it as your own key in Settings.

---

## ✨ Features

- 💬 **Chat with streaming** — typewriter-style responses, Markdown + syntax-highlighted code with one-click copy
- 🧬 **Built-in sequence tools** — paste a sequence to get:
  - Type detection (DNA / RNA / protein), length, GC/AT content, base counts
  - Approximate molecular weight & melting temperature
  - Reverse complement, reverse, translation (with frame choice)
  - Alphabet validation (highlights invalid residues)
  - Random sequence generator + full codon table
  - **"Analyze with AI"** — sends the sequence to the model for a real analysis
- 🧠 **Bioinformatics smart defaults** — the model is biased toward Biopython/R, structured answers, and honest about limits (toggle in Settings)
- 📚 **Conversation history** stored locally, exportable to Markdown
- ⚙️ **Settings** — built-in key / your own key / proxy / local model, model picker
  (live catalog), temperature, max tokens, streaming toggle, custom system prompt
- 🔒 **Private** — nothing is stored server-side; all history stays in the visitor's browser
- 📦 **Fully self-contained** — all libraries are vendored locally; the site needs no
  internet/CDN to render (only the model API itself when you chat)

## 🗂 Project structure

```
bioinfogpt/
├── index.html            # The chat UI (GitHub Pages entry point)
├── favicon.svg
├── css/style.css
├── vendor/               # marked, DOMPurify, highlight.js (offline-capable)
├── js/
│   ├── config.js         # ⚙ EDIT THIS — built-in Groq key, worker URL, defaults
│   ├── utils.js          # DOM helpers
│   ├── bio.js            # sequence tools (pure, unit-tested)
│   ├── api.js            # proxy / local / BYOK API layer (streaming SSE)
│   └── app.js            # chat UI, settings, history
├── worker/
│   ├── worker.js         # Cloudflare Worker proxy (holds your Groq key)
│   └── wrangler.toml     # Worker config (rate limits, optional secret)
├── test/                 # unit + API tests (plain Node, no deps)
├── .github/workflows/
│   └── deploy.yml        # auto-deploys to GitHub Pages on push
└── README.md
```

---

## 🚀 Setup with a computer (optional CLI alternative)

### Part 1 — Deploy the Worker (one-time)

> The Worker holds your Groq API key so visitors never see it. It forwards
> chat requests from the site. Requires a free Cloudflare account and a
> free [Groq API key](https://console.groq.com/keys).

```bash
cd worker
npx wrangler login                 # opens Cloudflare login
npx wrangler secret put GROQ_API_KEY   # paste your Groq key
npx wrangler deploy
```

You'll get a URL like `https://bioinfogpt-worker.<your-subdomain>.workers.dev`.

**Optional hardening** (recommended for a public site):

```bash
npx wrangler secret put APP_SECRET   # generate: openssl rand -hex 16
```

Then copy that same value into `js/config.js` → `APP_SECRET`.

### Part 2 — Point the site at your Worker & publish

1. Edit **`js/config.js`**:
   ```js
   PROXY_URL: "https://bioinfogpt-worker.<your-subdomain>.workers.dev",
   APP_SECRET: "your-secret-or-empty",
   ```
2. Create a GitHub repo (e.g. `bioinfogpt`), push the files:
   ```bash
   git init && git add . && git commit -m "BioinfoGPT"
   git remote add origin https://github.com/<you>/bioinfogpt.git
   git branch -M main && git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: GitHub Actions** (the included
   workflow `deploy.yml` builds automatically on every push).
4. Done 🎉 — your site is live at `https://<you>.github.io/bioinfogpt/`.

---

## 🔁 How it works (data flow)

**Default — Groq, built-in key:**

```
Visitor's browser (GitHub Pages)
   │  POST /chat/completions  {model, messages, stream}   (key in js/config.js)
   ▼
Groq API  ──►  tokens stream back (SSE)  ──►  browser renders Markdown + code
```

**Proxy mode** (key hidden server-side):

```
Browser ──► Cloudflare Worker (holds GROQ_API_KEY as a secret) ──► Groq API
```

- **Groq — built-in key (default):** visitors need nothing; the key is embedded in
  `js/config.js` and the page calls Groq directly (Groq supports CORS).
- **Groq — your own key:** anyone can paste their own key in Settings; it overrides the
  built-in key and is stored only in that visitor's `localStorage`.
- **Local model mode:** Settings → API mode → *Local model*. Point it at
  `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio).
  Fully offline; set `OLLAMA_ORIGINS=*` if the site is hosted on GitHub Pages
  (cross-origin localhost).

## 🛡 Security & fairness notes

- ⚠ **The built-in key is public.** Anyone who opens your page can view its source and
  copy the key, then use (or drain) your Groq quota. That's fine for personal/trusted
  use. For a public site, move the key to the Cloudflare Worker (proxy mode) and set
  `DEFAULT_GROQ_KEY` to `""`. Rotate the key anytime at **console.groq.com/keys**.
- In proxy mode the key never touches the frontend.
- Rate limits (per visitor IP): `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_PER_DAY`
  in `worker/wrangler.toml` — protects your quota from bots.
- Optional `APP_SECRET` blocks requests that don't know the secret.
- A minimal content guard blocks obviously abusive prompts.
- Model output is sanitized (DOMPurify) before rendering, and links open in new tabs.
- Free-tier Groq quotas are shared per key, so heavy traffic can exhaust daily limits
  (`llama-3.3-70b` ≈ 1,000 req/day on the free tier). For a high-traffic site, upgrade
  Groq or add your own billing.

## 🧪 Tests

Self-contained tests, no dependencies (plain Node ≥ 18):

```bash
node worker/test-local.mjs        # Worker proxy: health, /models, streaming SSE,
                                  # non-stream, errors, rate limits, content guard, CORS
node test/bio.test.js             # bioinformatics toolkit unit tests (28 checks)
node test/api.local.test.mjs      # local-model API path (fake Ollama server)
node test/api.groq.test.mjs       # built-in key vs "my own key" (fake Groq server)
```

Each API test spins up a fake server locally and runs the real `js/api.js` /
`worker.js` against it, so you can verify behavior without any external account.

```bash
cd bioinfogpt
python3 -m http.server 8080     # open http://localhost:8080
```

Test the Worker locally:

```bash
cd worker
npx wrangler dev                # set GROQ_API_KEY env var locally
```

## 📝 Ideas to extend

- Add a **FASTA/FASTQ file upload** → auto-analyze
- **Phylogeny / alignment** visualizations (rendered client-side)
- Chat **history sync** (your own backend or browser IndexedDB)
- **Voice input**, i18n, PWA offline mode
- Multi-provider proxy (OpenRouter, Gemini free tier) in the Worker

---

*Built with HTML/CSS/JS, Cloudflare Workers, and Groq. Not affiliated with
Groq or any bioinformatics institution — AI answers should be double-checked.*
