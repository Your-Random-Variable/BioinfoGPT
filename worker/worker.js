/**
 * ============================================================
 *  BioinfoGPT — Cloudflare Worker proxy
 * ============================================================
 *  Holds your Groq API key server-side so visitors of the
 *  GitHub Pages site never need an API key.
 *
 *  Endpoints
 *    GET  /health   -> { ok: true, service: "bioinfogpt-worker" }
 *    GET  /models   -> Groq chat-model list (cached 1 hour)
 *    POST /chat     -> forwards chat completions (streaming or not)
 *
 *  Deploy (one-time):
 *    cd worker
 *    npx wrangler login
 *    npx wrangler secret put GROQ_API_KEY     # your Groq key
 *    npx wrangler deploy
 *
 *  Optional hardening:
 *    npx wrangler secret put APP_SECRET       # then mirror in js/config.js
 *    edit wrangler.toml for rate-limit values / KV namespace
 * ============================================================ */
const GROQ_BASE = "https://api.groq.com/openai/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Secret",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/* Tiny content guard — blocks obviously abusive prompts before they
 * reach the model. Real moderation still lives on the provider side. */
const DENYLIST = [
  "how to build a bomb",
  "how to make a bomb",
  "explosive device instructions",
  "child sexual abuse material",
  "instructions for producing illicit drugs",
];

/* ------------------------- rate limiting ------------------------- */
const MEM = new Map(); // per-isolate in-memory fallback

async function isRateLimited(env, ip) {
  const perMin = Number(env.RATE_LIMIT_PER_MIN || 20);
  const perDay = Number(env.RATE_LIMIT_PER_DAY || 400);
  const now = Date.now();

  // Prefer KV (global across isolates) when a namespace is bound.
  if (env.RATE_LIMIT_KV) {
    const minKey = `rl:min:${ip}`;
    const dayKey = `rl:day:${ip}`;
    const [minC, dayC] = await Promise.all([
      env.RATE_LIMIT_KV.get(minKey, { type: "json" }),
      env.RATE_LIMIT_KV.get(dayKey, { type: "json" }),
    ]);
    if ((minC?.n || 0) >= perMin || (dayC?.n || 0) >= perDay) return true;
    await Promise.all([
      env.RATE_LIMIT_KV.put(minKey, JSON.stringify({ n: (minC?.n || 0) + 1 }), { expirationTtl: 60 }),
      env.RATE_LIMIT_KV.put(dayKey, JSON.stringify({ n: (dayC?.n || 0) + 1 }), { expirationTtl: 86400 }),
    ]);
    return false;
  }

  // In-memory sliding window (approximate on the free plan).
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const rec = MEM.get(ip) || { min: [], day: 0, dayK: "" };
  if (rec.dayK !== dayKey) { rec.day = 0; rec.dayK = dayKey; }
  rec.min = rec.min.filter((t) => now - t < 60000);
  if (rec.min.length >= perMin || rec.day >= perDay) return true;
  rec.min.push(now);
  rec.day += 1;
  MEM.set(ip, rec);
  return false;
}

/* --------------------------- /models ----------------------------- */
const MODEL_CACHE = { data: null, at: 0 };

async function handleModels(env) {
  if (MODEL_CACHE.data && Date.now() - MODEL_CACHE.at < 3600e3) {
    return json({ data: MODEL_CACHE.data });
  }
  const res = await fetch(`${GROQ_BASE}/models`, {
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const data = await res.json();
  MODEL_CACHE.data = (data.data || [])
    .filter((m) => m.id && !/^(whisper|tts)/.test(m.id))
    .map((m) => m.id)
    .sort();
  MODEL_CACHE.at = Date.now();
  return json({ data: MODEL_CACHE.data });
}

/* ---------------------------- /chat ------------------------------ */
async function handleChat(request, env) {
  if (env.APP_SECRET && request.headers.get("X-App-Secret") !== env.APP_SECRET) {
    return json({ error: "Unauthorized: missing or wrong app secret." }, 401);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await isRateLimited(env, ip)) {
    return json({ error: "Rate limit exceeded. Please wait a minute and try again." }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return json({ error: "model is required." }, 400);
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 40) {
    return json({ error: "messages must be a non-empty array of at most 40 messages." }, 400);
  }

  let totalChars = 0;
  for (const m of body.messages) {
    if (!m || typeof m.content !== "string") {
      return json({ error: "each message needs a string 'content'." }, 400);
    }
    totalChars += m.content.length;
    if (totalChars > 120000) return json({ error: "total input too large." }, 400);
  }
  const joined = JSON.stringify(body.messages).toLowerCase();
  if (DENYLIST.some((w) => joined.includes(w))) {
    return json({ error: "Prompt blocked by the content guard." }, 400);
  }

  const temperature = Math.min(2, Math.max(0, Number(body.temperature) || 0.7));
  const max_tokens = Math.min(8192, Math.max(1, Number(body.max_tokens) || 2048));
  const stream = body.stream !== false;

  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model, messages: body.messages, temperature, max_tokens, stream }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (stream) {
    return new Response(upstream.body, {
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }
  return new Response(upstream.body, { headers: { ...CORS, "Content-Type": "application/json" } });
}

/* --------------------------- router ------------------------------ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      if (url.pathname === "/health") return json({ ok: true, service: "bioinfogpt-worker" });
      if (url.pathname === "/models") return await handleModels(env);
      if (url.pathname === "/chat" && request.method === "POST") return await handleChat(request, env);
      return json({ error: "Not found." }, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error." }, 500);
    }
  },
};
