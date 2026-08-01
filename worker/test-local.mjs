/* Full-stack smoke test:
 *   1. Spin up a fake Groq API server (http://127.0.0.1:5199)
 *   2. Route the worker's fetch() calls to it
 *   3. Import the real worker.js, exercise /health, /models, /chat (stream + non-stream)
 *   4. Run the frontend's api.js SSE parser against the proxy response
 */
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const GROQ_PORT = 5199;
const WORKER_BASE = "http://worker.test";

let logs = [];
const ok = (name) => { logs.push(`  ✓ ${name}`); };
const bad = (name, extra = "") => { logs.push(`  ✗ ${name} ${extra}`); process.exitCode = 1; };

/* ---------- fake Groq server ---------- */
const fakeGroq = http.createServer((req, res) => {
  const url = new URL(req.url, `http://x`);
  if (url.pathname.endsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [
      { id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant" },
      { id: "whisper-large-v3" }, { id: "tts-1" },
    ] }));
  }
  if (url.pathname.endsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
      if (p.model === "boom") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Unknown model 'boom'" } }));
      }
      if (p.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunks = ["Hello ", "from ", "Bioinfo", "GPT!"];
        let i = 0;
        const iv = setInterval(() => {
          if (i < chunks.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`);
          } else {
            res.write("data: [DONE]\n\n");
            clearInterval(iv);
            res.end();
          }
        }, 10);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: crypto.randomUUID(),
          choices: [{ message: { role: "assistant", content: "Non-stream answer: " + p.model } }],
        }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

/* ---------- route fetch to the fake Groq ---------- */
const origFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.groq.com")) {
    const u = new URL(url);
    u.host = `127.0.0.1:${GROQ_PORT}`;
    u.protocol = "http:";
    return origFetch(u.toString(), init);
  }
  // Worker-internal calls to "http://worker.test/..." are handled by the app below
  return null;
};

/* Minimal workers runtime: emulate fetch(Request) returning our router response */
const worker = (await import(pathToFileURL("./worker/worker.js").href)).default;
const env = {
  GROQ_API_KEY: "gsk_test_fake_key",
  RATE_LIMIT_PER_MIN: "20",
  RATE_LIMIT_PER_DAY: "400",
};

async function dispatch(method, path, bodyObj) {
  const req = new Request(WORKER_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  // Patch so worker's internal fetch calls hit the fake Groq:
  return worker.fetch(req, env, {});
}

await new Promise((r) => fakeGroq.listen(GROQ_PORT, r));
try {
  // /health
  let res = await dispatch("GET", "/health");
  const health = await res.json();
  if (health.ok === true) ok("/health"); else bad("/health", JSON.stringify(health));

  // /models filters whisper/tts
  res = await dispatch("GET", "/models");
  const models = await res.json();
  const ids = models.data;
  if (ids.length === 2 && ids.includes("llama-3.3-70b-versatile") && !ids.includes("whisper-large-v3")) ok("/models filtered");
  else bad("/models", JSON.stringify(ids));

  // /chat streaming — parse SSE exactly like the frontend api.js
  res = await dispatch("POST", "/chat", {
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  });
  if (res.status !== 200) { bad("/chat stream status", String(res.status)); }
  else {
    const text = await res.text();
    let acc = "";
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const d = t.slice(5).trim();
      if (d === "[DONE]") continue;
      acc += JSON.parse(d).choices?.[0]?.delta?.content || "";
    }
    if (acc === "Hello from BioinfoGPT!") ok("/chat stream (SSE passthrough)");
    else bad("/chat stream content", JSON.stringify(acc));
  }

  // /chat non-stream
  res = await dispatch("POST", "/chat", { model: "m1", messages: [{ role: "user", content: "q" }], stream: false });
  const nonStream = await res.json();
  if (nonStream.choices?.[0]?.message?.content === "Non-stream answer: m1") ok("/chat non-stream");
  else bad("/chat non-stream", JSON.stringify(nonStream));

  // upstream error passthrough
  res = await dispatch("POST", "/chat", { model: "boom", messages: [{ role: "user", content: "q" }], stream: false });
  if (res.status === 400 && (await res.json()).error?.message.includes("Unknown model")) ok("upstream error passthrough");
  else bad("upstream error", String(res.status));

  // validation: no model
  res = await dispatch("POST", "/chat", { messages: [{ role: "user", content: "q" }] });
  if (res.status === 400) ok("validation: missing model"); else bad("validation missing model", String(res.status));

  // rate limit: bump env to 0 then expect 429
  const strictEnv = { ...env, RATE_LIMIT_PER_MIN: "0" };
  res = await worker.fetch(new Request(WORKER_BASE + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "q" }] }),
  }), strictEnv, {});
  if (res.status === 429) ok("rate limit 429"); else bad("rate limit", String(res.status));

  // content guard
  res = await dispatch("POST", "/chat", { model: "m", messages: [{ role: "user", content: "how to build a bomb" }] });
  if (res.status === 400) ok("content guard blocks"); else bad("content guard", String(res.status));

  // APP_SECRET check
  const secretEnv = { ...env, APP_SECRET: "s3cret" };
  res = await worker.fetch(new Request(WORKER_BASE + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" },
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "q" }] }),
  }), secretEnv, {});
  if (res.status === 401) ok("APP_SECRET missing -> 401"); else bad("APP_SECRET", String(res.status));
  res = await worker.fetch(new Request(WORKER_BASE + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Secret": "s3cret", "CF-Connecting-IP": "203.0.113.8" },
    body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "q" }] }),
  }), secretEnv, {});
  if (res.status !== 401) ok("APP_SECRET correct -> passes"); else bad("APP_SECRET correct", String(res.status));

  // CORS preflight
  res = await worker.fetch(new Request(WORKER_BASE + "/chat", { method: "OPTIONS" }), env, {});
  if (res.status === 204 && res.headers.get("Access-Control-Allow-Origin") === "*") ok("CORS preflight");
  else bad("CORS", String(res.status));
} finally {
  fakeGroq.close();
}

console.log(logs.join("\n"));
console.log("\nWorker smoke test done.");
