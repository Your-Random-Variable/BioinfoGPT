/* ============================================================
 *  BioinfoGPT — main application
 *  Full version with: loading animations, 11+ tools, file drop,
 *  voice mic + TTS, PWA, i18n (en/hi), prompt library, primer/PCR,
 *  BLAST-like, MSA, dot-plot, share link, PDF, accessibility.
 * ============================================================ */
(() => {
  "use strict";

  const { $, $$, el, uid, debounce, timeAgo, download, toast } = window.Utils;
  const BIO = window.BIO;
  const CONFIG = window.CONFIG;

  /* ============================ Settings ============================ */
  const DEFAULT_SETTINGS = {
    apiMode: "groq",
    proxyUrl: CONFIG.PROXY_URL,
    groqKey: "",
    githubKey: "",
    openrouterKey: "",
    cerebrasKey: "",
    geminiKey: "",
    mistralKey: "",
    pollinationsKey: "",
    localBaseUrl: CONFIG.LOCAL_BASE_URL,
    localKey: "",
    model: CONFIG.DEFAULT_MODEL,
    customModel: "",
    temperature: CONFIG.DEFAULT_TEMPERATURE,
    maxTokens: CONFIG.DEFAULT_MAX_TOKENS,
    streaming: true,
    smartDefaults: true,
    systemPrompt: CONFIG.DEFAULT_SYSTEM_PROMPT,
    lang: "en",
    highContrast: false,
    largeText: false,
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

  /* ====================== History =================== */
  const HISTORY_KEY = "bioinfogpt_convos_v1";
  const ACTIVE_KEY = "bioinfogpt_active_v1";
  const MAX_HISTORY = 30;

  const Store = {
    all() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } },
    save(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch {} },
    active() { return localStorage.getItem(ACTIVE_KEY) || null; },
    setActive(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch {} },
  };

  let state = { convos: Store.all(), activeId: Store.active(), chat: null, streaming: false, abort: null, models: [], query: "" };

  const UI_KEY = "bioinfogpt_ui_v1";
  const UI = {
    get() { try { return { theme: "dark", sidebar: true, ...(JSON.parse(localStorage.getItem(UI_KEY)) || {}) }; } catch { return { theme: "dark", sidebar: true }; } },
    set(partial) { const next = { ...this.get(), ...partial }; try { localStorage.setItem(UI_KEY, JSON.stringify(next)); } catch {} return next; },
  };

  const isNarrow = () => typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 900px)").matches : window.innerWidth <= 900;

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7fb" : "#080b16");
  }
  function applyAccessibility() {
    const s = Settings.get();
    document.documentElement.classList.toggle("high-contrast", !!s.highContrast);
    document.documentElement.classList.toggle("large-text", !!s.largeText);
  }
  function setSidebar(open, persist = true) {
    const bar = $("#sidebar"); const scrim = $("#scrim");
    bar.classList.toggle("collapsed", !open);
    $("#menuBtn").setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !(open && isNarrow());
    if (persist) UI.set({ sidebar: open });
  }
  function sidebarOpen() { return !$("#sidebar").classList.contains("collapsed"); }
  function toggleSidebar() { setSidebar(!sidebarOpen()); }

  /* ======================== i18n ========================== */
  const I18N = {
    en: {
      newChat: "New chat", recent: "Recent", clearHistory: "Clear history", heroTitle: "Ask anything in bioinformatics", heroSub: "Answers, runnable code and built-in sequence tools — fast and free. Drag-drop FASTA, voice input, offline PWA, Hindi/English.", seqTools: "Sequence tools", heroNote: "Tip: paste a FASTA or drag-drop file, or use mic.", clearChat: "Clear chat", send: "send", dropFile: "Drop FASTA / FASTQ / GenBank / CSV file here", stats: "Stats", transform: "Transform", orf: "ORF", motif: "Motif", digest: "Digest", protein: "Protein", codon: "Codon", primer: "Primer", pcr: "PCR", blast: "BLAST", msa: "MSA", dotplot: "Dot-plot",
    },
    hi: {
      newChat: "नई चैट", recent: "हाल की", clearHistory: "इतिहास साफ़ करें", heroTitle: "बायोइनफॉर्मेटिक्स में कुछ भी पूछें", heroSub: "उत्तर, कोड और बिल्ट-इन सीक्वेंस टूल्स — तेज़ और मुफ़्त। FASTA ड्रैग-ड्रॉप, वॉइस इनपुट, ऑफ़लाइन PWA, हिंदी/अंग्रेज़ी।", seqTools: "सीक्वेंस टूल्स", heroNote: "टिप: FASTA पेस्ट करें या फ़ाइल ड्रैग-ड्रॉप करें, या माइक उपयोग करें।", clearChat: "चैट साफ़ करें", send: "भेजें", dropFile: "FASTA / FASTQ / GenBank / CSV फ़ाइल यहाँ छोड़ें", stats: "आँकड़े", transform: "ट्रांसफ़ॉर्म", orf: "ORF", motif: "मोटिफ", digest: "डाइजेस्ट", protein: "प्रोटीन", codon: "कोडन", primer: "प्राइमर", pcr: "PCR", blast: "BLAST", msa: "MSA", dotplot: "डॉट-प्लॉट",
    }
  };
  function t(key) {
    const lang = Settings.get().lang || "en";
    return (I18N[lang] && I18N[lang][key]) || (I18N.en[key] || key);
  }
  function applyI18n() {
    $$("[data-i18n]").forEach(node => {
      const k = node.getAttribute("data-i18n");
      if (k) node.textContent = t(k);
    });
    const search = $("#convoSearch"); if (search) search.placeholder = t("recent") === "हाल की" ? "चैट खोजें…" : "Search chats…";
  }

  /* ======================== Smart defaults ========================== */
  const SMART_DEFAULTS_SYSTEM = {
    role: "system",
    content: "Preferences for this chat (bioinformatics smart defaults): use Python/Biopython and R/Bioconductor unless the user asks otherwise; provide runnable, well-commented code; when the user pastes a sequence, FASTA/FASTQ snippet or a table, propose concrete next analysis steps; be honest about limits (you cannot access NCBI or the internet); structure long answers with headings or bullet lists.",
  };

  function buildMessages() {
    const s = Settings.get();
    const msgs = [{ role: "system", content: s.systemPrompt || CONFIG.DEFAULT_SYSTEM_PROMPT }];
    if (s.smartDefaults) msgs.push(SMART_DEFAULTS_SYSTEM);
    for (const m of state.chat.messages) msgs.push({ role: m.role, content: m.content });
    return msgs;
  }

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
      btn.type = "button"; btn.title = "Copy code";
      btn.addEventListener("click", () => {
        const text = (code ? code.textContent : pre.textContent) || "";
        navigator.clipboard?.writeText(text).then(
          () => { btn.textContent = "✓"; setTimeout(() => (btn.textContent = "⧉"), 1400); },
          () => toast("Copy failed — select manually.", "error")
        );
      });
      pre.appendChild(btn);
    });
    $$("a", host).forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  }

  const chatEl = () => $("#chat");
  const welcomeEl = () => $("#welcome");

  function ensureChat() {
    if (state.chat) return state.chat;
    const id = uid();
    state.chat = { id, title: "New chat", ts: Date.now(), model: Settings.get().model, messages: [] };
    state.activeId = id; Store.setActive(id); return state.chat;
  }
  function renderAll() { renderWelcome(); renderMessages(); renderSidebar(); renderModelSelect(); renderComposerStatus(); applyI18n(); }
  function renderWelcome() {
    const empty = !state.chat || state.chat.messages.length === 0;
    welcomeEl().classList.toggle("hidden", !empty);
    chatEl().classList.toggle("hidden", empty);
    const t = $("#chatTitle"); if (t) t.textContent = empty ? t("newChat") : (state.chat.title || t("newChat"));
  }
  function icon(id, size=14) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.setAttribute("width",size); svg.setAttribute("height",size); svg.setAttribute("aria-hidden","true");
    const use=document.createElementNS("http://www.w3.org/2000/svg","use"); use.setAttribute("href","#"+id); svg.appendChild(use); return svg;
  }
  function iconButton(cls, iconId, label) {
    const b=el("button",cls); b.type="button"; b.appendChild(icon(iconId,13)); b.appendChild(document.createTextNode(" "+label)); return b;
  }

  /* ---- Feature 1: loading animations ---- */
  const THINKING_PHRASES = ["Thinking…","Consulting the literature…","Aligning sequences…","Checking the codon table…","Writing code…","Assembling the answer…"];
  function thinkingNode() {
    const wrap=el("div","thinking");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.setAttribute("width","20"); svg.setAttribute("height","20"); svg.setAttribute("aria-hidden","true"); svg.setAttribute("class","thinking-spin");
    const use=document.createElementNS("http://www.w3.org/2000/svg","use"); use.setAttribute("href","#icoHelix"); svg.appendChild(use);
    const text=el("span","thinking-text",THINKING_PHRASES[0]);
    const typing=el("span","typing"); typing.innerHTML="<i></i><i></i><i></i>";
    wrap.appendChild(svg); wrap.appendChild(text); wrap.appendChild(typing); return wrap;
  }
  function startPhraseCycle(host){ const label=host?host.querySelector(".thinking-text"):null; if(!label) return ()=>{}; let idx=0; const iv=setInterval(()=>{ label.style.opacity="0"; setTimeout(()=>{ idx=(idx+1)%THINKING_PHRASES.length; label.textContent=THINKING_PHRASES[idx]; label.style.opacity="1"; },180); },2200); return ()=>clearInterval(iv); }

  function msgNode(m){
    const wrap=el("article",`msg msg-${m.role}`); wrap.dataset.id=m.id||"";
    const avatar=el("div","avatar",m.role==="user"?"\u{1F464}":"\u{1F9EC}"); const col=el("div","bubble-wrap"); const bubble=el("div","bubble");
    const meta=el("div","msg-meta"); meta.appendChild(el("span","msg-role",m.role==="user"?"You":"BioinfoGPT"));
    if(m.role==="assistant") meta.appendChild(el("span","msg-model",m.model||state.chat?.model||"")); meta.appendChild(el("time","",timeAgo(m.ts||Date.now())));
    const content=el("div","msg-content");
    if(m.content){ content.innerHTML=renderMarkdown(m.content); enhanceCode(content);} else if(m.role==="assistant"){ content.appendChild(thinkingNode()); }
    bubble.appendChild(content);
    const actions=el("div","msg-actions");
    const copyBtn=iconButton("btn-ghost","icoCopy","Copy"); copyBtn.addEventListener("click", async()=>{ try{ await navigator.clipboard.writeText(m.content); toast("Copied"); }catch{ toast("Copy failed","error"); } }); actions.appendChild(copyBtn);
    if(m.role==="assistant"){
      const speakBtn=iconButton("btn-ghost","icoVolume","Speak"); speakBtn.addEventListener("click",()=>{ if('speechSynthesis' in window){ const u=new SpeechSynthesisUtterance(m.content); u.lang=Settings.get().lang==='hi'?'hi-IN':'en-US'; speechSynthesis.speak(u);} else toast("TTS not supported","error"); }); actions.appendChild(speakBtn);
    }
    if(m.role==="assistant"&&!state.streaming){
      const regen=iconButton("btn-ghost","icoRefresh","Retry"); regen.addEventListener("click",()=>regenerate(m.id)); actions.appendChild(regen);
    }
    col.appendChild(meta); col.appendChild(bubble); col.appendChild(actions); wrap.appendChild(avatar); wrap.appendChild(col); return wrap;
  }
  function renderMessages(){ const chat=chatEl(); chat.innerHTML=""; if(!state.chat) return; for(const m of state.chat.messages) chat.appendChild(msgNode(m)); scrollBottom(true); }
  function scrollBottom(force=false){ const chat=chatEl(); const nearBottom=chat.scrollHeight-chat.scrollTop-chat.clientHeight<160; if(force||nearBottom) chat.scrollTop=chat.scrollHeight; }
  function renderSidebar(){
    const list=$("#convos"); list.innerHTML=""; const q=state.query.trim().toLowerCase(); const items=q?state.convos.filter(c=>(c.title||"").toLowerCase().includes(q)):state.convos;
    items.forEach(c=>{
      const item=el("div","convo-item"+(c.id===state.activeId?" active":"")); item.setAttribute("role","listitem"); item.tabIndex=0;
      item.appendChild(el("span","convo-title",c.title||t("newChat"))); item.appendChild(el("span","convo-time",timeAgo(c.ts)));
      const del=el("button","convo-del"); del.type="button"; del.title="Delete"; del.setAttribute("aria-label","Delete"); del.appendChild(icon("icoTrash",14)); del.addEventListener("click",(e)=>{ e.stopPropagation(); deleteConversation(c.id); }); item.appendChild(del);
      const open=()=>{ openConversation(c.id); if(isNarrow()) setSidebar(false); }; item.addEventListener("click",open); item.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
      list.appendChild(item);
    });
    const emptyEl=$("#sideEmpty"); if(emptyEl){ emptyEl.classList.toggle("hidden",items.length>0); emptyEl.textContent=state.convos.length===0?"No conversations yet":"No chats match your search"; }
  }
  function renderModelSelect(){
    const sel=$("#modelSelect"); if(!sel) return; const st=Settings.get(); const current=st.model;
    let options;
    if(st.apiMode==="local") options=state.models.length?state.models:CONFIG.LOCAL_FALLBACK_MODELS;
    else if(st.apiMode==="github") options=state.models.length?state.models:CONFIG.GITHUB_FALLBACK_MODELS;
    else if(st.apiMode==="openrouter") options=state.models.length?state.models:CONFIG.OPENROUTER_FALLBACK_MODELS;
    else if(st.apiMode==="cerebras") options=state.models.length?state.models:CONFIG.CEREBRAS_FALLBACK_MODELS;
    else if(st.apiMode==="gemini") options=state.models.length?state.models:CONFIG.GEMINI_FALLBACK_MODELS;
    else if(st.apiMode==="mistral") options=state.models.length?state.models:CONFIG.MISTRAL_FALLBACK_MODELS;
    else if(st.apiMode==="pollinations") options=state.models.length?state.models:CONFIG.POLLINATIONS_FALLBACK_MODELS;
    else options=CONFIG.MODELS.map(m=>m.id);
    options=[...options,current].filter(Boolean);
    const labels=new Map(CONFIG.MODELS.map(m=>[m.id,m.label])); const used=new Set(); sel.innerHTML="";
    for(const id of options){ if(used.has(id))continue; used.add(id); const opt=el("option","",labels.get(id)||id); opt.value=id; sel.appendChild(opt); }
    sel.value=current; if(!sel.value&&sel.options.length) sel.value=sel.options[0].value;
    const custom=!!st.customModel; sel.disabled=custom; sel.title=custom?`Overridden by custom model: ${st.customModel}`:"Model";
  }
  function renderComposerStatus(){
    const s=Settings.get(); let provider="Groq", mode;
    if(s.apiMode==="proxy"){ provider="Proxy"; mode="key server-side"; }
    else if(s.apiMode==="local"){ provider="Local"; mode="offline"; }
    else if(s.apiMode==="github"){ provider="GitHub Models"; mode=s.githubKey?"your token":"no token"; }
    else if(s.apiMode==="openrouter"){ provider="OpenRouter"; mode=s.openrouterKey?"your key":"no key"; }
    else if(s.apiMode==="cerebras"){ provider="Cerebras"; mode=s.cerebrasKey?"your key":"no key"; }
    else if(s.apiMode==="gemini"){ provider="Gemini"; mode=s.geminiKey?"your key":"no key"; }
    else if(s.apiMode==="mistral"){ provider="Mistral"; mode=s.mistralKey?"your key":"no key"; }
    else if(s.apiMode==="pollinations"){ provider="Pollinations"; mode=s.pollinationsKey?"your key":"free"; }
    else if(s.apiMode==="byok"){ provider="Groq"; mode="your key"; }
    else { provider="Groq"; mode=s.groqKey?"your key":"built-in key"; }
    const node=$("#composerStatus"); if(node) node.textContent=`${provider} · ${mode} · temp ${Number(s.temperature).toFixed(2)}`;
    renderModelSelect();
  }
  function modelInUse(){ const s=Settings.get(); return s.customModel||s.model||CONFIG.DEFAULT_MODEL; }

  function setStreaming(on){
    state.streaming=on;
    $("#sendBtn").classList.toggle("hidden",on);
    $("#stopBtn").classList.toggle("hidden",!on);
    const ta=$("#composer textarea"); if(ta) ta.disabled=on; if(!on&&ta) ta.focus();
    const genBar=$("#genBar"); if(genBar) genBar.classList.toggle("on",on);
    const comp=$("#composer"); if(comp) comp.classList.toggle("busy",on);
    document.body.classList.toggle("generating",on);
  }

  async function send(text){
    if(state.streaming) return;
    const s=Settings.get();
    const content=(text??$("#composer textarea").value).trim();
    if(!content) return;
    const chat=ensureChat();
    chat.messages.push({id:uid(),role:"user",content,ts:Date.now()});
    if(chat.messages.filter(m=>m.role==="user").length===1) chat.title=content.slice(0,48)+(content.length>48?"…":"");
    persistChat(); renderWelcome(); renderMessages(); renderSidebar();
    const inputTa=$("#composer textarea"); if(inputTa){ inputTa.value=""; autoGrow(); }
    const assistantId=uid();
    const placeholder={id:assistantId,role:"assistant",content:"",model:modelInUse(),ts:Date.now()};
    chat.messages.push(placeholder); renderMessages();
    setStreaming(true); state.abort=new AbortController();
    const msgs=buildMessages(); let acc=""; let renderQueued=false;
    const hostNode=chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`); const stopCycle=startPhraseCycle(hostNode);
    let noOutputTimer=setTimeout(()=>{ if(!acc&&state.streaming){ toast("No response in 15s — add free key in Settings → API mode or use Local Ollama.", "error", 7000); try{ state.abort?.abort(); }catch{} } },15000);
    const paint=()=>{
      renderQueued=false;
      const node=chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`);
      if(node){
        const oldCaret=node.querySelector(".stream-caret"); if(oldCaret) oldCaret.remove();
        node.innerHTML=renderMarkdown(acc); enhanceCode(node);
        if(state.streaming&&acc){
          const caret=el("span","stream-caret"); const blocks=node.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote");
          if(blocks.length){ const last=blocks[blocks.length-1]; last.appendChild(caret); } else node.appendChild(caret);
        }
      }
      scrollBottom();
    };
    try{
      for await(const chunk of window.API.streamChat({model:modelInUse(),messages:msgs,temperature:s.temperature,maxTokens:s.maxTokens,signal:state.abort.signal})){
        if(!acc){ clearTimeout(noOutputTimer); stopCycle(); }
        acc+=chunk; placeholder.content=acc;
        if(!renderQueued){ renderQueued=true; requestAnimationFrame(paint); }
      }
      placeholder.content=acc;
      const node=chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`);
      if(node){ node.innerHTML=renderMarkdown(acc); enhanceCode(node); }
      scrollBottom(true);
    }catch(err){
      if(err.name==="AbortError"){ placeholder.content=acc||"(stopped)"; const node=chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`); if(node){ node.innerHTML=renderMarkdown(placeholder.content); enhanceCode(node); } }
      else{
        chat.messages=chat.messages.filter(m=>m.id!==assistantId); renderMessages();
        let hint="";
        if(s.apiMode==="proxy") hint=" Make sure Worker is deployed and PROXY_URL is set in js/config.js. Free: Groq, Pollinations, Gemini, Mistral, GitHub, OpenRouter, Local.";
        else if(s.apiMode==="local") hint=" Make sure Ollama/LM Studio running (OLLAMA_ORIGINS=*).";
        else if(s.apiMode==="github") hint=" Check GitHub token - get free at github.com/settings/tokens (models:read).";
        else if(s.apiMode==="openrouter") hint=" Check OpenRouter key - free models at openrouter.ai/keys";
        else if(s.apiMode==="pollinations") hint=" Check Pollinations key at enter.pollinations.ai - model must be openai.";
        else if(s.apiMode==="gemini") hint=" Check Gemini key at aistudio.google.com/app/apikey";
        else if(s.apiMode==="mistral") hint=" Check Mistral key at console.mistral.ai/api-keys";
        else if(s.apiMode==="byok") hint=" Check Groq key at console.groq.com/keys or switch to free alternatives.";
        else hint=s.groqKey?" Check Groq key.":" Built-in Groq key invalid/rate-limited. Add free key in Settings: Groq 14.4k/day, Pollinations free, Gemini 1500/day, Mistral 1B/month, GitHub 150/day, OpenRouter free, Local unlimited.";
        toast(`Error: ${err.message}${hint}`,"error",8000);
      }
    }finally{
      try{ clearTimeout(noOutputTimer); }catch{} stopCycle();
      placeholder.content=placeholder.content||"";
      const node=chatEl().querySelector(`.msg[data-id="${assistantId}"] .msg-content`);
      if(node){ if(!acc) node.innerHTML=""; else { node.innerHTML=renderMarkdown(placeholder.content); enhanceCode(node); } }
      setStreaming(false); persistChat(); renderSidebar(); scrollBottom(true);
    }
  }
  function stop(){ state.abort?.abort(); }
  function regenerate(id){
    const chat=state.chat; if(!chat||state.streaming) return; const idx=chat.messages.findIndex(m=>m.id===id); if(idx===-1) return;
    chat.messages=chat.messages.slice(0,idx); persistChat(); renderMessages();
    const last=chat.messages[chat.messages.length-1];
    if(last&&last.role==="user"){ const t=last.content; chat.messages.pop(); renderMessages(); send(t); }
  }
  function persistChat(){ if(!state.chat) return; const others=state.convos.filter(c=>c.id!==state.chat.id); state.convos=[state.chat,...others].slice(0,MAX_HISTORY); Store.save(state.convos); }
  function newChat(){ if(state.streaming) stop(); state.chat=null; ensureChat(); persistChat(); renderAll(); $("#composer textarea").focus(); }
  function openConversation(id){ if(state.streaming) stop(); const c=state.convos.find(x=>x.id===id); if(!c) return; state.chat=c; state.activeId=id; Store.setActive(id); renderAll(); }
  function deleteConversation(id){ state.convos=state.convos.filter(c=>c.id!==id); Store.save(state.convos); if(state.activeId===id){ state.chat=null; ensureChat(); persistChat(); } renderAll(); }
  function exportChat(){
    if(!state.chat||!state.chat.messages.length){ toast("Nothing to export yet"); return; }
    const lines=[`# ${state.chat.title}`,"",`_Exported ${new Date().toLocaleString()} · model ${state.chat.model}_`,""];
    for(const m of state.chat.messages) lines.push(`## ${m.role==="user"?"User":"BioinfoGPT"}`,"",m.content,"");
    download(`${(state.chat.title||"chat").replace(/[^\w\-]+/g,"_").toLowerCase()}.md`,lines.join("\n")); toast("Chat exported as Markdown");
  }
  function exportPdf(){ window.print(); }

  /* ======================== Tools ========================= */
  const tools={
    records:[], activeSeq:"",
    init(){
      const ta=$("#seqInput"); if(ta) ta.addEventListener("input",debounce(()=>this.update(),250));
      const mappings=[
        ["#btnAnalyze",()=>this.sendToChat()], ["#btnRC",()=>this.apply(s=>BIO.reverseComplement(s))], ["#btnRev",()=>this.apply(s=>BIO.reverse(s))],
        ["#btnTranslate",()=>this.translate()], ["#btnSixFrame",()=>this.sixFrame()], ["#btnRandDNA",()=>this.random("DNA")], ["#btnRandRNA",()=>this.random("RNA")], ["#btnRandProt",()=>this.random("protein")],
        ["#btnCodonTable",()=>this.codonTable()], ["#btnORF",()=>this.orfs()], ["#btnMotif",()=>this.motif()], ["#btnDigest",()=>this.digest()], ["#btnProt",()=>this.protein()],
        ["#btnCodonUsage",()=>this.codonUsage()], ["#btnPrimer",()=>this.primer()], ["#btnPCR",()=>this.pcr()], ["#btnBlast",()=>this.blast()], ["#btnMSA",()=>this.msa()], ["#btnDot",()=>this.dotplot()],
      ];
      mappings.forEach(([sel,fn])=>{ const el=$(sel); if(el) el.addEventListener("click",fn); });
      $$(".tab").forEach(btn=>{ btn.addEventListener("click",()=>{ const tab=btn.dataset.tab; $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab)); $$(".tabpane").forEach(p=>p.classList.toggle("active",p.dataset.pane===tab)); }); });
      const sel=$("#fastaSel"); if(sel) sel.addEventListener("change",(e)=>{ const idx=Number(e.target.value); if(!isNaN(idx)&&this.records[idx]){ this.activeSeq=this.records[idx].seq; this.updateStatsOnly(); } });
    },
    seq(){ if(this.records.length>1&&this.activeSeq) return this.activeSeq; const ta=$("#seqInput"); return ta?ta.value.trim():""; },
    raw(){ const ta=$("#seqInput"); return ta?ta.value:""; },
    esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); },
    guard(minLen=1){ const s=this.seq(); if(!s||BIO.clean(s).length<minLen){ toast("Enter a sequence first","error"); return null; } return s; },
    refreshFasta(){
      const raw=this.raw(); const bar=$("#fastaBar"); const sel=$("#fastaSel"); const cnt=$("#fastaCount");
      if(!raw.trim().startsWith(">")){ this.records=[]; this.activeSeq=""; if(bar) bar.classList.add("hidden"); return; }
      const recs=BIO.parseFasta(raw); this.records=recs;
      if(recs.length>1){ if(sel){ sel.innerHTML=""; recs.forEach((r,i)=>{ const opt=el("option","",`${r.id||"seq"+(i+1)} (${r.seq.length} nt)`); opt.value=String(i); sel.appendChild(opt); }); sel.value="0"; } this.activeSeq=recs[0].seq; if(cnt) cnt.textContent=`${recs.length} records`; if(bar) bar.classList.remove("hidden"); }
      else { this.activeSeq=recs[0]?recs[0].seq:""; if(bar) bar.classList.add("hidden"); }
    },
    update(){ this.refreshFasta(); this.updateStatsOnly(); },
    updateStatsOnly(){
      const s=this.seq(); const out=$("#seqResults"); if(!out) return;
      if(!s){ out.innerHTML='<div class="hint">Paste or type a sequence above. Whitespace, digits and hyphens are ignored.</div>'; return; }
      const check=BIO.checkAlphabet(s); const st=BIO.stats(s); const c=st.counts; const html=[];
      html.push(`<div class="chip chip-${check.valid?"ok":"warn"}">Detected: <b>${this.esc(check.type)}</b> ${check.valid?"· valid alphabet":""}</div>`);
      if(!check.valid){ const bad=check.invalid.slice(0,12).map(x=>`'${this.esc(x.ch)}'@${x.pos}`).join(", "); html.push(`<div class="warnline">⚠ Invalid residue(s): ${bad}${check.invalid.length>12?` (+${check.invalid.length-12} more)`:""}</div>`); }
      const grid=[["Length",st.length.toLocaleString()],["GC content",`${st.gc.toFixed(2)}%`],["AT content",`${st.at.toFixed(2)}%`],["Mol. weight",`${st.mw.toFixed(0)} Da`],["Tm (approx)",st.tm?`${st.tm.toFixed(1)} °C`:"—"],["Purines / Pyrimidines",`${st.purines} / ${st.pyrimidines}`]];
      html.push('<div class="stat-grid">'); grid.forEach(([k,v])=>html.push(`<div class="stat"><span>${this.esc(k)}</span><b>${this.esc(v)}</b></div>`)); html.push("</div>");
      const counts=["A","T","U","G","C","N"].filter(b=>c[b]); html.push(`<div class="counts">${counts.map(b=>`<span class="base base-${b}">${this.esc(b)} <b>${c[b]}</b></span>`).join("")}</div>`);
      if(st.length>150){ const win=BIO.gcWindow(s,100,50); const avg=win.reduce((a,w)=>a+w.gc,0)/Math.max(1,win.length); html.push(`<div class="hint">Sliding-window GC (100 bp, step 50): mean ${avg.toFixed(1)}% across ${win.length} windows</div>`); }
      out.innerHTML=html.join("");
    },
    apply(fn){ const s=this.guard(1); if(!s) return; const res=fn(s); $("#seqResultText").textContent=res; $("#seqResultWrap").classList.remove("hidden"); const ta=$("#seqInput"); if(ta){ if(this.records.length>1&&this.activeSeq){ ta.value=res; this.records=[]; this.activeSeq=""; $("#fastaBar")?.classList.add("hidden"); } else ta.value=res; } this.update(); },
    translate(){ const s=this.guard(1); if(!s) return; const frame=Number($("#frameSel").value); const t=BIO.translate(s,frame); $("#seqResultText").textContent=`${t.sequence}\n\nCodons (frame ${t.frame}): ${t.codons.join(" ")}\nStop codons: ${t.stopCount}`; $("#seqResultWrap").classList.remove("hidden"); },
    sixFrame(){ const s=this.guard(1); if(!s) return; const frames=BIO.sixFrame(s); let html=`<div class="chip">6 frames</div><div class="res-scroll"><table class="res-table"><thead><tr><th>Frame</th><th>Len</th><th>Stops</th><th>Seq</th></tr></thead><tbody>`; for(const fr of frames) html+=`<tr><td>${this.esc(fr.label)}</td><td class="num">${fr.sequence.length}</td><td class="num">${fr.stopCount}</td><td><span class="mono-wrap">${this.esc(fr.sequence.slice(0,80))}${fr.sequence.length>80?"…":""}</span></td></tr>`; html+="</tbody></table></div>"; let con=$("#sixFrameOut"); if(!con){ con=document.createElement("div"); con.id="sixFrameOut"; document.querySelector('[data-pane="transform"]')?.appendChild(con); } con.innerHTML=html; },
    random(kind){ const n=Math.min(5000,Math.max(1,Number($("#seqLen").value)||100)); const ta=$("#seqInput"); if(!ta) return; ta.value=kind==="DNA"?BIO.randomDNA(n):kind==="RNA"?BIO.randomRNA(n):BIO.randomProtein(n); this.records=[]; this.activeSeq=""; $("#fastaBar")?.classList.add("hidden"); this.update(); },
    codonTable(){ const table=BIO.CODON_TABLE; const rows=[]; const bases=["T","C","A","G"]; for(let i=0;i<4;i++){ const row=[]; for(let j=0;j<4;j++){ const codons=[]; for(let k=0;k<4;k++){ const codon=bases[i]+bases[j]+bases[k]; codons.push(`<span class="codon">${this.esc(codon)} <b>${this.esc(table[codon])}</b></span>`);} row.push(`<td>${codons.join(" ")}</td>`);} rows.push(`<tr>${row.join("")}</tr>`);} $("#codonBody").innerHTML=`<table class="codon-table"><thead><tr><th>First↓ / Second→</th></tr></thead><tbody>${rows.join("")}</tbody></table>`; $("#codonModal").classList.add("open"); },
    orfs(){ const s=this.guard(30); if(!s) return; const minAA=Math.max(1,Number($("#orfMin").value)||30); const orfs=BIO.findORFs(s,minAA); const out=$("#orfOut"); if(!out) return; if(orfs.length===0){ out.innerHTML=`<div class="hint">No ORFs found (min ${minAA} aa)</div>`; return; } let html=`<div class="chip">${orfs.length} ORF(s) ≥ ${minAA} aa, longest ${orfs[0].length} aa</div><div class="res-scroll"><table class="res-table"><thead><tr><th>Strand</th><th>Frame</th><th>Start</th><th>End</th><th>Len</th><th>Complete</th><th>Protein</th></tr></thead><tbody>`; for(const o of orfs.slice(0,100)){ const cls=o.strand===1?"strand-fwd":"strand-rev"; html+=`<tr><td class="${cls}">${o.strand===1?"+":"-"}1</td><td>${this.esc(o.frame)}</td><td class="num">${o.start}</td><td class="num">${o.end}</td><td class="num">${o.length}</td><td>${o.complete?"yes":"no"}</td><td><span class="mono-wrap">${this.esc(o.protein.slice(0,40))}${o.protein.length>40?"…":""}</span></td></tr>`;} html+="</tbody></table></div>"; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(orfs.slice(0,2).map(o=>o.protein.slice(0,30)).join(", ")); out.appendChild(ab);}catch(e){} },
    motif(){ const s=this.guard(1); if(!s) return; const pat=$("#motifIn")?.value.trim(); if(!pat){ toast("Enter motif","error"); return; } const res=BIO.findMotif(s,pat); const out=$("#motifOut"); if(!out) return; if(res.error){ out.innerHTML=`<div class="warnline">⚠ ${this.esc(res.error)}</div>`; return; } if(res.hits.length===0){ out.innerHTML=`<div class="hint">No hits for <b>${this.esc(pat)}</b></div>`; return; } let html=`<div class="chip">${res.hits.length} hit(s) for ${this.esc(pat)}</div><div class="res-scroll"><table class="res-table"><thead><tr><th>Strand</th><th>Start</th><th>Match</th></tr></thead><tbody>`; for(const h of res.hits.slice(0,200)){ const cls=h.strand===1?"strand-fwd":"strand-rev"; html+=`<tr><td class="${cls}">${h.strand===1?"fwd":"rev"}</td><td class="num">${h.start}</td><td class="mono-wrap">${this.esc(h.match)}</td></tr>`;} html+="</tbody></table></div>"; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(pat+" "+res.hits.slice(0,3).map(h=>h.match).join(",")); out.appendChild(ab);}catch(e){} },
    digest(){ const s=this.guard(1); if(!s) return; const res=BIO.restrictionMap(s); const out=$("#digestOut"); if(!out) return; if(res.cutCount===0){ out.innerHTML=`<div class="hint">No sites in ${BIO.clean(s).length} bp</div>`; return; } let html=`<div class="chip">${res.cutCount} cut(s), ${res.fragments.length} frag(s)</div><div class="res-scroll"><table class="res-table"><thead><tr><th>Enzyme</th><th>Site</th><th>Count</th><th>Cuts</th></tr></thead><tbody>`; for(const e of res.enzymes){ if(e.count===0)continue; html+=`<tr><td>${this.esc(e.name)}</td><td class="mono-wrap">${this.esc(e.site)}</td><td class="num">${e.count}</td><td class="num">${this.esc(e.cuts.join(", "))}</td></tr>`;} html+="</tbody></table></div>"; html+=`<div class="hint" style="margin-top:6px">Fragments: ${this.esc(res.fragments.join(", "))} sum ${res.fragments.reduce((a,b)=>a+b,0)}</div>`; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(res.fragments.join(",")+" | "+res.enzymes.filter(e=>e.count>0).map(e=>e.name).join(",")); out.appendChild(ab);}catch(e){} },
    protein(){ const s=this.guard(1); if(!s) return; const type=BIO.detectType(s); const out=$("#protOut"); if(!out) return; const props=BIO.proteinProperties(s); let warn=""; if(type==="DNA"||type==="RNA"||type.startsWith("DNA")) warn=`<div class="warnline">⚠ Input looks like ${this.esc(type)} — results assume protein.</div>`; const invalid=BIO.checkAlphabet(s); let html=warn; if(!invalid.valid) html+=`<div class="warnline">⚠ Invalid: ${this.esc(invalid.invalid.slice(0,8).map(x=>x.ch+"@"+x.pos).join(", "))}</div>`; html+=`<div class="chip">Length ${props.length} aa</div><div class="stat-grid"><div class="stat"><span>MW</span><b>${props.mw.toFixed(1)} Da</b></div><div class="stat"><span>pI</span><b>${props.pI.toFixed(2)}</b></div><div class="stat"><span>GRAVY</span><b>${props.gravy.toFixed(3)}</b></div><div class="stat"><span>Aliphatic</span><b>${props.aliphaticIndex.toFixed(1)}</b></div><div class="stat"><span>Extinction</span><b>${props.extinction}</b></div><div class="stat"><span>Charge pH7</span><b>${props.netCharge7.toFixed(2)}</b></div></div>`; const gpct=((props.gravy+4.5)/9)*100; html+=`<div class="ctl-row"><span class="hint">GRAVY</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(0,Math.min(100,gpct))}%"></span></span><span class="hint">${props.gravy.toFixed(2)}</span></div><div class="counts">`; for(const aa of Object.keys(props.counts).sort()) html+=`<span class="base">${this.esc(aa)} <b>${props.counts[aa]}</b></span>`; html+=`</div>`; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain("MW "+props.mw.toFixed(1)+" pI "+props.pI.toFixed(2)); out.appendChild(ab);}catch(e){} },
    codonUsage(){ const s=this.guard(3); if(!s) return; const frame=Number($("#frameSel")?.value||0); const cu=BIO.codonUsage(s,frame); const out=$("#codonOut"); if(!out) return; if(cu.total===0){ out.innerHTML=`<div class="hint">No codons in frame ${frame+1}</div>`; return; } let html=`<div class="chip">${cu.total} codon(s) frame ${frame+1}</div><div class="res-scroll"><table class="res-table"><thead><tr><th>AA</th><th>Codon</th><th>Count</th><th>Frac</th><th></th></tr></thead><tbody>`; for(const aa of Object.keys(cu.byAA).sort()){ for(const e of cu.byAA[aa]){ const pct=(e.fraction*100).toFixed(1); html+=`<tr><td>${this.esc(aa)}</td><td class="mono-wrap">${this.esc(e.codon)}</td><td class="num">${e.count}</td><td class="num">${pct}%</td><td><span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span></td></tr>`; } } html+="</tbody></table></div>"; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain("total "+cu.total); out.appendChild(ab);}catch(e){} },
    primer(){ const s=this.guard(18); if(!s) return; const minL=Number($("#primerMinLen")?.value||18), maxL=Number($("#primerMaxLen")?.value||24); const primers=BIO.designPrimers(s,{minLen:minL,maxLen:maxL}); const out=$("#primerOut"); if(!out) return; if(primers.length===0){ out.innerHTML=`<div class="hint">No primers found meeting criteria</div>`; return; } let html=`<div class="chip">${primers.length} primers</div><div class="res-scroll"><table class="res-table"><thead><tr><th>Seq</th><th>Start</th><th>Len</th><th>GC%</th><th>Tm</th></tr></thead><tbody>`; for(const p of primers){ html+=`<tr><td class="mono-wrap">${this.esc(p.seq)}</td><td class="num">${p.start}</td><td class="num">${p.length}</td><td class="num">${p.gc}%</td><td class="num">${p.tm}°C</td></tr>`;} html+="</tbody></table></div>"; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(primers.map(p=>p.seq).join(",")); out.appendChild(ab);}catch(e){} },
    pcr(){ const s=this.guard(10); if(!s) return; const f=$("#pcrFwd")?.value.trim(), r=$("#pcrRev")?.value.trim(); if(!f||!r){ toast("Enter both primers","error"); return; } const res=BIO.inSilicoPCR(s,f,r); const out=$("#pcrOut"); if(!out) return; if(!res.found){ out.innerHTML=`<div class="warnline">⚠ ${this.esc(res.msg)}</div>`; return; } out.innerHTML=`<div class="chip">Amplicon ${res.length} bp, ${res.start}-${res.end}</div><div class="mono-wrap" style="max-height:120px; overflow-y:auto; background:var(--surface-2); padding:8px; border-radius:8px; border:1px solid var(--border-soft)">${this.esc(res.amplicon)}</div>`; },
    blast(){ const s=this.guard(3); const query=$("#blastQuery")?.value.trim()||s; if(!query){ toast("Enter query","error"); return; } const k=Number($("#blastK")?.value||6); const dbRaw=this.raw(); const db=dbRaw.trim().startsWith(">")?BIO.parseFasta(dbRaw):this.records.length>1?this.records:[{id:"current",seq:s}]; const res=BIO.blastLike(query,db,k); const out=$("#blastOut"); if(!out) return; if(res.hits.length===0){ out.innerHTML=`<div class="hint">No k=${k} matches</div>`; return; } let html=`<div class="chip">${res.hits.length} hits, k=${res.k}, query ${res.queryLen} nt</div><div class="res-scroll"><table class="res-table"><thead><tr><th>ID</th><th>Len</th><th>Matches</th><th>Score%</th><th>Preview</th></tr></thead><tbody>`; for(const h of res.hits.slice(0,50)){ html+=`<tr><td>${this.esc(h.id||'')}</td><td class="num">${h.length}</td><td class="num">${h.matches}</td><td class="num">${h.score}%</td><td class="mono-wrap">${this.esc(h.seqPreview)}</td></tr>`;} html+="</tbody></table></div>"; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(res.amplicon||""); out.appendChild(ab);}catch(e){} },
    msa(){ const raw=this.raw(); if(!raw.trim()){ toast("Enter FASTA with multiple records","error"); return; } const recs=BIO.parseFasta(raw); if(recs.length<2){ toast("Need at least 2 sequences for MSA","error"); return; } const res=BIO.simpleMSA(recs); const out=$("#msaOut"); if(!out) return; let html=`<div class="chip">Aligned ${recs.length} seqs, len ${res.length}</div><div class="msa-view"><div class="msa-row"><span class="id">Consensus</span> <span class="msa-cons">${this.esc(res.consensus)}</span></div>`; recs.forEach((r,i)=>{ html+=`<div class="msa-row"><span class="id">${this.esc(r.id||'seq'+(i+1))}</span> ${this.esc(res.aligned[i])}</div>`; }); html+=`</div>`; out.innerHTML=html; try{const ab=document.createElement('button');ab.className='btn-primary ai-pulse sm';ab.style.marginTop='8px';ab.textContent='🧠 Explain with AI';ab.onclick=()=>this.aiExplain(res.consensus.slice(0,100)); out.appendChild(ab);}catch(e){} },
    dotplot(){
      const s1=this.seq(); const s2=$("#dotSeq2")?.value.trim()|| (this.records[1]?this.records[1].seq:""); if(!s1||!s2){ toast("Need two sequences","error"); return; }
      const win=Number($("#dotWin")?.value||10), thr=Number($("#dotThr")?.value||8);
      const res=BIO.dotPlot(s1,s2,win,thr); const out=$("#dotOut"); const canvas=$("#dotCanvas");
      if(!out) return;
      out.innerHTML=`<div class="chip">${res.points.length} dots, win ${win}, thr ${thr}</div><div class="dot-legend"><span>X: ${res.s1Len} nt</span><span>Y: ${res.s2Len} nt</span></div>`;
      if(canvas){
        canvas.style.display="block";
        const ctx=canvas.getContext("2d"); const w=canvas.width, h=canvas.height;
        ctx.clearRect(0,0,w,h); ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--surface-2')||"#121728"; ctx.fillRect(0,0,w,h);
        ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent')||"#2dd4bf";
        for(const p of res.points.slice(0,5000)){
          const x=Math.floor((p.x/res.s1Len)*w); const y=Math.floor((p.y/res.s2Len)*h);
          ctx.fillRect(x,y,2,2);
        }
      }
    },
    aiExplain(context){
      const s=this.guard(1); if(!s) return;
      const extra=context? "\n\nTool result:\n"+context.slice(0,2000):"";
      const prompt="You are a bioinformatics expert. Explain this result concisely with biological meaning, next steps, and one code snippet if useful:"+extra+"\n\nSequence: "+s.slice(0,2000);
      closeTools(); send(prompt);
    },
    sendToChat(){
      const s=this.guard(1); if(!s) return;
      const check=BIO.checkAlphabet(s); const st=BIO.stats(s); const type=BIO.detectType(s);
      const facts=[]; facts.push(`- Type: ${type}`); facts.push(`- Length: ${st.length}`); facts.push(`- GC%: ${st.gc.toFixed(2)}%`); facts.push(`- Tm: ${st.tm?st.tm.toFixed(1)+" °C":"N/A"}`);
      if(check.invalid.length) facts.push(`- Invalid: ${check.invalid.slice(0,10).map(x=>`${x.ch}@${x.pos}`).join(", ")}`); else facts.push(`- Alphabet: valid`);
      if(type==="DNA"||type==="RNA"||type.startsWith("DNA")){
        try{ const orfs=BIO.findORFs(s,30); facts.push(`- ORFs ≥30 aa: ${orfs.length}`); if(orfs.length){ const lo=orfs[0]; facts.push(`- Longest ORF: ${lo.length} aa ${lo.strand===1?"+":"-"}${lo.frame} ${lo.start}-${lo.end}`); } const rm=BIO.restrictionMap(s); const cutEnz=rm.enzymes.filter(e=>e.count>0).slice(0,5).map(e=>`${e.name} ${e.count} cuts`).join("; "); if(cutEnz) facts.push(`- Restriction top: ${cutEnz}`);}catch{}
      } else if(type==="protein"){ try{ const pp=BIO.proteinProperties(s); facts.push(`- MW: ${pp.mw.toFixed(1)} Da`); facts.push(`- pI: ${pp.pI.toFixed(2)}`); facts.push(`- GRAVY: ${pp.gravy.toFixed(3)}`);}catch{} }
      const bullet=facts.join("\n");
      const trunc=s.slice(0,4000)+(s.length>4000?"\n… (truncated)":"");
      const content=`Values already computed locally (trust these, don't recompute):\n${bullet}\n\nAnalyze the following ${check.type} sequence:\n\n\`\`\`\n${trunc}\n\`\`\``;
      closeTools(); send(content);
    },
  };

  function openTools(){ $("#toolsPanel").classList.add("open"); if(isNarrow()) setSidebar(false); tools.update(); }
  function closeTools(){ const p=$("#toolsPanel"); p.classList.remove("open"); p.classList.remove("fullscreen"); document.body.classList.remove("tools-fullscreen"); }
  function toolsOpen(){ return $("#toolsPanel").classList.contains("open"); }
  function toggleToolsFullscreen(){
    const p=$("#toolsPanel");
    const isFull=p.classList.contains("fullscreen");
    p.classList.toggle("fullscreen", !isFull);
    document.body.classList.toggle("tools-fullscreen", !isFull);
    const btn=$("#toolsFullscreen");
    if(btn){ btn.title=isFull?"Fullscreen tools":"Exit fullscreen"; btn.innerHTML=isFull? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3"/></svg>'; }
  }

  /* Settings */
  function openSettings(){
    const s=Settings.get();
    $("#setApiMode").value=s.apiMode; $("#setProxyUrl").value=s.proxyUrl; $("#setGroqKey").value=s.groqKey;
    const gh=$("#setGithubKey"); if(gh) gh.value=s.githubKey||""; const or=$("#setOpenrouterKey"); if(or) or.value=s.openrouterKey||""; const ce=$("#setCerebrasKey"); if(ce) ce.value=s.cerebrasKey||""; const ge=$("#setGeminiKey"); if(ge) ge.value=s.geminiKey||""; const mi=$("#setMistralKey"); if(mi) mi.value=s.mistralKey||""; const po=$("#setPollinationsKey"); if(po) po.value=s.pollinationsKey||"";
    $("#setLocalUrl").value=s.localBaseUrl; $("#setLocalKey").value=s.localKey;
    $("#setTemp").value=s.temperature; $("#tempVal").textContent=s.temperature.toFixed(2); $("#setMaxTokens").value=s.maxTokens; $("#setStreaming").checked=s.streaming; $("#setSmart").checked=s.smartDefaults; $("#setCustomModel").value=s.customModel; $("#setSystem").value=s.systemPrompt;
    const langSel=$("#setLang"); if(langSel) langSel.value=s.lang||"en"; const hc=$("#setHighContrast"); if(hc) hc.checked=!!s.highContrast; const lt=$("#setLargeText"); if(lt) lt.checked=!!s.largeText;
    syncSettingsUI(s); $("#settingsModal").classList.add("open");
  }
  function closeSettings(){ $("#settingsModal").classList.remove("open"); }
  function syncSettingsUI(s){
    const mode=s.apiMode;
    const map={ groqKeyRow:["groq","byok"], proxyRow:["proxy"], localRow:["local"], localKeyRow:["local"], githubRow:["github"], openrouterRow:["openrouter"], cerebrasRow:["cerebras"], geminiRow:["gemini"], mistralRow:["mistral"], pollinationsRow:["pollinations"] };
    for(const id in map){ const el=$(`#${id}`); if(el) el.style.display=map[id].includes(mode)?"":"none"; }
  }
  function saveSettings(){
    const next=Settings.set({
      apiMode:$("#setApiMode").value, proxyUrl:$("#setProxyUrl").value.trim(),
      groqKey:$("#setGroqKey").value.trim(), githubKey:$("#setGithubKey")?.value.trim()||"", openrouterKey:$("#setOpenrouterKey")?.value.trim()||"", cerebrasKey:$("#setCerebrasKey")?.value.trim()||"", geminiKey:$("#setGeminiKey")?.value.trim()||"", mistralKey:$("#setMistralKey")?.value.trim()||"", pollinationsKey:$("#setPollinationsKey")?.value.trim()||"",
      localBaseUrl:$("#setLocalUrl").value.trim(), localKey:$("#setLocalKey").value.trim(),
      temperature:Number($("#setTemp").value), maxTokens:Math.min(8192,Math.max(256,Number($("#setMaxTokens").value)||4096)),
      streaming:$("#setStreaming").checked, smartDefaults:$("#setSmart").checked, customModel:$("#setCustomModel").value.trim(), systemPrompt:$("#setSystem").value,
      lang:$("#setLang")?.value||"en", highContrast:$("#setHighContrast")?.checked||false, largeText:$("#setLargeText")?.checked||false,
    });
    syncSettingsUI(next); applyAccessibility(); applyI18n(); renderModelSelect(); renderComposerStatus(); toast("Settings saved"); closeSettings();
    if(["local","github","openrouter","cerebras","gemini","mistral","pollinations"].includes(next.apiMode)){ window.API.listModels().then(ids=>{ state.models=ids; renderModelSelect(); }).catch(()=>{}); } else { state.models=[]; renderModelSelect(); }
    if(state.chat){ state.chat.model=modelInUse(); persistChat(); renderMessages(); }
  }
  function resetSettings(){ if(!confirm("Reset all settings to defaults?")) return; localStorage.removeItem("bioinfogpt_settings_v1"); state.models=[]; toast("Settings reset"); closeSettings(); renderComposerStatus(); applyAccessibility(); applyI18n(); }

  const SUGGESTIONS=["Explain FASTQ vs FASTA and write Python to convert one to the other","Biopython script to translate a DNA sequence and find ORFs","DESeq2 vs edgeR: when should I use each?","Write Python to compute GC content and reverse complement","How do I run a BLAST search programmatically?","What is multiple-testing correction (BH-FDR) and when to apply it?"];
  function renderSuggestions(){ const wrap=$("#suggestions"); if(!wrap) return; wrap.innerHTML=""; SUGGESTIONS.forEach(t=>{ const btn=el("button","chip-suggestion",t); btn.type="button"; btn.addEventListener("click",()=>send(t)); wrap.appendChild(btn); }); }
  function autoGrow(){ const ta=$("#composer textarea"); if(!ta) return; ta.style.height="auto"; ta.style.height=Math.min(200,ta.scrollHeight)+"px"; }

  /* File handling */
  function initFileHandling(){
    const overlay=$("#dropOverlay"); const fileInput=$("#fileInput"); const fileBtn=$("#fileBtn");
    const showOverlay=()=>{ if(overlay) overlay.classList.remove("hidden"); };
    const hideOverlay=()=>{ if(overlay) overlay.classList.add("hidden"); };
    ["dragenter","dragover"].forEach(ev=>{ document.addEventListener(ev,e=>{ e.preventDefault(); showOverlay(); }); });
    ["dragleave","drop"].forEach(ev=>{ document.addEventListener(ev,e=>{ if(ev==="drop") return; if(e.target===overlay||!e.relatedTarget) hideOverlay(); }); });
    if(overlay) overlay.addEventListener("dragover",e=>e.preventDefault());
    if(overlay) overlay.addEventListener("drop",e=>{ e.preventDefault(); hideOverlay(); const files=e.dataTransfer?.files; if(files&&files[0]) handleFile(files[0]); });
    document.addEventListener("drop",e=>{ e.preventDefault(); hideOverlay(); const files=e.dataTransfer?.files; if(files&&files[0]) handleFile(files[0]); });
    if(fileBtn&&fileInput){ fileBtn.addEventListener("click",()=>fileInput.click()); fileInput.addEventListener("change",()=>{ if(fileInput.files&&fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value=""; }); }
  }
  function handleFile(file){
    const reader=new FileReader();
    reader.onload=()=>{ const text=String(reader.result||""); const type=BIO.detectFileType(text); toast(`Loaded ${file.name} (${type}, ${text.length} chars)`); const ta=$("#seqInput"); const inputTa=$("#composer textarea");
      // if fasta/fastq/genbank/csv, put in seq tools
      if(["fasta","dna","protein","genbank","fastq_maybe","csv"].includes(type) || text.trim().startsWith(">") || text.length>20){
        if(ta){ ta.value=text.slice(0,20000); openTools(); tools.update(); }
        // also offer to send to chat
        if(type==="csv"||type==="text"||text.length<500){
          if(inputTa) inputTa.value=`Analyze this ${type} file ${file.name}:\n\n\`\`\`\n${text.slice(0,4000)}\n\`\`\``;
        }
      } else {
        if(inputTa) inputTa.value=text.slice(0,4000);
      }
      autoGrow();
    };
    reader.onerror=()=>toast("Failed to read file","error");
    if(file.size>5_000_000){ toast("File too large, reading first 5MB"); const slice=file.slice(0,5_000_000); reader.readAsText(slice); } else reader.readAsText(file);
  }

  /* Voice */
  let recognition=null, recognizing=false;
  function initVoice(){
    const voiceBtn=$("#voiceBtn"); if(!voiceBtn) return;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ voiceBtn.title="Voice not supported in this browser (try Chrome)"; voiceBtn.style.opacity="0.5"; return; }
    recognition=new SR(); recognition.continuous=false; recognition.interimResults=true; recognition.lang=Settings.get().lang==='hi'?'hi-IN':'en-US';
    recognition.onstart=()=>{ recognizing=true; voiceBtn.classList.add("recording"); voiceBtn.innerHTML='<span class="mic-wave"><i></i><i></i><i></i></span>'; };
    recognition.onend=()=>{ recognizing=false; voiceBtn.classList.remove("recording"); voiceBtn.innerHTML='<svg width="18" height="18"><use href="#icoMic"/></svg>'; };
    recognition.onerror=(e)=>{ toast(`Mic error: ${e.error}`,"error"); recognizing=false; voiceBtn.classList.remove("recording"); voiceBtn.innerHTML='<svg width="18" height="18"><use href="#icoMic"/></svg>'; };
    recognition.onresult=(e)=>{
      const ta=$("#composer textarea"); if(!ta) return;
      let interim=""; let final="";
      for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) final+=r[0].transcript; else interim+=r[0].transcript; }
      if(final){ ta.value=(ta.value+" "+final).trim(); autoGrow(); }
      else if(interim){ ta.placeholder=interim; }
    };
    voiceBtn.addEventListener("click",()=>{
      if(recognizing){ try{ recognition.stop(); }catch{} return; }
      try{ recognition.lang=Settings.get().lang==='hi'?'hi-IN':'en-US'; recognition.start(); }catch(e){ toast("Mic start failed","error"); }
    });
  }

  /* PWA */
  function initPWA(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').then(()=>console.log('SW registered')).catch(()=>{});
    }
  }

  /* Prompt library */
  const PROMPTS=[
    {title:"FASTA to FASTQ converter", prompt:"Explain FASTQ vs FASTA and write Python to convert FASTA to FASTQ (Biopython). Include quality scores dummy.", cat:"format"},
    {title:"ORF finder", prompt:"Biopython script to find all ORFs ≥30 aa in 6 frames, translate, and plot ORF lengths.", cat:"orf"},
    {title:"GC & RC", prompt:"Write Python to compute GC content, AT content, reverse complement, and Tm for a DNA sequence.", cat:"stats"},
    {title:"BLAST search", prompt:"How do I run BLAST search programmatically with Biopython? Include NCBIWWW.qblast example and parsing.", cat:"blast"},
    {title:"DESeq2 vs edgeR", prompt:"DESeq2 vs edgeR: when should I use each for RNA-seq differential expression? Provide R code for both.", cat:"rna"},
    {title:"Multiple testing", prompt:"What is Benjamini-Hochberg FDR and when to apply it? Provide Python and R examples.", cat:"stats"},
    {title:"Primer design", prompt:"Design PCR primers for the given DNA: criteria length 18-24, Tm 55-65°C, GC 40-60%, avoid hairpins. Provide 3 pairs and in-silico PCR.", cat:"primer"},
    {title:"Restriction digest", prompt:"Perform restriction digest analysis for EcoRI, BamHI, HindIII. Show fragments and gel simulation in Python.", cat:"digest"},
    {title:"MSA with MUSCLE", prompt:"Write Python to run MUSCLE alignment on multi-FASTA and visualize MSA with Biopython.", cat:"msa"},
    {title:"Dot-plot", prompt:"Write Python to generate dot-plot for two sequences (window 10, threshold 8) with matplotlib.", cat:"dotplot"},
    {title:"Protein properties", prompt:"Compute protein MW, pI, GRAVY, aliphatic index, extinction coefficient using Biopython ProtParam.", cat:"protein"},
    {title:"Codon usage", prompt:"Analyze codon usage bias for a CDS: count codons, calculate RSCU, plot.", cat:"codon"},
    {title:"VCF parsing", prompt:"Parse VCF file, filter QUAL>30, count variants per chromosome, Python with pysam.", cat:"ngs"},
    {title:"BAM QC", prompt:"Write shell pipeline with samtools flagstat, idxstats, and quick QC for BAM.", cat:"ngs"},
    {title:"Phylogenetics", prompt:"Build phylogenetic tree from aligned FASTA using Biopython + IQ-TREE, visualize with ete3.", cat:"phylo"},
    {title:"RNA-seq QC", prompt:"FastQC + MultiQC pipeline in bash, plus Python to parse MultiQC report.", cat:"rna"},
    {title:"CRISPR gRNA design", prompt:"Design CRISPR gRNAs for a gene: find NGG PAMs, score GC, off-target check logic in Python.", cat:"crispr"},
    {title:"Motif finder", prompt:"Find motifs with IUPAC ambiguity (e.g. GAATTC) on both strands, allow overlapping, Python regex.", cat:"motif"},
    {title:"GFF parsing", prompt:"Parse GFF3, extract CDS, translate to protein, handle phase, Python.", cat:"annotation"},
    {title:"Metagenomics", prompt:"Quick Kraken2 + Bracken pipeline for metagenomics classification, summarize.", cat:"meta"},
  ];
  function renderPromptLibrary(){
    const body=$("#promptBody"); if(!body) return; body.innerHTML="";
    const grid=el("div","prompt-grid");
    PROMPTS.forEach(p=>{
      const card=el("div","prompt-card"); const b=el("b","",p.title); const span=el("span","",`${p.cat} — ${p.prompt.slice(0,80)}…`);
      const btn=el("button","btn-ghost sm","Use"); btn.addEventListener("click",()=>{ $("#promptModal").classList.remove("open"); send(p.prompt); });
      card.appendChild(b); card.appendChild(span); card.appendChild(btn); grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  /* Share */
  function shareChat(){
    if(!state.chat||!state.chat.messages.length){ toast("Nothing to share yet"); return; }
    try{
      const data=JSON.stringify(state.chat); const b64=btoa(unescape(encodeURIComponent(data))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
      const url=`${location.origin}${location.pathname}#share=${b64}`;
      $("#shareLink").value=url; $("#shareModal").classList.add("open");
    }catch{ toast("Share failed","error"); }
  }
  function loadShared(){
    const hash=location.hash||""; const m=hash.match(/share=([^&]+)/); if(!m) return;
    try{ const b64=m[1].replace(/-/g,"+").replace(/_/g,"/"); const json=decodeURIComponent(escape(atob(b64))); const chat=JSON.parse(json); if(chat&&chat.messages){ state.chat=chat; state.activeId=chat.id; Store.setActive(chat.id); persistChat(); renderAll(); toast("Shared chat loaded"); } }catch{ toast("Invalid share link","error"); }
  }

  function bindEvents(){
    const sendBtn=$("#sendBtn"); if(sendBtn) sendBtn.addEventListener("click",()=>send());
    const stopBtn=$("#stopBtn"); if(stopBtn) stopBtn.addEventListener("click",stop);
    const newChatBtn=$("#newChatBtn"); if(newChatBtn) newChatBtn.addEventListener("click",newChat);
    const heroToolsBtn=$("#heroToolsBtn"); if(heroToolsBtn) heroToolsBtn.addEventListener("click",openTools);
    const btnCopyResult=$("#btnCopyResult"); if(btnCopyResult) btnCopyResult.addEventListener("click",()=>{ const text=$("#seqResultText").textContent; navigator.clipboard?.writeText(text).then(()=>toast("Copied"),()=>toast("Copy failed","error")); });
    const exportBtn=$("#exportBtn"); if(exportBtn) exportBtn.addEventListener("click",exportChat);
    const exportPdfBtn=$("#exportPdfBtn"); if(exportPdfBtn) exportPdfBtn.addEventListener("click",exportPdf);
    const settingsBtn=$("#settingsBtn"); if(settingsBtn) settingsBtn.addEventListener("click",openSettings);
    const toolsBtn=$("#toolsBtn"); if(toolsBtn) toolsBtn.addEventListener("click",openTools);
    const menuBtn=$("#menuBtn"); if(menuBtn) menuBtn.addEventListener("click",toggleSidebar);
    const closeSidebarBtn=$("#closeSidebar"); if(closeSidebarBtn) closeSidebarBtn.addEventListener("click",()=>setSidebar(false));
    const sideNewChat=$("#sideNewChat"); if(sideNewChat) sideNewChat.addEventListener("click",()=>{ newChat(); if(isNarrow()) setSidebar(false); });
    const scrim=$("#scrim"); if(scrim) scrim.addEventListener("click",()=>setSidebar(false));
    const closeToolsBtn=$("#closeTools"); if(closeToolsBtn) closeToolsBtn.addEventListener("click",closeTools);
    const themeBtn=$("#themeBtn"); if(themeBtn) themeBtn.addEventListener("click",()=>{ const next=UI.get().theme==="dark"?"light":"dark"; applyTheme(next); UI.set({theme:next}); });
    const convoSearch=$("#convoSearch"); if(convoSearch) convoSearch.addEventListener("input",debounce(e=>{ state.query=e.target.value; renderSidebar(); },120));
    const scrollDown=$("#scrollDown"); if(scrollDown) scrollDown.addEventListener("click",()=>scrollBottom(true));
    const chat=chatEl(); if(chat) chat.addEventListener("scroll",()=>{ const c=chatEl(); const far=c.scrollHeight-c.scrollTop-c.clientHeight>220; $("#scrollDown")?.classList.toggle("hidden",!far); });
    window.addEventListener("resize",debounce(()=>{ const sc=$("#scrim"); if(sc) sc.hidden=!(sidebarOpen()&&isNarrow()); },150));
    const clearConvos=$("#clearConvos"); if(clearConvos) clearConvos.addEventListener("click",()=>{ if(!confirm("Delete all chat history?")) return; state.convos=[]; Store.save([]); state.chat=null; ensureChat(); persistChat(); renderAll(); toast("History cleared"); });
    const closeSettings=$("#closeSettings"); if(closeSettings) closeSettings.addEventListener("click",()=>$("#settingsModal").classList.remove("open"));
    const saveSettingsBtn=$("#saveSettings"); if(saveSettingsBtn) saveSettingsBtn.addEventListener("click",saveSettings);
    const resetSettingsBtn=$("#resetSettings"); if(resetSettingsBtn) resetSettingsBtn.addEventListener("click",resetSettings);
    const apiModeSel=$("#setApiMode"); if(apiModeSel) apiModeSel.addEventListener("change",e=>{ syncSettingsUI({...Settings.get(),apiMode:e.target.value}); });
    const setTemp=$("#setTemp"); if(setTemp) setTemp.addEventListener("input",()=>{ $("#tempVal").textContent=Number($("#setTemp").value).toFixed(2); });
    const modelSelect=$("#modelSelect"); if(modelSelect) modelSelect.addEventListener("change",e=>{ Settings.set({model:e.target.value}); renderComposerStatus(); if(state.chat){ state.chat.model=modelInUse(); persistChat(); } });
    const composerTa=$("#composer textarea"); if(composerTa){ composerTa.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }); composerTa.addEventListener("input",autoGrow); }
    const clearChatBtn=$("#clearChatBtn"); if(clearChatBtn) clearChatBtn.addEventListener("click",()=>{ if(!state.chat||!state.chat.messages.length) return; if(!confirm("Clear this conversation?")) return; state.chat.messages=[]; persistChat(); renderAll(); });
    const btnCloseCodon=$("#btnCloseCodon"); if(btnCloseCodon) btnCloseCodon.addEventListener("click",()=>$("#codonModal").classList.remove("open"));
    const codonModal=$("#codonModal"); if(codonModal) codonModal.addEventListener("click",e=>{ if(e.target.id==="codonModal") e.target.classList.remove("open"); });
    const langToggle=$("#langToggle"); if(langToggle) langToggle.addEventListener("click",()=>{ const cur=Settings.get().lang||"en"; const next=cur==="en"?"hi":"en"; Settings.set({lang:next}); applyI18n(); $("#langLabel").textContent=next==="hi"?"En / हि":"हि / En"; toast(next==="hi"?"हिन्दी में बदला":"Switched to English"); });
    const shortcutsBtn=$("#shortcutsBtn"); if(shortcutsBtn) shortcutsBtn.addEventListener("click",()=>$("#shortcutsModal").classList.add("open"));
    const closeShortcuts=$("#closeShortcuts"); if(closeShortcuts) closeShortcuts.addEventListener("click",()=>$("#shortcutsModal").classList.remove("open"));
    const promptLibBtn=$("#promptLibBtn"); if(promptLibBtn) promptLibBtn.addEventListener("click",()=>{ renderPromptLibrary(); $("#promptModal").classList.add("open"); });
    const closePrompt=$("#closePrompt"); if(closePrompt) closePrompt.addEventListener("click",()=>$("#promptModal").classList.remove("open"));
    const shareBtn=$("#shareBtn"); if(shareBtn) shareBtn.addEventListener("click",shareChat);
    const closeShare=$("#closeShare"); if(closeShare) closeShare.addEventListener("click",()=>$("#shareModal").classList.remove("open"));
    const copyShare=$("#copyShareLink"); if(copyShare) copyShare.addEventListener("click",()=>{ const inp=$("#shareLink"); if(inp){ navigator.clipboard.writeText(inp.value).then(()=>toast("Link copied")); } });
    const shortcutsModal=$("#shortcutsModal"); if(shortcutsModal) shortcutsModal.addEventListener("click",e=>{ if(e.target.id==="shortcutsModal") e.target.classList.remove("open"); });
    const promptModal=$("#promptModal"); if(promptModal) promptModal.addEventListener("click",e=>{ if(e.target.id==="promptModal") e.target.classList.remove("open"); });
    const shareModal=$("#shareModal"); if(shareModal) shareModal.addEventListener("click",e=>{ if(e.target.id==="shareModal") e.target.classList.remove("open"); });
    document.addEventListener("keydown",e=>{
      const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if(e.key==="Escape"){
        if($("#codonModal")?.classList.contains("open")){ $("#codonModal").classList.remove("open"); return; }
        if($("#settingsModal")?.classList.contains("open")){ $("#settingsModal").classList.remove("open"); return; }
        if($("#promptModal")?.classList.contains("open")){ $("#promptModal").classList.remove("open"); return; }
        if($("#shortcutsModal")?.classList.contains("open")){ $("#shortcutsModal").classList.remove("open"); return; }
        if($("#shareModal")?.classList.contains("open")){ $("#shareModal").classList.remove("open"); return; }
        if(toolsOpen()){ closeTools(); return; }
        if(sidebarOpen()&&isNarrow()){ setSidebar(false); return; }
      }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="b"){ e.preventDefault(); toggleSidebar(); }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); if(!sidebarOpen()) setSidebar(true); $("#convoSearch")?.focus(); }
      if(!typing&&e.key==="/"){ e.preventDefault(); $("#composer textarea")?.focus(); }
      if(!typing&&e.key==="?"){ e.preventDefault(); $("#shortcutsModal")?.classList.add("open"); }
    });
    const settingsModal=$("#settingsModal"); if(settingsModal) settingsModal.addEventListener("click",e=>{ if(e.target.id==="settingsModal") e.target.classList.remove("open"); });
    window.addEventListener("settingschange",()=>{ renderComposerStatus(); applyAccessibility(); applyI18n(); });
  }

  async function init(){
    if(typeof marked!=="undefined") marked.setOptions({gfm:true,breaks:true});
    const ui=UI.get(); applyTheme(ui.theme); setSidebar(isNarrow()?false:ui.sidebar,false); applyAccessibility(); applyI18n();
    renderSuggestions(); bindEvents(); tools.init(); initFileHandling(); initVoice(); initPWA();
    const last=state.convos.find(c=>c.id===state.activeId);
    state.chat=last||{id:uid(),title:"New chat",ts:Date.now(),model:Settings.get().model,messages:[]};
    state.activeId=state.chat.id; Store.setActive(state.activeId); persistChat(); renderAll(); autoGrow();
    $("#composer textarea")?.focus();
    if(["local","github","openrouter","cerebras","gemini","mistral","pollinations"].includes(Settings.get().apiMode)){
      window.API.listModels().then(ids=>{ state.models=ids; renderModelSelect(); }).catch(()=>{});
    }
    loadShared();
  }

  let booted=false;
  function boot(){ if(booted) return; booted=true; init(); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();
