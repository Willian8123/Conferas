// Avisos de recontagem para o conferente: bolinha vermelha, bipe e notificação push (Android).
// Usa rv-config.js e rv.js. Elementos com [data-rec-badge] mostram a quantidade de itens esperando.
(function () {
  const VISTO = "rec_visto_v2", CONT = "rec_cont_v2", EP = "push_ep_v1";
  const lerLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const gravarLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const perfil = () => { try { return RV.logado() ? RV.perfilCache() : null; } catch (e) { return null; } };
  const ehConferente = () => { const p = perfil(); return !!p && (p.admin || (p.acessos || []).includes("conferente")); };

  /* ---------- bolinha ---------- */
  let ultimoVisto = +(lerLS(VISTO) || 0), primeira = true, timer = null;
  function pintar(n) {
    document.querySelectorAll("[data-rec-badge]").forEach((el) => {
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.toggle("hidden", !n);
    });
  }
  function pintarSino(n) {
    document.querySelectorAll("[data-sino-badge]").forEach((el) => {
      el.textContent = n > 9 ? "9+" : String(n);
      el.classList.toggle("hidden", !n);
    });
  }
  // repinta com o último número guardado (a tela inicial se redesenha várias vezes)
  function repintar() {
    try { const c = JSON.parse(lerLS(CONT) || "null"); if (c) { pintarSino(c.nao_lidas || 0); if (ehConferente()) pintar(c.pend || 0); } } catch (e) {}
  }
  function bipe() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      const ctx = new A(), t0 = ctx.currentTime;
      [[880, 0], [1175, 0.18]].forEach(([f, d]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.3);
        o.start(t0 + d); o.stop(t0 + d + 0.32);
      });
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 800);
    } catch (e) {}
  }
  async function checar() {
    if (!perfil()) return null;
    let r;
    try { r = await RV.rpc("notif_contar"); } catch (e) { return null; }
    if (!r) return null;
    gravarLS(CONT, JSON.stringify(r));
    pintarSino(r.nao_lidas || 0);
    if (ehConferente()) pintar(r.pend || 0);
    // som só quando chega notificação nova com o app já aberto
    if (!primeira && r.nao_lidas > 0 && r.ultimo > ultimoVisto) { bipe(); window.dispatchEvent(new CustomEvent("rec-nova", { detail: r })); }
    if (r.ultimo > ultimoVisto) { ultimoVisto = r.ultimo; gravarLS(VISTO, String(ultimoVisto)); }
    primeira = false;
    return r;
  }
  function iniciar() {
    if (!perfil()) return;
    repintar();
    checar().then(() => sincronizarPush());
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) checar(); }, 45000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checar(); });
  }

  /* ---------- push ---------- */
  const suportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const iphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalado = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const chave = () => {
    const b = String(RV_CONFIG.VAPID_PUBLICA || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4)); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  async function registro() {
    if (!navigator.serviceWorker) return null;
    try { return (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("sw.js")); } catch (e) { return null; }
  }
  async function guardar(sub) {
    const j = sub.toJSON();
    await RV.rpc("push_salvar", { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    gravarLS(EP, sub.endpoint);
  }
  async function estado() {
    if (!suportado()) return iphone() && !instalado() ? "iphone-instalar" : "nao-suportado";
    if (Notification.permission === "denied") return "negado";
    if (Notification.permission !== "granted") return "inativo";
    const reg = await registro(); const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    return sub && lerLS(EP) === sub.endpoint ? "ativo" : "inativo-permitido";
  }
  async function ativar() {
    if (!suportado()) throw new Error("Este navegador não aceita avisos.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("As notificações foram bloqueadas. Libere nas configurações do navegador para este site.");
    const reg = await registro(); if (!reg) throw new Error("Não consegui preparar o app para avisos. Tente de novo.");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave() });
    await guardar(sub);
  }
  async function desativar() {
    const reg = await registro(); const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (sub) { try { await RV.rpc("push_remover", { p_endpoint: sub.endpoint }); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} }
    try { localStorage.removeItem(EP); } catch (e) {}
  }
  // Já tem permissão: só garante que o endereço deste aparelho está salvo para esta pessoa.
  async function sincronizarPush() {
    try {
      if (!suportado() || Notification.permission !== "granted" || !perfil()) return;
      const reg = await registro(); if (!reg) return;
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave() });
      if (lerLS(EP) !== sub.endpoint) await guardar(sub);
    } catch (e) {}
  }

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Cartão "Ativar avisos" (aparece dentro de um elemento).
  async function cartao(el) {
    if (!el || !perfil()) return;
    const e = await estado();
    let h = "";
    if (e === "ativo") h = '<div class="callout green"><span class="ci">🔔</span><p><b>Avisos ativados</b> neste aparelho.<br><button class="btn mini" data-av="off" type="button" style="margin-top:6px">Desativar</button></p></div>';
    else if (e === "negado") h = '<div class="callout yellow"><span class="ci">🔕</span><p>Os avisos estão <b>bloqueados</b> neste navegador. Para receber, libere as notificações deste site nas configurações do navegador.</p></div>';
    else if (e === "iphone-instalar") h = '<div class="callout yellow"><span class="ci">🔔</span><p>No iPhone, os avisos só funcionam com o app <b>adicionado à tela inicial</b> (Compartilhar → Adicionar à Tela de Início). Abra por lá e ative.</p></div>';
    else if (e === "nao-suportado") h = "";
    else h = '<div class="callout blue"><span class="ci">🔔</span><p><b>Receba avisos no celular</b> do Feed e das recontagens, mesmo com o app fechado.<br><button class="btn primary" data-av="on" type="button" style="margin-top:8px">🔔 Ativar avisos</button><span class="avmsg" style="display:block;font-size:13px;margin-top:6px"></span></p></div>';
    el.innerHTML = h;
    const on = el.querySelector('[data-av="on"]'), off = el.querySelector('[data-av="off"]');
    if (on) on.addEventListener("click", async () => {
      on.disabled = true;
      try { await ativar(); cartao(el); } catch (er) { on.disabled = false; const m = el.querySelector(".avmsg"); if (m) m.textContent = er.message || "Não foi possível ativar."; }
    });
    if (off) off.addEventListener("click", async () => { off.disabled = true; await desativar(); cartao(el); });
  }

  window.Aviso = { checar, pintar, pintarSino, repintar, bipe, estado, ativar, desativar, cartao, sincronizarPush, marcarVisto: (u) => { if (u > ultimoVisto) { ultimoVisto = u; gravarLS(VISTO, String(u)); } } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
