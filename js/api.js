/* ============================================================
 *  BioinfoGPT — API layer
 *  Supports multiple free providers, all speaking OpenAI-compatible
 *  chat completions API (incl. SSE streaming):
 *    - groq      — built-in key (default)
 *    - byok      — your own Groq key
 *    - github    — GitHub Models (free)
 *    - openrouter— OpenRouter free models
 *    - proxy     — Cloudflare Worker (key server-side)
 *    - local     — Ollama / LM Studio offline
 * ============================================================ */
window.API = (() => {
  const GROQ_ENDPOINT = "https://api.groq.com/openai/v1";
  const MODEL_CACHE = { key: null, data: null, at: 0 };

  function settings() {
    return window.Settings.get();
  }

  /* Resolve { base, path, headers } for the active mode */
  function endpoint() {
    const s = settings();

    // "groq" — built-in key (no visitor setup), unless user pasted own key
    if (s.apiMode === "groq") {
      const key = s.groqKey || window.CONFIG.DEFAULT_GROQ_KEY || "";
      if (!key) {
        throw new Error("No Groq key configured. Add one in Settings or set DEFAULT_GROQ_KEY in js/config.js. Free alternatives: GitHub Models, OpenRouter, Local.");
      }
      return { base: GROQ_ENDPOINT, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    // "byok" — explicitly user's own Groq key
    if (s.apiMode === "byok") {
      if (!s.groqKey) throw new Error("Add your Groq API key in Settings. Get a free key at https://console.groq.com/keys");
      return { base: GROQ_ENDPOINT, path: "/chat/completions", headers: { Authorization: `Bearer ${s.groqKey}` } };
    }

    if (s.apiMode === "github") {
      const base = (window.CONFIG.GITHUB_MODELS_URL || "https://models.github.ai/inference").replace(/\/+$/, "");
      const key = s.githubKey || window.CONFIG.DEFAULT_GITHUB_TOKEN || "";
      if (!key) {
        throw new Error("GitHub Models token missing. Create a token at https://github.com/settings/tokens (enable models:read) or use fine-grained token. Then paste it in Settings.");
      }
      return { base, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    if (s.apiMode === "openrouter") {
      const base = (window.CONFIG.OPENROUTER_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
      const key = s.openrouterKey || window.CONFIG.DEFAULT_OPENROUTER_KEY || "";
      if (!key) {
        throw new Error("OpenRouter key missing. Get a free key at https://openrouter.ai/keys — free models like gpt-4o-mini:free, llama-3.1-8b:free work without credit.");
      }
      return {
        base,
        path: "/chat/completions",
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": (typeof location !== "undefined" ? location.origin : "https://github.com"),
          "X-Title": "BioinfoGPT",
        },
      };
    }

    if (s.apiMode === "cerebras") {
      const base = (window.CONFIG.CEREBRAS_URL || "https://api.cerebras.ai/v1").replace(/\/+$/, "");
      const key = s.cerebrasKey || window.CONFIG.DEFAULT_CEREBRAS_KEY || "";
      if (!key) {
        throw new Error("Cerebras key missing. Get free key at https://cloud.cerebras.ai — 1M tokens/day free, no card, models llama3.1-8b, llama-3.3-70b super fast.");
      }
      return { base, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    if (s.apiMode === "gemini") {
      const base = (window.CONFIG.GEMINI_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
      const key = s.geminiKey || window.CONFIG.DEFAULT_GEMINI_KEY || "";
      if (!key) {
        throw new Error("Gemini key missing. Get free at https://aistudio.google.com/app/apikey — 1500 req/day Flash, 1M TPM, no card.");
      }
      // Gemini OpenAI compat uses Authorization Bearer? Actually uses x-goog-api-key header or Bearer. Use Bearer and also ?key= param fallback handled by fetch? We'll use Bearer + query param both? Simpler: add header and also append ?key if needed via base? We'll use header Authorization.
      return { base, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    if (s.apiMode === "mistral") {
      const base = (window.CONFIG.MISTRAL_URL || "https://api.mistral.ai/v1").replace(/\/+$/, "");
      const key = s.mistralKey || window.CONFIG.DEFAULT_MISTRAL_KEY || "";
      if (!key) {
        throw new Error("Mistral key missing. Get free at https://console.mistral.ai/api-keys — 1B tokens/month free, no card, models mistral-large, codestral.");
      }
      return { base, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    if (s.apiMode === "pollinations") {
      const base = (window.CONFIG.POLLINATIONS_URL || "https://gen.pollinations.ai").replace(/\/+$/, "");
      const key = s.pollinationsKey || window.CONFIG.DEFAULT_POLLINATIONS_KEY || "";
      const headers = key ? { Authorization: `Bearer ${key}` } : {};
      return { base, path: "/v1/chat/completions", headers };
    }

    if (s.apiMode === "proxy") {
      const base = (s.proxyUrl || window.CONFIG.PROXY_URL || "").trim().replace(/\/+$/, "");
      if (!base || base.includes("YOUR-SUBDOMAIN")) {
        throw new Error("Proxy URL not set. Deploy the Worker (see README) and set PROXY_URL in js/config.js, or switch to free alternatives: GitHub Models / OpenRouter / Local in Settings.");
      }
      return { base, path: "/chat", headers: { "X-App-Secret": window.CONFIG.APP_SECRET || "" } };
    }

    if (s.apiMode === "local") {
      const base = (s.localBaseUrl || window.CONFIG.LOCAL_BASE_URL || "").trim().replace(/\/+$/, "");
      if (!base) {
        throw new Error("Local API base URL is empty. Set it in Settings (e.g. http://localhost:11434/v1 for Ollama).");
      }
      return {
        base,
        path: "/chat/completions",
        headers: s.localKey ? { Authorization: `Bearer ${s.localKey}` } : {},
      };
    }

    throw new Error(`Unknown API mode: ${s.apiMode}`);
  }

  /* Try secondary Groq keys if primary fails with 401/429 and we are in groq mode */
  function secondaryGroqEndpoints() {
    const list = window.CONFIG.SECONDARY_GROQ_KEYS || [];
    return list.filter(Boolean).map((k) => ({
      base: GROQ_ENDPOINT,
      path: "/chat/completions",
      headers: { Authorization: `Bearer ${k}` },
    }));
  }

  function cerebrasFallbackEndpoint() {
    const cfg = window.CONFIG;
    const key = (settings().cerebrasKey || cfg.DEFAULT_CEREBRAS_KEY || "").trim();
    if (!key) return null;
    const base = (cfg.CEREBRAS_URL || "https://api.cerebras.ai/v1").replace(/\/+$/, "");
    return {
      base,
      path: "/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      isCerebras: true,
    };
  }

  function mapModelForCerebras(groqModel) {
    const m = (groqModel || "").toLowerCase();
    if (m.includes("70b") || m.includes("3.3")) return "llama-3.3-70b";
    if (m.includes("8b")) return "llama3.1-8b";
    if (m.includes("llama")) return "llama3.1-8b";
    return "llama3.1-8b";
  }

  function pollinationsFallbackEndpoint() {
    const cfg = window.CONFIG;
    const base = (cfg.POLLINATIONS_URL || "https://gen.pollinations.ai").replace(/\/+$/, "");
    const key = (settings().pollinationsKey || cfg.DEFAULT_POLLINATIONS_KEY || "").trim();
    // Only use Pollinations as automatic fallback if user actually has a key - otherwise it would hang/fail with legacy error
    if (!key) return null;
    const headers = { Authorization: `Bearer ${key}` };
    return {
      base,
      path: "/v1/chat/completions",
      headers,
      isPollinations: true,
    };
  }

  function mapModelForPollinations(groqModel) {
    // Pollinations openai-compatible currently recommends "openai" or "openai-large" as stable model
    // Avoid gemma which is not found in new API
    return "openai";
  }

  /* ------------------------- models ------------------------- */
  async function listModels() {
    const s = settings();
    const cacheKeyBase = s.apiMode === "proxy" ? (s.proxyUrl || window.CONFIG.PROXY_URL) : s.apiMode === "local" ? (s.localBaseUrl || window.CONFIG.LOCAL_BASE_URL) : s.apiMode;
    const key = `${s.apiMode}:${cacheKeyBase}`;
    if (MODEL_CACHE.key === key && Date.now() - MODEL_CACHE.at < 6 * 3600e3) return MODEL_CACHE.data;
    let ids = [];
    try {
      const { base, headers } = endpoint();
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error?.message || j.error || "models request failed");
      }
      const data = await res.json();
      ids = (data.data || []).map((m) => m.id);
      ids = ids.filter((id) => !/^(whisper|tts)/.test(id)).sort();
    } catch (err) {
      if (s.apiMode === "local") ids = window.CONFIG.LOCAL_FALLBACK_MODELS;
      else if (s.apiMode === "github") ids = window.CONFIG.GITHUB_FALLBACK_MODELS;
      else if (s.apiMode === "openrouter") ids = window.CONFIG.OPENROUTER_FALLBACK_MODELS;
      else if (s.apiMode === "cerebras") ids = window.CONFIG.CEREBRAS_FALLBACK_MODELS;
      else if (s.apiMode === "gemini") ids = window.CONFIG.GEMINI_FALLBACK_MODELS;
      else if (s.apiMode === "mistral") ids = window.CONFIG.MISTRAL_FALLBACK_MODELS;
      else if (s.apiMode === "pollinations") ids = window.CONFIG.POLLINATIONS_FALLBACK_MODELS;
      else ids = window.CONFIG.FALLBACK_MODELS;
    }
    MODEL_CACHE.key = key;
    MODEL_CACHE.data = ids;
    MODEL_CACHE.at = Date.now();
    return ids;
  }

  /* ---------------------- chat streaming ----------------------
   * Async generator yielding text chunks as they arrive.
   * Throws on HTTP errors and on in-stream error events.
   * If Groq key fails and secondary keys exist, tries them. */
  async function* streamChat({ model, messages, temperature, maxTokens, signal }) {
    const s = settings();
    let endpointsToTry = [endpoint()];
    let modelOverrides = [null]; // parallel array for model overrides
    // if groq mode and we have secondary keys, append them as fallbacks
    if (s.apiMode === "groq") {
      const sec = secondaryGroqEndpoints();
      endpointsToTry = endpointsToTry.concat(sec);
      modelOverrides = modelOverrides.concat(sec.map(() => null));
      // Try Cerebras if user has a working key (optional), then Pollinations (no key, always works) as final fallback
      const cerebras = cerebrasFallbackEndpoint();
      if (cerebras) {
        endpointsToTry.push(cerebras);
        modelOverrides.push(mapModelForCerebras(model));
      }
      // Pollinations is free without key - use as last resort when Groq limit hits
      const poll = pollinationsFallbackEndpoint();
      if (poll) {
        endpointsToTry.push(poll);
        modelOverrides.push(mapModelForPollinations(model));
      }
    }

    let lastError = null;
    for (let ei = 0; ei < endpointsToTry.length; ei++) {
      const { base, path, headers } = endpointsToTry[ei];
      const effectiveModel = modelOverrides[ei] || model;
      const payload = {
        model: effectiveModel,
        messages,
        temperature: temperature ?? s.temperature,
        max_tokens: maxTokens ?? s.maxTokens,
        stream: true,
      };
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
          signal,
        });

        if (!res.ok) {
          let msg = `Request failed (${res.status})`;
          let bodyText = "";
          try {
            const j = await res.json();
            bodyText = JSON.stringify(j);
            msg = j.error?.message || j.error || msg;
          } catch {
            try { bodyText = await res.text(); } catch {}
          }
          const isAuthOrLimit = res.status === 401 || res.status === 429 || /expired|invalid.*key|quota|rate limit/i.test(msg + " " + bodyText);
          if (isAuthOrLimit && ei < endpointsToTry.length - 1) {
            lastError = new Error(msg);
            continue; // try next key
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep the last partial line
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") return;
            try {
              const j = JSON.parse(data);
              if (j.error) throw new Error(j.error.message || "Stream error");
              const delta = j.choices?.[0]?.delta || {};
              if (typeof delta.content === "string" && delta.content) yield delta.content;
              if (typeof delta.reasoning_content === "string" && delta.reasoning_content) yield delta.reasoning_content;
            } catch (e) {
              if (e.message && e.message !== "Unexpected end of JSON input") throw e;
            }
          }
        }
        return; // success, exit loop
      } catch (err) {
        if (err.name === "AbortError") throw err;
        lastError = err;
        // if not auth/limit error and we have more endpoints, continue?
        if (ei < endpointsToTry.length - 1) continue;
        throw lastError;
      }
    }
    if (lastError) throw lastError;
  }

  /* -------------------- non-streaming chat ------------------- */
  async function complete({ model, messages, temperature, maxTokens, signal }) {
    let acc = "";
    for await (const chunk of streamChat({ model, messages, temperature, maxTokens, signal })) {
      acc += chunk;
    }
    return acc;
  }

  return { listModels, streamChat, complete, endpoint };
})();
