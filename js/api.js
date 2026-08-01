/* ============================================================
 *  BioinfoGPT — API layer
 *  Three modes, all speaking the OpenAI-compatible chat
 *  completions API (incl. SSE streaming):
 *    1. "proxy" — your Cloudflare Worker (visitors need no key)
 *    2. "byok"  — Groq directly, visitor's own key
 *    3. "local" — Ollama / LM Studio on your machine or LAN
 *                 (http://localhost:11434/v1), fully offline
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

    // "groq" — direct to Groq with the built-in key (no visitor setup),
    //          unless the user pasted their own key to override.
    if (s.apiMode === "groq") {
      const key = s.groqKey || window.CONFIG.DEFAULT_GROQ_KEY || "";
      if (!key) {
        throw new Error("No Groq key configured. Add one in Settings or set DEFAULT_GROQ_KEY in js/config.js.");
      }
      return { base: GROQ_ENDPOINT, path: "/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    }

    // "byok" — the user explicitly wants THEIR key (no built-in fallback).
    if (s.apiMode === "byok") {
      if (!s.groqKey) throw new Error("Add your Groq API key in Settings.");
      return { base: GROQ_ENDPOINT, path: "/chat/completions", headers: { Authorization: `Bearer ${s.groqKey}` } };
    }

    if (s.apiMode === "proxy") {
      const base = (s.proxyUrl || window.CONFIG.PROXY_URL || "").trim().replace(/\/+$/, "");
      if (!base || base.includes("YOUR-SUBDOMAIN")) {
        throw new Error("Proxy URL not set. Deploy the Worker (see README) and set PROXY_URL in js/config.js, or switch to Groq (built-in key) in Settings.");
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

  /* ------------------------- models ------------------------- */
  async function listModels() {
    const s = settings();
    const key = `${s.apiMode}:${s.apiMode === "proxy" ? (s.proxyUrl || window.CONFIG.PROXY_URL) : (s.apiMode === "local" ? (s.localBaseUrl || window.CONFIG.LOCAL_BASE_URL) : "groq")}`;
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
      ids = s.apiMode === "local" ? window.CONFIG.LOCAL_FALLBACK_MODELS : window.CONFIG.FALLBACK_MODELS;
    }
    MODEL_CACHE.key = key;
    MODEL_CACHE.data = ids;
    MODEL_CACHE.at = Date.now();
    return ids;
  }

  /* ---------------------- chat streaming ----------------------
   * Async generator yielding text chunks as they arrive.
   * Throws on HTTP errors and on in-stream error events. */
  async function* streamChat({ model, messages, temperature, maxTokens, signal }) {
    const s = settings();
    const { base, path, headers } = endpoint();
    const payload = {
      model,
      messages,
      temperature: temperature ?? s.temperature,
      max_tokens: maxTokens ?? s.maxTokens,
      stream: true,
    };

    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        msg = j.error?.message || j.error || msg;
      } catch { /* body wasn't JSON */ }
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
          // content + reasoning_content (e.g. DeepSeek R1) both count
          if (typeof delta.content === "string" && delta.content) yield delta.content;
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) yield delta.reasoning_content;
        } catch (e) {
          if (e.message && e.message !== "Unexpected end of JSON input") throw e;
        }
      }
    }
  }

  /* -------------------- non-streaming chat ------------------- */
  async function complete({ model, messages, temperature, maxTokens, signal }) {
    let acc = "";
    for await (const chunk of streamChat({ model, messages, temperature, maxTokens, signal })) {
      acc += chunk;
    }
    return acc;
  }

  return { listModels, streamChat, complete };
})();
