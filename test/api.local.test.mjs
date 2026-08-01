/* BioinfoGPT — test for the "local model" API path (Ollama/LM Studio).
 * Spins up a fake OpenAI-compatible server, then exercises js/api.js
 * in local mode (models + SSE streaming). No dependencies (Node >= 18).
 * Run:  node test/api.local.test.mjs
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = 5203;
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const bad = (n, e = "") => { fail++; console.log("  ✗ " + n + (e ? " — " + e : "")); };

/* ---------- fake local server (behaves like Ollama /v1) ---------- */
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.endsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [
      { id: "llama3.1", object: "model" },
      { id: "qwen2.5-coder:7b", object: "model" },
    ] }));
  }
  if (url.pathname.endsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
      // require auth header if server expects it (localKey path)
      if (req.headers.authorization !== "Bearer localkey123") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "missing auth" } }));
      }
      if (p.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const parts = ["Local ", "LLM ", "answer ", "42"];
        let i = 0;
        const iv = setInterval(() => {
          if (i < parts.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
          } else {
            res.write("data: [DONE]\n\n");
            clearInterval(iv);
            res.end();
          }
        }, 8);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((r) => fake.listen(PORT, r));

/* ---------- load api.js in a Node shim ---------- */
globalThis.window = globalThis;
window.CONFIG = {
  PROXY_URL: "https://x.workers.dev",
  APP_SECRET: "",
  LOCAL_BASE_URL: `http://127.0.0.1:${PORT}/v1`,
  LOCAL_FALLBACK_MODELS: ["llama3.1"],
  FALLBACK_MODELS: ["llama-3.3-70b-versatile"],
  DEFAULT_MODEL: "llama3.1",
};
const baseSettings = {
  apiMode: "local",
  localBaseUrl: `http://127.0.0.1:${PORT}/v1`,
  localKey: "localkey123",
  groqKey: "",
  proxyUrl: "",
  temperature: 0.7,
  maxTokens: 2048,
};
window.Settings = { get: () => ({ ...baseSettings }) };
eval(readFileSync(fileURLToPath(new URL("../js/api.js", import.meta.url)), "utf8"));

/* ---------- tests ---------- */
try {
  const models = await window.API.listModels();
  if (models.length === 2 && models.includes("llama3.1") && models.includes("qwen2.5-coder:7b"))
    ok("local /models lists Ollama models");
  else bad("local /models", JSON.stringify(models));
} catch (e) { bad("local /models threw", e.message); }

try {
  let acc = "";
  for await (const chunk of window.API.streamChat({
    model: "llama3.1",
    messages: [{ role: "user", content: "hi" }],
    signal: new AbortController().signal,
  })) acc += chunk;
  if (acc === "Local LLM answer 42") ok("local SSE streaming accumulates text");
  else bad("local streaming", JSON.stringify(acc));
} catch (e) { bad("local streaming threw", e.message); }

// auth missing -> should throw a clear error
try {
  baseSettings.localKey = "wrong-key";
  let acc = "";
  for await (const c of window.API.streamChat({ model: "llama3.1", messages: [{ role: "user", content: "hi" }] })) acc += c;
  bad("local auth error surfaced", "no error thrown");
} catch (e) {
  ok("local auth error surfaced: " + e.message.slice(0, 40));
}

// wrong local URL -> graceful fallback list + clear stream error
baseSettings.localBaseUrl = "http://127.0.0.1:1/v1";
baseSettings.localKey = "";
try {
  const m = await window.API.listModels();
  if (Array.isArray(m) && m.length) ok("local unreachable -> fallback model list");
  else bad("fallback list", JSON.stringify(m));
} catch (e) { bad("fallback list threw", e.message); }

fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
