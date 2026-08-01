/* BioinfoGPT — test for the "groq" (built-in key) and "byok" (own key) modes.
 * Spins up a fake Groq server, then exercises js/api.js in both modes:
 *  - groq: uses CONFIG.DEFAULT_GROQ_KEY when the user has no key
 *  - groq: uses the user's key when provided (override)
 *  - byok: requires the user's key
 * No dependencies (Node >= 18). Run:  node test/api.groq.test.mjs
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = 5204;
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const bad = (n, e = "") => { fail++; console.log("  ✗ " + n + (e ? " — " + e : "")); };

const BUILTIN = "gsk_builtin_test_key";
const MINE = "gsk_my_own_test_key";

/* ---------- fake Groq server that records the auth header ---------- */
let seenAuth = null;
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.endsWith("/v1/models")) {
    seenAuth = req.headers.authorization;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }] }));
  }
  if (url.pathname.endsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
      seenAuth = req.headers.authorization;
      if (p.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Groq " + p.model } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
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

/* ---------- load api.js with a routing fetch ---------- */
const baseSettings = {
  apiMode: "groq",
  proxyUrl: "",
  groqKey: "",
  localBaseUrl: "http://127.0.0.1:1/v1",
  localKey: "",
  temperature: 0.7,
  maxTokens: 2048,
};
globalThis.window = globalThis;
window.CONFIG = {
  PROXY_URL: "",
  APP_SECRET: "",
  DEFAULT_GROQ_KEY: BUILTIN,
  LOCAL_BASE_URL: "http://127.0.0.1:1/v1",
  FALLBACK_MODELS: ["llama-3.3-70b-versatile"],
  LOCAL_FALLBACK_MODELS: ["llama3.1"],
  DEFAULT_MODEL: "llama-3.3-70b-versatile",
};
window.Settings = { get: () => ({ ...baseSettings }) };

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.groq.com")) {
    const u = new URL(url);
    u.host = `127.0.0.1:${PORT}`;
    u.protocol = "http:";
    return origFetch(u.toString(), init);
  }
  return origFetch(input, init);
};
eval(readFileSync(fileURLToPath(new URL("../js/api.js", import.meta.url)), "utf8"));

/* ---------- tests ---------- */
// 1) groq mode + no personal key -> built-in key used
try {
  baseSettings.apiMode = "groq"; baseSettings.groqKey = "";
  const models = await window.API.listModels();
  if (models.length === 1 && seenAuth === `Bearer ${BUILTIN}`) ok("groq mode uses built-in key for /models");
  else bad("groq /models", JSON.stringify({ models, auth: seenAuth }));
} catch (e) { bad("groq /models threw", e.message); }

try {
  let acc = "";
  for await (const c of window.API.streamChat({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) acc += c;
  if (acc === "Groq llama-3.3-70b-versatile" && seenAuth === `Bearer ${BUILTIN}`) ok("groq mode streams with built-in key");
  else bad("groq streaming", JSON.stringify({ acc, auth: seenAuth }));
} catch (e) { bad("groq streaming threw", e.message); }

// 2) groq mode + personal key -> own key overrides built-in
try {
  baseSettings.groqKey = MINE;
  let acc = "";
  for await (const c of window.API.streamChat({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) acc += c;
  if (seenAuth === `Bearer ${MINE}`) ok("groq mode uses personal key when set (override)");
  else bad("groq override", JSON.stringify({ auth: seenAuth }));
} catch (e) { bad("groq override threw", e.message); }

// 3) byok mode requires the user's key (built-in must NOT be used)
try {
  baseSettings.apiMode = "byok"; baseSettings.groqKey = "";
  let acc = "";
  for await (const c of window.API.streamChat({ model: "x", messages: [{ role: "user", content: "hi" }] })) acc += c;
  bad("byok requires own key", "no error thrown");
} catch (e) {
  if (e.message.includes("Add your Groq API key")) ok("byok requires own key (built-in not leaked)");
  else bad("byok error message", e.message);
}

// 4) byok mode with a key -> that key used
try {
  baseSettings.groqKey = MINE;
  let acc = "";
  for await (const c of window.API.streamChat({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) acc += c;
  if (seenAuth === `Bearer ${MINE}`) ok("byok uses the user's key");
  else bad("byok key", JSON.stringify({ auth: seenAuth }));
} catch (e) { bad("byok threw", e.message); }

fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
