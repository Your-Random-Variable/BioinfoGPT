/* ============================================================
 *  BioinfoGPT — main application
 *  Chat UI, streaming, settings, history, sequence tools.
 * ============================================================ */
(() => {
  "use strict";

  const { $, $$, el, uid, debounce, timeAgo, download, toast } = window.Utils;
  const BIO = window.BIO;
  const CONFIG = window.CONFIG;

  /* ============================ Settings ============================ */
  const DEFAULT_SETTINGS = {
    apiMode: "groq",             // "groq" (built-in key) | "byok" | "proxy" | "local"
    proxyUrl: CONFIG.PROXY_URL,
    groqKey: "",
    localBaseUrl: CONFIG.LOCAL_BASE_URL,
    localKey: "",
    model: CONFIG.DEFAULT_MODEL,
    customModel: "",
    temperature: CONFIG.DEFAULT_TEMPERATURE,
    maxTokens: CONFIG.DEFAULT_MAX_TOKENS,
    streaming: true,
    smartDefaults: true,
    systemPrompt: CONFIG.DEFAULT_SYSTEM_PROMPT,
  };

  const Settings = {
    get() {
      try {
        const raw = localStorage.getItem("bioinfogpt_settings_v1");
        return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
      } catch { return { ...DEFAULT_SETTINGS }; }
    },
    set(partial) {
      const next = { ...this.get(), ...partial };
      try { localStorage.setItem("bioinfogpt_settings_v1", JSON.stringify(next)); } catch {}
      window.dispatchEvent(new CustomEvent("settingschange", { detail: next }));
      return next;
    },
  };
  window.Settings = Settings;

  /* ====================== Conversations / history =================== */
  const HISTORY_KEY = "bioinfogpt_convos_v1";
  const ACTIVE_KEY = "bioinfogpt_active_v1";
  const MAX_HISTORY = 30;

  const Store = {
    all() {
      try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
    },
    save(list) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch {}
    },
    active() { return localStorage.getItem(ACTIVE_KEY) || null; },
    setActive(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch {} },
  };

  let state = {
    convos: Store.all(),
    activeId: Store.active(),
    chat: null,          // { id, title, ts, model, messages: [] }
    streaming: false,
    abort: null,
    models: [],
    query: "",           // sidebar search filter
  };

  /* =========================== UI prefs ============================= */
  const UI_KEY = "bioinfogpt_ui_v1";
  const UI = {
    get() {
      try { return { theme: "dark", sidebar: true, ...(JSON.parse(localStorage.getItem(UI_KEY)) || {}) }; }
      catch { return { theme: "dark", sidebar: true }; }
    },
    set(partial) {
      const next = { ...this.get(), ...partial };
      try { localStorage.setItem(UI_KEY, JSON.stringify(next)); } catch {}
      return next;
    },
  };

  const isNarrow = () =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 900px)").matches
      : window.innerWidth <= 900;

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7fb" : "#080b16");
  }

  function setSidebar(open, persist = true) {
    const bar = $("#sidebar");
    const scrim = $("#scrim");
    bar.classList.toggle("collapsed", !open);
    $("#menuBtn").setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !(open && isNarrow());
    if (persist) UI.set({ sidebar: open });
  }
  function sidebarOpen() { return !$("#sidebar").classList.contains("collapsed"); }
  function toggleSidebar() { setSidebar(!sidebarOpen()); }

  /* ======================== Smart defaults ========================== */
  const SMART_DEFAULTS_SYSTEM = {
    role: "system",
    content:
      "Preferences for this chat (bioinformatics smart defaults): use Python/Biopython and R/Bioconductor " +
      "unless the user asks otherwise; provide runnable, well-commented code; when the user pastes a sequence, " +
      "FASTA/FASTQ snippet or a table, propose concrete next analysis steps; be honest about limits (you cannot " +
      "access NCBI or the internet); structure long answers with headings or bullet lists.",
  };

  function buildMessages() {
    const s = Settings.get();
    const msgs = [{ role: "system", content: s.systemPrompt || CONFIG.DEFAULT_SYSTEM_PROMPT }];
    if (s.smartDefaults) msgs.push(SMART_DEFAULTS_SYSTEM);
    for (const m of state.chat.messages) msgs.push({ role: m.role, content: m.content });
    return msgs;
  }

  /* ========================== Markdown render ======================= */
  function renderMarkdown(md) {
    const raw = marked.parse(md || "");
    return DOMPurify.sanitize(raw);
  }

  function enhanceCode(host) {
    $$("pre", host).forEach((pre) => {
      if (pre.dataset.enhanced) return;
      pre.dataset.enhanced = "1";
      const code = $("code", pre);
      if (code && window.hljs) hljs.highlightElement(code);
      const btn = el("button", "code-copy", "⧉");
      btn.type = "button";
      btn.title = "Copy code";
      btn.addEventListener("click", () => {
        const text = (code ? code.textContent : pre.textContent) || "";
        navigator.clipboard?.writeText(text).then(
          () => { btn.textContent = "✓"; setTimeout(() => (btn.textContent = "⧉"), 1400); },
          () => toast("Copy failed — select manually.", "error")
        );
      });
      pre.appendChild(btn);
    });
    // Make links open safely
    $$("a", host).forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  }

  /* ============================ Rendering =========================== */
  const chatEl = () => $("#chat");
  const welcomeEl = () => $("#welcome");

  function ensureChat() {
    if (state.chat) return state.chat;
    const id = uid();
    state.chat = { id, title: "New chat", ts: Date.now(), model: Settings.get().model, messages: [] };
    state.activeId = id;
    Store.setActive(id);
    return state.chat;
  }

  function renderAll() {
    renderWelcome();
    renderMessages();
    renderSidebar();
    renderModelSelect();
    renderComposerStatus();
  }

  function renderWelcome() {
    const empty = !state.chat || state.chat.messages.length === 0;
    welcomeEl().classList.toggle("hidden", !empty);
    chatEl().classList.toggle("hidden", empty);
    const t = $("#chatTitle");
    if (t) t.textContent = empty ? "New chat" : (state.chat.title || "New chat");
  }

  function icon(id, size = 14) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function iconButton(cls, iconId, label) {
    const b = el("button", cls);
    b.type = "button";
    b.appendChild(icon(iconId, 13));
    b.appendChild(document.createTextNode(" " + label));
    return b;
  }

  function msgNode(m) {
    const wrap = el("article", `msg msg-${m.role}`);
    wrap.dataset.id = m.id || "";

    const avatar = el("div", "avatar", m.role === "user" ? "\u{1F464}" : "\u{1F9EC}");
    const col = el("div", "bubble-wrap");
    const bubble = el("div", "bubble");

    const meta = el("div", "msg-meta");
    meta.appendChild(el("span", "msg-role", m.role === "user" ? "You" : "BioinfoGPT"));
    if (m.role === "assistant") {
      meta.appendChild(el("span", "msg-model", m.model || state.chat?.model || ""));
    }
    meta.appendChild(el("time", "", timeAgo(m.ts || Date.now())));

    const content = el("div", "msg-content");
    if (m.content) {
      content.innerHTML = renderMarkdown(m.content);
      enhanceCode(content);
    } else if (m.role === "assistant") {
      content.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }
    bubble.appendChild(content);

    const actions = el("div", "msg-actions");
    const copyBtn = iconButton("btn-ghost", "icoCopy", "Copy");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(m.content); toast("Copied to clipboard"); }
      catch { toast("Copy failed", "error"); }
    });
    actions.appendChild(copyBtn);

    if (m.role === "assistant" && !state.streaming) {
      const regen = iconButton("btn-ghost", "icoRefresh", "Retry");
      regen.addEventListener("click", () => regenerate(m.id));
      actions.appendChild(regen);
    }

    col.appendChild(meta);
    col.appendChild(bubble);
    col.appendChild(actions);
    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  function renderMessages() {
    const chat = chatEl();
    chat.innerHTML = "";
    if (!state.chat) return;
    for (const m of state.chat.messages) chat.appendChild(msgNode(m));
    scrollBottom(true);
  }

  function scrollBottom(force = false) {
    const chat = chatEl();
    const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 160;
    if (force || nearBottom) chat.scrollTop = chat.scrollHeight;
  }

  function renderSidebar() {
    const list = $("#convos");
    list.innerHTML = "";
    const q = state.query.trim().toLowerCase();
    const items = q
      ? state.convos.filter((c) => (c.title || "").toLowerCase().includes(q))
      : state.convos;

    items.forEach((c) => {
      const item = el("div", "convo-item" + (c.id === state.activeId ? " active" : ""));
      item.setAttribute("role", "listitem");
      item.tabIndex = 0;
      item.appendChild(el("span", "convo-title", c.title || "New chat"));
      item.appendChild(el("span", "convo-time", timeAgo(c.ts)));

      const del = el("button", "convo-del");
      del.type = "button";
      del.title = "Delete conversation";
      del.setAttribute("aria-label", "Delete conversation");
      del.appendChild(icon("icoTrash", 14));
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteConversation(c.id); });
      item.appendChild(del);

      const open = () => { openConversation(c.id); if (isNarrow()) setSidebar(false); };
      item.addEventListener("click", open);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      list.appendChild(item);
    });

    const emptyEl = $("#sideEmpty");
    if (emptyEl) {
      emptyEl.classList.toggle("hidden", items.length > 0);
      emptyEl.textContent = state.convos.length === 0
        ? "No conversations yet"
        : "No chats match your search";
    }
  }

  function renderModelSelect() {
    const sel = $("#modelSelect");
    if (!sel) return;
    const st = Settings.get();
    const current = st.model;

    // Curated list only. For hosted modes we deliberately do NOT dump the whole
    // live Groq catalog into the picker — llama-3.3-70b-versatile is the default
    // and works well. Power users can still set any model ID in Settings.
    let options;
    if (st.apiMode === "local") {
      options = state.models.length ? state.models : CONFIG.LOCAL_FALLBACK_MODELS;
    } else {
      options = CONFIG.MODELS.map((m) => m.id);
    }
    options = [...options, current].filter(Boolean);

    const labels = new Map(CONFIG.MODELS.map((m) => [m.id, m.label]));
    const used = new Set();
    sel.innerHTML = "";
    for (const id of options) {
      if (used.has(id)) continue;
      used.add(id);
      const opt = el("option", "", labels.get(id) || id);
      opt.value = id;
      sel.appendChild(opt);
    }
    sel.value = current;
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;

    // Custom model overrides the picker — show that clearly.
    const custom = !!st.customModel;
    sel.disabled = custom;
    sel.title = custom ? `Overridden by custom model: ${st.customModel}` : "Model";
  }

  function renderComposerStatus() {
    const s = Settings.get();
    let provider = "Groq", mode;
    if (s.apiMode === "proxy") { provider = "Proxy"; mode = "key server-side"; }
    else if (s.apiMode === "local") { provider = "Local"; mode = "offline"; }
    else if (s.apiMode === "byok") { mode = "your key"; }
    else { mode = s.groqKey ? "your key" : "built-in key"; }
    const node = $("#composerStatus");
    if (node) node.textContent = `${provider} · ${mode} · temp ${Number(s.temperature).toFixed(2)}`;
    renderModelSelect();
  }

  function modelInUse() {
    const s = Settings.get();
    return s.customModel || s.model || CONFIG.DEFAULT_MODEL;
  }

  /* ============================= Chat ============================== */
  function setStreaming(on) {
    state.streaming = on;
    $("#sendBtn").classList.toggle("hidden", on);
    $("#stopBtn").classList.toggle("hidden", !on);
    $("#composer textarea").disabled = on;
    if (!on) $("#composer textarea").focus();
  }

  async function send(text) {
    if (state.streaming) return;
    const s = Settings.get();
    const content = (text ?? $("#composer textarea").value).trim();
    if (!content) return;

    const chat = ensureChat();
    chat.messages.push({ id: uid(), role: "user", content, ts: Date.now() });
    if (chat.messages.filter((m) => m.role === "user").length === 1) {
      chat.title = content.slice(0, 48) + (content.length > 48 ? "…" : "");
    }
    persistChat();
    renderWelcome();
    renderMessages();
    renderSidebar();
    $("#composer textarea").value = "";
    autoGrow();

    const assistantId = uid();
    const placeholder = { id: assistantId, role: "assistant", content: "", model: modelInUse(), ts: Date.now() };
    chat.messages.push(placeholder);
    renderMessages();

    setStreaming(true);
    state.abort = new AbortController();

    const msgs = buildMessages();
    let acc = "";
    let renderQueued = false;
    const paint = () => {
      renderQueued = false;
      const node = chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`);
      if (node) {
        node.innerHTML = renderMarkdown(acc);
        enhanceCode(node);
      }
      scrollBottom();
    };

    try {
      for await (const chunk of window.API.streamChat({
        model: modelInUse(),
        messages: msgs,
        temperature: s.temperature,
        maxTokens: s.maxTokens,
        signal: state.abort.signal,
      })) {
        acc += chunk;
        placeholder.content = acc;
        if (!renderQueued) {
          renderQueued = true;
          requestAnimationFrame(paint);
        }
      }
      placeholder.content = acc;
      paint();
    } catch (err) {
      if (err.name === "AbortError") {
        placeholder.content = acc || "(stopped)";
      } else {
        chat.messages = chat.messages.filter((m) => m.id !== assistantId);
        renderMessages();
        let hint = "";
        if (s.apiMode === "proxy") {
          hint = " Make sure the Worker is deployed and PROXY_URL is set in js/config.js (or switch to Local model / Bring-your-own-key in Settings).";
        } else if (s.apiMode === "local") {
          hint = " Make sure Ollama/LM Studio is running and reachable (check the base URL in Settings; set OLLAMA_ORIGINS=* if the site is not on localhost).";
        } else if (s.apiMode === "byok") {
          hint = " Check your Groq API key in Settings.";
        } else {
          hint = s.groqKey
            ? " Check your Groq API key in Settings."
            : " The built-in Groq key is invalid or rate-limited — add your own key in Settings, or check console.groq.com for the key's status.";
        }
        toast(`Error: ${err.message}${hint}`, "error", 6000);
      }
    } finally {
      placeholder.content = placeholder.content || "";
      const node = chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`);
      if (node) { node.innerHTML = renderMarkdown(placeholder.content); enhanceCode(node); }
      setStreaming(false);
      persistChat();
      renderSidebar();
      scrollBottom(true);
    }
  }

  function stop() { state.abort?.abort(); }

  function regenerate(id) {
    const chat = state.chat;
    if (!chat || state.streaming) return;
    const idx = chat.messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    chat.messages = chat.messages.slice(0, idx);
    persistChat();
    renderMessages();
    sendFromHistory();
    function sendFromHistory() {
      const last = chat.messages[chat.messages.length - 1];
      if (last && last.role === "user") {
        const t = last.content;
        chat.messages.pop();
        renderMessages();
        send(t);
      }
    }
  }

  function persistChat() {
    if (!state.chat) return;
    const others = state.convos.filter((c) => c.id !== state.chat.id);
    state.convos = [state.chat, ...others].slice(0, MAX_HISTORY);
    Store.save(state.convos);
  }

  function newChat() {
    if (state.streaming) stop();
    state.chat = null;
    ensureChat();
    persistChat();
    renderAll();
    $("#composer textarea").focus();
  }

  function openConversation(id) {
    if (state.streaming) stop();
    const c = state.convos.find((x) => x.id === id);
    if (!c) return;
    state.chat = c;
    state.activeId = id;
    Store.setActive(id);
    renderAll();
  }

  function deleteConversation(id) {
    state.convos = state.convos.filter((c) => c.id !== id);
    Store.save(state.convos);
    if (state.activeId === id) {
      state.chat = null;
      ensureChat();
      persistChat();
    }
    renderAll();
  }

  function exportChat() {
    if (!state.chat || !state.chat.messages.length) { toast("Nothing to export yet"); return; }
    const lines = [`# ${state.chat.title}`, "", `_Exported ${new Date().toLocaleString()} · model ${state.chat.model}_`, ""];
    for (const m of state.chat.messages) {
      lines.push(`## ${m.role === "user" ? "User" : "BioinfoGPT"}`, "", m.content, "");
    }
    download(`${(state.chat.title || "chat").replace(/[^\w\-]+/g, "_").toLowerCase()}.md`, lines.join("\n"));
    toast("Chat exported as Markdown");
  }

  /* ======================== Sequence tools ========================= */
  const tools = {
    init() {
      const ta = $("#seqInput");
      ta.addEventListener("input", debounce(() => this.update(), 250));
      $("#btnAnalyze").addEventListener("click", () => this.sendToChat());
      $("#btnRC").addEventListener("click", () => this.apply((s) => BIO.reverseComplement(s)));
      $("#btnRev").addEventListener("click", () => this.apply((s) => BIO.reverse(s)));
      $("#btnTranslate").addEventListener("click", () => this.translate());
      $("#btnRandDNA").addEventListener("click", () => this.random("DNA"));
      $("#btnRandRNA").addEventListener("click", () => this.random("RNA"));
      $("#btnRandProt").addEventListener("click", () => this.random("protein"));
      $("#btnCodonTable").addEventListener("click", () => this.codonTable());
      $("#seqLen").addEventListener("input", () => {});
    },
    seq() { return $("#seqInput").value.trim(); },
    update() {
      const s = this.seq();
      const out = $("#seqResults");
      if (!s) { out.innerHTML = '<div class="hint">Paste or type a sequence above. Whitespace, digits and hyphens are ignored.</div>'; return; }
      const check = BIO.checkAlphabet(s);
      const st = BIO.stats(s);
      const c = st.counts;
      const html = [];
      html.push(`<div class="chip chip-${check.valid ? "ok" : "warn"}">Detected: <b>${check.type}</b> ${check.valid ? "· valid alphabet" : ""}</div>`);
      if (!check.valid) {
        const bad = check.invalid.slice(0, 12).map((x) => `'${x.ch}'@${x.pos}`).join(", ");
        html.push(`<div class="warnline">⚠ Invalid residue(s): ${bad}${check.invalid.length > 12 ? ` (+${check.invalid.length - 12} more)` : ""}</div>`);
      }
      const grid = [
        ["Length", st.length.toLocaleString()],
        ["GC content", `${st.gc.toFixed(2)}%`],
        ["AT content", `${st.at.toFixed(2)}%`],
        ["Mol. weight", `${st.mw.toFixed(0)} Da`],
        ["Tm (approx)", st.tm ? `${st.tm.toFixed(1)} °C` : "—"],
        ["Purines / Pyrimidines", `${st.purines} / ${st.pyrimidines}`],
      ];
      html.push('<div class="stat-grid">');
      grid.forEach(([k, v]) => html.push(`<div class="stat"><span>${k}</span><b>${v}</b></div>`));
      html.push("</div>");
      const counts = ["A", "T", "U", "G", "C", "N"].filter((b) => c[b]);
      html.push(`<div class="counts">${counts.map((b) => `<span class="base base-${b}">${b} <b>${c[b]}</b></span>`).join("")}</div>`);
      if (st.length > 150) {
        const win = BIO.gcWindow(s, 100, 50);
        const avg = win.reduce((a, w) => a + w.gc, 0) / Math.max(1, win.length);
        html.push(`<div class="hint">Sliding-window GC (100 bp, step 50): mean ${avg.toFixed(1)}% across ${win.length} windows</div>`);
      }
      out.innerHTML = html.join("");
    },
    apply(fn) {
      const s = this.seq();
      if (!s) { toast("Enter a sequence first", "error"); return; }
      $("#seqResultText").textContent = fn(s);
      $("#seqResultWrap").classList.remove("hidden");
      $("#seqInput").value = fn(s);
      this.update();
    },
    translate() {
      const s = this.seq();
      if (!s) { toast("Enter a sequence first", "error"); return; }
      const frame = Number($("#frameSel").value);
      const t = BIO.translate(s, frame);
      $("#seqResultText").textContent = `${t.sequence}\n\nCodons (frame ${t.frame}): ${t.codons.join(" ")}\nStop codons: ${t.stopCount}`;
      $("#seqResultWrap").classList.remove("hidden");
    },
    random(kind) {
      const n = Math.min(5000, Math.max(1, Number($("#seqLen").value) || 100));
      $("#seqInput").value = kind === "DNA" ? BIO.randomDNA(n) : kind === "RNA" ? BIO.randomRNA(n) : BIO.randomProtein(n);
      this.update();
    },
    codonTable() {
      const table = BIO.CODON_TABLE;
      const rows = [];
      const bases = ["T", "C", "A", "G"];
      for (let i = 0; i < 4; i++) {
        const row = [];
        for (let j = 0; j < 4; j++) {
          const codons = [];
          for (let k = 0; k < 4; k++) {
            const codon = bases[i] + bases[j] + bases[k];
            codons.push(`<span class="codon">${codon} <b>${table[codon]}</b></span>`);
          }
          row.push(`<td>${codons.join(" ")}</td>`);
        }
        rows.push(`<tr>${row.join("")}</tr>`);
      }
      const modal = $("#codonModal");
      $("#codonBody").innerHTML = `<table class="codon-table"><thead><tr><th>First↓ / Second→</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
      modal.classList.add("open");
    },
    sendToChat() {
      const s = this.seq();
      if (!s) { toast("Enter a sequence first", "error"); return; }
      const check = BIO.checkAlphabet(s);
      const st = BIO.stats(s);
      const content = `Analyze the following ${check.type} sequence (length ${st.length.toLocaleString()}, GC ${st.gc.toFixed(1)}%) and give a concise bioinformatics analysis, including a short code snippet if useful:\n\n\`\`\`\n${s.slice(0, 4000)}${s.length > 4000 ? "\n… (truncated)" : ""}\n\`\`\``;
      closeTools();
      send(content);
    },
  };

  function openTools() {
    $("#toolsPanel").classList.add("open");
    if (isNarrow()) setSidebar(false);
    tools.update();
  }
  function closeTools() { $("#toolsPanel").classList.remove("open"); }
  function toolsOpen() { return $("#toolsPanel").classList.contains("open"); }

  /* ========================= Settings modal ======================== */
  function openSettings() {
    const s = Settings.get();
    $("#setApiMode").value = s.apiMode;
    $("#setProxyUrl").value = s.proxyUrl;
    $("#setGroqKey").value = s.groqKey;
    $("#setLocalUrl").value = s.localBaseUrl;
    $("#setLocalKey").value = s.localKey;
    $("#setTemp").value = s.temperature;
    $("#tempVal").textContent = s.temperature.toFixed(2);
    $("#setMaxTokens").value = s.maxTokens;
    $("#setStreaming").checked = s.streaming;
    $("#setSmart").checked = s.smartDefaults;
    $("#setCustomModel").value = s.customModel;
    $("#setSystem").value = s.systemPrompt;
    syncSettingsUI(s);
    $("#settingsModal").classList.add("open");
  }
  function closeSettings() { $("#settingsModal").classList.remove("open"); }

  function syncSettingsUI(s) {
    const mode = s.apiMode;
    $("#groqKeyRow").style.display = mode === "groq" || mode === "byok" ? "" : "none";
    $("#proxyRow").style.display = mode === "proxy" ? "" : "none";
    $("#localRow").style.display = mode === "local" ? "" : "none";
    $("#localKeyRow").style.display = mode === "local" ? "" : "none";
  }

  function saveSettings() {
    const next = Settings.set({
      apiMode: $("#setApiMode").value,
      proxyUrl: $("#setProxyUrl").value.trim(),
      groqKey: $("#setGroqKey").value.trim(),
      localBaseUrl: $("#setLocalUrl").value.trim(),
      localKey: $("#setLocalKey").value.trim(),
      temperature: Number($("#setTemp").value),
      maxTokens: Math.min(8192, Math.max(256, Number($("#setMaxTokens").value) || 4096)),
      streaming: $("#setStreaming").checked,
      smartDefaults: $("#setSmart").checked,
      customModel: $("#setCustomModel").value.trim(),
      systemPrompt: $("#setSystem").value,
    });
    syncSettingsUI(next);
    renderModelSelect();
    renderComposerStatus();
    toast("Settings saved");
    closeSettings();
    // refresh the local model list only when local mode is selected
    if (next.apiMode === "local") {
      window.API.listModels().then((ids) => { state.models = ids; renderModelSelect(); }).catch(() => {});
    } else {
      state.models = [];
      renderModelSelect();
    }
    // update active chat model label
    if (state.chat) { state.chat.model = modelInUse(); persistChat(); renderMessages(); }
  }

  function resetSettings() {
    if (!confirm("Reset all settings to defaults?")) return;
    localStorage.removeItem("bioinfogpt_settings_v1");
    state.models = [];
    toast("Settings reset to defaults");
    closeSettings();
    renderComposerStatus();
  }

  /* ======================== Suggestions chips ====================== */
  const SUGGESTIONS = [
    "Explain FASTQ vs FASTA and write Python to convert one to the other",
    "Biopython script to translate a DNA sequence and find ORFs",
    "DESeq2 vs edgeR: when should I use each?",
    "Write Python to compute GC content and reverse complement",
    "How do I run a BLAST search programmatically?",
    "What is multiple-testing correction (BH-FDR) and when to apply it?",
  ];

  function renderSuggestions() {
    const wrap = $("#suggestions");
    wrap.innerHTML = "";
    SUGGESTIONS.forEach((t) => {
      const btn = el("button", "chip-suggestion", t);
      btn.type = "button";
      btn.addEventListener("click", () => send(t));
      wrap.appendChild(btn);
    });
  }

  /* ========================== Composer ============================= */
  function autoGrow() {
    const ta = $("#composer textarea");
    ta.style.height = "auto";
    ta.style.height = Math.min(200, ta.scrollHeight) + "px";
  }

  /* ============================ Events ============================= */
  function bindEvents() {
    $("#sendBtn").addEventListener("click", () => send());
    $("#stopBtn").addEventListener("click", stop);
    $("#newChatBtn").addEventListener("click", newChat);
    $("#heroToolsBtn").addEventListener("click", openTools);
    $("#btnCopyResult").addEventListener("click", () => {
      const text = $("#seqResultText").textContent;
      navigator.clipboard?.writeText(text).then(
        () => toast("Copied to clipboard"),
        () => toast("Copy failed", "error")
      );
    });
    $("#exportBtn").addEventListener("click", exportChat);
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#toolsBtn").addEventListener("click", openTools);
    $("#menuBtn").addEventListener("click", toggleSidebar);
    $("#closeSidebar").addEventListener("click", () => setSidebar(false));
    $("#sideNewChat").addEventListener("click", () => { newChat(); if (isNarrow()) setSidebar(false); });
    $("#scrim").addEventListener("click", () => setSidebar(false));
    $("#closeTools").addEventListener("click", closeTools);
    $("#themeBtn").addEventListener("click", () => {
      const next = UI.get().theme === "dark" ? "light" : "dark";
      applyTheme(next);
      UI.set({ theme: next });
    });
    $("#convoSearch").addEventListener("input", debounce((e) => {
      state.query = e.target.value;
      renderSidebar();
    }, 120));
    $("#scrollDown").addEventListener("click", () => scrollBottom(true));
    chatEl().addEventListener("scroll", () => {
      const c = chatEl();
      const far = c.scrollHeight - c.scrollTop - c.clientHeight > 220;
      $("#scrollDown").classList.toggle("hidden", !far);
    });
    window.addEventListener("resize", debounce(() => {
      const scrim = $("#scrim");
      if (scrim) scrim.hidden = !(sidebarOpen() && isNarrow());
    }, 150));
    $("#clearConvos").addEventListener("click", () => {
      if (!confirm("Delete all chat history?")) return;
      state.convos = [];
      Store.save([]);
      state.chat = null;
      ensureChat();
      persistChat();
      renderAll();
      toast("History cleared");
    });
    $("#closeSettings").addEventListener("click", closeSettings);
    $("#saveSettings").addEventListener("click", saveSettings);
    $("#resetSettings").addEventListener("click", resetSettings);
    $("#setApiMode").addEventListener("change", (e) => {
      syncSettingsUI({ ...Settings.get(), apiMode: e.target.value });
    });
    $("#setTemp").addEventListener("input", () => {
      $("#tempVal").textContent = Number($("#setTemp").value).toFixed(2);
    });
    $("#modelSelect").addEventListener("change", (e) => {
      Settings.set({ model: e.target.value });
      renderComposerStatus();
      if (state.chat) { state.chat.model = modelInUse(); persistChat(); }
    });
    $("#composer textarea").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $("#composer textarea").addEventListener("input", autoGrow);
    $("#clearChatBtn").addEventListener("click", () => {
      if (!state.chat || !state.chat.messages.length) return;
      if (!confirm("Clear this conversation?")) return;
      state.chat.messages = [];
      persistChat();
      renderAll();
    });
    $("#btnCloseCodon").addEventListener("click", () => $("#codonModal").classList.remove("open"));
    $("#codonModal").addEventListener("click", (e) => {
      if (e.target.id === "codonModal") e.target.classList.remove("open");
    });
    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === "Escape") {
        if ($("#codonModal").classList.contains("open")) { $("#codonModal").classList.remove("open"); return; }
        if ($("#settingsModal").classList.contains("open")) { closeSettings(); return; }
        if (toolsOpen()) { closeTools(); return; }
        if (sidebarOpen() && isNarrow()) { setSidebar(false); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!sidebarOpen()) setSidebar(true);
        $("#convoSearch").focus();
      }
      if (!typing && e.key === "/") { e.preventDefault(); $("#composer textarea").focus(); }
    });
    $("#settingsModal").addEventListener("click", (e) => {
      if (e.target.id === "settingsModal") closeSettings();
    });
    // Settings change -> refresh status bar
    window.addEventListener("settingschange", renderComposerStatus);
  }

  /* ============================= Init ============================== */
  async function init() {
    marked.setOptions({ gfm: true, breaks: true });

    // UI prefs: theme + side panel state
    const ui = UI.get();
    applyTheme(ui.theme);
    setSidebar(isNarrow() ? false : ui.sidebar, false);

    renderSuggestions();
    bindEvents();
    tools.init();

    // Restore or create a conversation
    const last = state.convos.find((c) => c.id === state.activeId);
    state.chat = last || { id: uid(), title: "New chat", ts: Date.now(), model: Settings.get().model, messages: [] };
    state.activeId = state.chat.id;
    Store.setActive(state.activeId);
    persistChat();

    renderAll();
    autoGrow();
    $("#composer textarea").focus();

    // Only local mode needs a live model list (whatever Ollama/LM Studio has
    // pulled). Hosted modes use the small curated CONFIG.MODELS list.
    if (Settings.get().apiMode === "local") {
      window.API.listModels().then((ids) => {
        state.models = ids;
        renderModelSelect();
      }).catch(() => {});
    }
  }

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
