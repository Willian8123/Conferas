/* Feed: avisos, enquetes, comentários e curtidas. Tudo passa por funções do Supabase (parte 8). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const VISTO = "feed_visto_v1", FOTOS = "feed_fotos_v1";
  let eu = RV.perfilCache() || {};
  let posts = [];
  const abertos = new Set();          // posts com comentários abertos
  const comentarios = {};             // id do post -> lista
  const ordem = {};                   // id do post -> "curtidos" | "recentes"
  const votantes = {};                // id do post -> lista (só admin)

  // ---------- utilidades ----------
  function aviso(id, txt) { const e = $(id); if (!e) return; e.textContent = txt || ""; e.classList.toggle("hidden", !txt); }
  function quando(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "agora";
    if (s < 3600) return "há " + Math.floor(s / 60) + " min";
    if (s < 86400) return "há " + Math.floor(s / 3600) + " h";
    const d = Math.floor(s / 86400);
    return d === 1 ? "ontem" : "há " + d + " dias";
  }
  function restam(iso) {
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return d <= 1 ? "sai do ar hoje" : "sai do ar em " + d + " dias";
  }
  const erroTxt = (e) => (e && e.message) || "Algo deu errado. Tente de novo.";
  async function chamar(fn, args) {
    try { return await RV.rpc(fn, args || {}); }
    catch (e) {
      if (e.status === 400 && /JWT|login|expired/i.test(e.message || "")) { await RV.sair(); location.replace("entrar.html?volta=feed.html"); }
      throw e;
    }
  }

  // ---------- fotos de perfil (guardadas no aparelho; só baixa quando mudou) ----------
  function fotosLer() { try { return JSON.parse(localStorage.getItem(FOTOS) || "{}"); } catch (e) { return {}; } }
  let fotos = fotosLer();
  function fotosGravar() {
    try { localStorage.setItem(FOTOS, JSON.stringify(fotos)); }
    catch (e) { fotos = {}; try { localStorage.removeItem(FOTOS); } catch (e2) {} } // sem espaço: recomeça
  }
  const av = (nome, mat, extra) => Foto.avatar(nome, fotos[mat] && fotos[mat].img, extra);
  async function garantirFotos(lista) { // lista: [{mat, t}]
    const faltam = [], visto = new Set();
    lista.forEach((x) => {
      if (!x.t || visto.has(x.mat)) return; visto.add(x.mat);
      if (!fotos[x.mat] || fotos[x.mat].t !== x.t) faltam.push(x.mat);
    });
    let mudou = false;
    for (let i = 0; i < faltam.length; i += 40) {
      try {
        const r = await chamar("feed_fotos", { p_matriculas: faltam.slice(i, i + 40) });
        Object.keys(r || {}).forEach((m) => { fotos[m] = r[m]; mudou = true; });
      } catch (e) { break; }
    }
    if (mudou) { fotosGravar(); document.querySelectorAll("[data-fm]").forEach(pintarAvatar); }
  }
  function pintarAvatar(el) {
    const m = el.getAttribute("data-fm"), f = fotos[m];
    if (!f || !f.img) return;
    const nome = el.getAttribute("data-nome") || "";
    const t = document.createElement("div"); t.innerHTML = Foto.avatar(nome, f.img, el.getAttribute("data-x") || "");
    const n = t.firstChild; n.setAttribute("data-fm", m); n.setAttribute("data-nome", nome); n.setAttribute("data-x", el.getAttribute("data-x") || "");
    el.replaceWith(n);
  }
  const avHtml = (nome, mat, extra) => {
    const h = av(nome, mat, extra);
    return h.replace(/^<(\w+)/, '<$1 data-fm="' + esc(mat) + '" data-nome="' + esc(nome) + '" data-x="' + esc(extra || "") + '"');
  };

  // ---------- imagens dos posts (IndexedDB: cada imagem é baixada uma vez por aparelho) ----------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((ok) => {
      try {
        const r = indexedDB.open("feed_img_v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("img");
        r.onsuccess = () => ok(r.result); r.onerror = () => ok(null);
      } catch (e) { ok(null); }
    });
    return dbp;
  }
  const idb = (modo, f) => db().then((d) => d ? new Promise((ok) => {
    try { const t = d.transaction("img", modo), o = f(t.objectStore("img")); t.oncomplete = () => ok(o && o.result); t.onerror = () => ok(null); t.onabort = () => ok(null); } catch (e) { ok(null); }
  }) : null);
  const imgLer = (id) => idb("readonly", (s) => s.get(id));
  const imgGravar = (id, v) => idb("readwrite", (s) => s.put(v, id));
  async function imgLimpar(idsVivos) {
    const d = await db(); if (!d) return;
    try {
      const t = d.transaction("img", "readwrite"), s = t.objectStore("img"), rq = s.getAllKeys();
      rq.onsuccess = () => rq.result.forEach((k) => { if (!idsVivos.has(k)) s.delete(k); });
    } catch (e) {}
  }
  async function carregarImagem(div) {
    const id = +div.dataset.img;
    let src = await imgLer(id);
    if (!src) {
      try { src = await chamar("feed_imagem", { p_post: id }); if (src) imgGravar(id, src); }
      catch (e) { div.textContent = "Não consegui carregar a imagem."; return; }
    }
    if (!src) { div.remove(); return; }
    div.classList.remove("carregando"); div.innerHTML = '<img alt="Imagem do post" src="' + esc(src) + '">';
  }
  let obs = null;
  function observar() {
    const alvos = document.querySelectorAll(".fp-img.carregando");
    if (!("IntersectionObserver" in window)) { alvos.forEach(carregarImagem); return; }
    if (!obs) obs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { obs.unobserve(e.target); carregarImagem(e.target); } }), { rootMargin: "300px" });
    alvos.forEach((a) => obs.observe(a));
  }

  // ---------- desenho ----------
  function enqueteHtml(p) {
    const tot = (p.votos || []).reduce((a, b) => a + b, 0);
    let h = '<div class="enq">';
    p.opcoes.forEach((o, i) => {
      const n = p.votos[i] || 0, pc = tot ? Math.round((n * 100) / tot) : 0;
      h += `<button class="op ${p.meu_voto === i + 1 ? "on" : ""}" type="button" data-a="votar" data-p="${p.id}" data-o="${i + 1}"><i style="width:${pc}%"></i><span>${p.meu_voto === i + 1 ? "✓ " : ""}${esc(o)}</span><span class="n">${n} · ${pc}%</span></button>`;
    });
    h += `<div class="tot">${tot} ${tot === 1 ? "voto" : "votos"}${p.meu_voto ? " · você pode trocar o seu voto" : " · escolha uma opção"}</div>`;
    if (eu.admin) {
      h += `<button class="quem" type="button" data-a="quem" data-p="${p.id}">👥 Ver quem votou</button>`;
      if (votantes[p.id]) h += '<div class="lista">' + (votantes[p.id].length ? votantes[p.id].map((v) => esc(v.nome) + " (" + esc(v.matricula) + ") → " + esc(p.opcoes[v.opcao - 1])).join("<br>") : "Ninguém votou ainda.") + "</div>";
    }
    return h + "</div>";
  }
  function comentariosHtml(p) {
    const lista = comentarios[p.id];
    if (!lista) return '<p class="fc-vazio">Carregando comentários…</p>';
    const modo = ordem[p.id] || "curtidos";
    const max = Math.max(0, ...lista.map((c) => c.curtidas));
    const ord = lista.slice().sort(modo === "curtidos"
      ? (a, b) => b.curtidas - a.curtidas || new Date(a.criado_em) - new Date(b.criado_em)
      : (a, b) => new Date(b.criado_em) - new Date(a.criado_em));
    let h = `<div class="fc-ord"><button type="button" data-a="ordem" data-p="${p.id}" data-m="curtidos" class="${modo === "curtidos" ? "on" : ""}">🏆 Mais curtidos</button><button type="button" data-a="ordem" data-p="${p.id}" data-m="recentes" class="${modo === "recentes" ? "on" : ""}">🕒 Mais recentes</button></div>`;
    h += ord.map((c) => {
      const top = max > 0 && c.curtidas === max;
      return `<div class="fc ${top ? "top" : ""}" data-c="${c.id}">${avHtml(c.nome, c.matricula)}<div class="corpo">${top ? '<span class="trofeu">🏆 Mais curtido</span><br>' : ""}<b>${esc(c.nome)}</b><small>${quando(c.criado_em)}</small><p>${esc(c.texto)}</p>
        <div class="meta"><button type="button" class="${c.curti ? "on" : ""}" data-a="curtirc" data-c="${c.id}" data-p="${p.id}">👍 ${c.curti ? "Curtido" : "Curtir"} · ${c.curtidas}</button>${c.meu || eu.admin ? `<button type="button" data-a="apagarc" data-c="${c.id}" data-p="${p.id}">Apagar</button>` : ""}</div></div></div>`;
    }).join("") || '<p class="fc-vazio">Ainda não há comentários. Seja o primeiro!</p>';
    h += `<div class="fc-novo"><input type="text" maxlength="300" placeholder="Escreva um comentário…" data-p="${p.id}" id="ci${p.id}" autocomplete="off"><button type="button" data-a="comentar" data-p="${p.id}">Enviar</button></div><p class="fc-msg" id="cm${p.id}"></p>`;
    return h;
  }
  function postHtml(p) {
    const novo = +p.id > (+localStorage.getItem(VISTO) || 0) && p.autor_mat !== eu.matricula;
    return `<article class="fpost ${novo ? "novo" : ""}" data-id="${p.id}">
      <div class="fp-top">${avHtml(p.autor, p.autor_mat)}<div><b>${esc(p.autor)}<span class="fp-adm">ADM</span></b><small>${quando(p.criado_em)}${eu.admin ? " · " + restam(p.expira_em) : ""}</small></div></div>
      ${p.texto ? `<div class="fp-txt">${esc(p.texto)}</div>` : ""}
      ${p.tem_imagem ? `<div class="fp-img carregando" data-img="${p.id}">Carregando imagem…</div>` : ""}
      ${p.opcoes ? enqueteHtml(p) : ""}
      <div class="fp-act"><button type="button" class="${p.curti ? "on" : ""}" data-a="curtir" data-p="${p.id}">👍 ${p.curti ? "Curtido" : "Curtir"} · ${p.curtidas}</button>
        <button type="button" class="${abertos.has(p.id) ? "on" : ""}" data-a="comentarios" data-p="${p.id}">💬 ${p.comentarios}</button><span class="sp"></span>${eu.admin ? `<button type="button" class="del" data-a="apagar" data-p="${p.id}">🗑️ Apagar</button>` : ""}</div>
      <div class="fcom ${abertos.has(p.id) ? "" : "hidden"}" id="com${p.id}">${abertos.has(p.id) ? comentariosHtml(p) : ""}</div></article>`;
  }
  function desenhar() {
    $("lista").innerHTML = posts.length ? posts.map(postHtml).join("")
      : '<div class="fvazio"><div class="e">📭</div><p>Nenhum post por enquanto.</p></div>';
    observar();
  }
  function redesenharPost(id) {
    const p = posts.find((x) => x.id === id), el = document.querySelector('.fpost[data-id="' + id + '"]');
    if (!p || !el) return;
    // mantém a imagem já carregada
    const img = el.querySelector(".fp-img:not(.carregando)"), t = document.createElement("div"); t.innerHTML = postHtml(p);
    const novo = t.firstElementChild;
    if (img) { const alvo = novo.querySelector(".fp-img"); if (alvo) alvo.replaceWith(img); }
    const foco = document.activeElement && document.activeElement.id, val = foco && document.activeElement.value;
    el.replaceWith(novo);
    if (foco && $(foco)) { $(foco).value = val; $(foco).focus(); }
    novo.querySelectorAll("[data-fm]").forEach(pintarAvatar);
    observar();
  }

  // ---------- carregar ----------
  async function carregar(quieto) {
    aviso("erro", "");
    if (!quieto) $("lista").innerHTML = '<p class="rvsmall" style="text-align:center;margin:30px 0">Carregando…</p>';
    try {
      posts = (await chamar("feed_listar")) || [];
    } catch (e) {
      $("lista").innerHTML = "";
      aviso("erro", e.rede ? "Sem conexão. O Feed precisa de internet para abrir." : erroTxt(e) + (/function|schema cache|does not exist/i.test(e.message || "") ? " (O Feed ainda não foi ativado no Supabase: rode a parte 8.)" : ""));
      return;
    }
    desenhar();
    garantirFotos(posts.map((p) => ({ mat: p.autor_mat, t: p.autor_foto_t })));
    imgLimpar(new Set(posts.map((p) => p.id)));
    const maior = posts.reduce((a, p) => Math.max(a, +p.id), 0);
    setTimeout(() => { try { localStorage.setItem(VISTO, String(Math.max(maior, +localStorage.getItem(VISTO) || 0))); } catch (e) {} }, 2500);
  }
  async function carregarComentarios(id) {
    try {
      comentarios[id] = (await chamar("feed_comentarios", { p_post: id })) || [];
      const p = posts.find((x) => x.id === id); if (p) p.comentarios = comentarios[id].length;
      redesenharPost(id);
      garantirFotos(comentarios[id].map((c) => ({ mat: c.matricula, t: c.foto_t })));
    } catch (e) { const el = $("com" + id); if (el) el.innerHTML = '<p class="fc-msg">' + esc(erroTxt(e)) + "</p>"; }
  }

  // ---------- ações ----------
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, id = +b.dataset.p, p = posts.find((x) => x.id === id);
    try {
      if (a === "curtir" && p) {
        const r = await chamar("feed_curtir_post", { p_post: id }); p.curti = r.curti; p.curtidas = r.total; redesenharPost(id);
      } else if (a === "comentarios" && p) {
        if (abertos.has(id)) { abertos.delete(id); redesenharPost(id); }
        else { abertos.add(id); redesenharPost(id); carregarComentarios(id); }
      } else if (a === "votar" && p) {
        await chamar("feed_votar", { p_post: id, p_opcao: +b.dataset.o });
        const n = await chamar("feed_listar"); const novo = n.find((x) => x.id === id);
        if (novo) { p.votos = novo.votos; p.meu_voto = novo.meu_voto; if (votantes[id]) delete votantes[id]; redesenharPost(id); }
      } else if (a === "quem" && p) {
        votantes[id] = await chamar("feed_votantes", { p_post: id }); redesenharPost(id);
      } else if (a === "ordem") {
        ordem[id] = b.dataset.m; redesenharPost(id);
      } else if (a === "comentar") {
        const inp = $("ci" + id), txt = inp.value.trim(); if (!txt) return;
        b.disabled = true;
        try { await chamar("feed_comentar", { p_post: id, p_texto: txt }); inp.value = ""; await carregarComentarios(id); }
        catch (e) { const m = $("cm" + id); if (m) m.textContent = erroTxt(e); }
        finally { b.disabled = false; }
      } else if (a === "curtirc") {
        const r = await chamar("feed_curtir_comentario", { p_id: +b.dataset.c });
        const c = (comentarios[id] || []).find((x) => x.id === +b.dataset.c); if (c) { c.curti = r.curti; c.curtidas = r.total; redesenharPost(id); }
      } else if (a === "apagarc") {
        if (!confirm("Apagar este comentário?")) return;
        await chamar("feed_apagar_comentario", { p_id: +b.dataset.c }); await carregarComentarios(id);
      } else if (a === "apagar") {
        if (!confirm("Apagar este post para todo mundo? Os comentários e curtidas também somem.")) return;
        await chamar("feed_apagar_post", { p_post: id }); posts = posts.filter((x) => x.id !== id); desenhar();
      }
    } catch (e) { aviso("erro", e.rede ? "Sem conexão. Tente de novo." : erroTxt(e)); setTimeout(() => aviso("erro", ""), 6000); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".fc-novo input")) { e.preventDefault(); const b = e.target.parentNode.querySelector("button"); b && b.click(); }
  });
  $("bAtualizar").addEventListener("click", () => carregar(false));

  // ---------- novo post (só administrador) ----------
  let imgNova = null;
  function opsDesenhar(n) {
    const atual = Array.from($("nOps").querySelectorAll("input")).map((i) => i.value);
    $("nOps").innerHTML = Array.from({ length: n }, (_, i) => `<input type="text" maxlength="80" placeholder="Opção ${i + 1}" value="${esc(atual[i] || "")}">`).join("");
    $("nMais").classList.toggle("hidden", !$("nEnq").checked || n >= 6);
  }
  function limparForm() {
    $("nTxt").value = ""; $("nCont").textContent = "0"; imgNova = null; $("nPrev").classList.add("hidden"); $("nEnq").checked = false;
    $("nOps").classList.add("hidden"); $("nMais").classList.add("hidden"); aviso("nErro", "");
  }
  async function reduzirImagem(file, lado, limite) {
    if (!file || !/^image\//.test(file.type || "image/")) throw new Error("Escolha uma imagem.");
    let im;
    try { im = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) {
      im = await new Promise((ok, er) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => er(new Error("Não consegui abrir essa imagem.")); i.src = u; });
    }
    const w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, k = Math.min(1, lado / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) { const u = c.toDataURL("image/jpeg", q); if (u.length <= limite) return u; }
    throw new Error("Essa imagem ficou grande demais. Tente outra.");
  }
  let adminPronto = false;
  function prepararAdmin() {
    if (adminPronto || !eu.admin) return; adminPronto = true;
    $("bNovo").classList.remove("hidden");
    $("bNovo").addEventListener("click", () => { $("fNovo").classList.toggle("hidden"); if (!$("fNovo").classList.contains("hidden")) $("nTxt").focus(); });
    $("nCancel").addEventListener("click", () => { $("fNovo").classList.add("hidden"); limparForm(); });
    $("nTxt").addEventListener("input", () => { $("nCont").textContent = $("nTxt").value.length; });
    $("nEnq").addEventListener("change", () => { const on = $("nEnq").checked; $("nOps").classList.toggle("hidden", !on); if (on) opsDesenhar(Math.max(2, $("nOps").children.length)); else $("nMais").classList.add("hidden"); });
    $("nMais").addEventListener("click", () => opsDesenhar(Math.min(6, $("nOps").children.length + 1)));
    $("nArq").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
      aviso("nErro", "");
      try { imgNova = await reduzirImagem(f, 960, 220000); $("nImg").src = imgNova; $("nPrev").classList.remove("hidden"); }
      catch (er) { aviso("nErro", erroTxt(er)); }
    });
    $("nImgX").addEventListener("click", () => { imgNova = null; $("nPrev").classList.add("hidden"); });
    $("fNovo").addEventListener("submit", async (e) => {
      e.preventDefault(); aviso("nErro", "");
      const txt = $("nTxt").value.trim();
      if (!txt && !imgNova) return aviso("nErro", "Escreva um texto ou adicione uma imagem.");
      let opc = null;
      if ($("nEnq").checked) { opc = Array.from($("nOps").querySelectorAll("input")).map((i) => i.value.trim()).filter(Boolean); if (opc.length < 2) return aviso("nErro", "A enquete precisa de pelo menos 2 opções."); }
      $("nPub").disabled = true;
      try {
        await chamar("feed_postar", { p_texto: txt, p_imagem: imgNova, p_opcoes: opc });
        $("fNovo").classList.add("hidden"); limparForm(); await carregar(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (er) { aviso("nErro", er.rede ? "Sem conexão. Tente de novo." : erroTxt(er)); }
      finally { $("nPub").disabled = false; }
    });
  }
  function reler() { eu = RV.perfilCache() || eu; const antes = adminPronto; prepararAdmin(); if (!antes && adminPronto && posts.length) desenhar(); }
  window.addEventListener("acesso-ok", reler);
  reler();
  carregar(false).then(reler);
  setTimeout(reler, 2500);
})();
