/* Foto de perfil. Precisa de rv.js carregado antes.
   A foto é reduzida no próprio celular (160×160, ~10 KB) e guardada na tabela "fotos".
   Para não gastar internet à toa, o app só pergunta a data da foto (poucos bytes)
   e baixa a imagem de novo apenas se ela mudou. */
(function () {
  const FK = "rv_foto_v1";
  const LADO = 160, MAX = 30000; // caracteres do data URL (o banco aceita até 40000)
  const enc = encodeURIComponent;
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function cache() { try { return JSON.parse(localStorage.getItem(FK) || "null"); } catch (e) { return null; } }
  function guardar(o) { try { o ? localStorage.setItem(FK, JSON.stringify(o)) : localStorage.removeItem(FK); } catch (e) {} }
  function minha() {
    const p = RV.perfilCache(), c = cache();
    return p && c && c.m === p.matricula ? c.img : null;
  }
  async function sincronizar() {
    const p = RV.perfilCache();
    if (!p || !RV.logado()) return null;
    const r = await RV.api("/rest/v1/fotos?select=atualizado_em&matricula=eq." + enc(p.matricula));
    if (!r || !r.length) { guardar(null); return null; }
    const c = cache();
    if (c && c.m === p.matricula && c.t === r[0].atualizado_em) return c.img;
    const f = await RV.api("/rest/v1/fotos?select=imagem,atualizado_em&matricula=eq." + enc(p.matricula));
    if (!f || !f.length) { guardar(null); return null; }
    guardar({ m: p.matricula, t: f[0].atualizado_em, img: f[0].imagem });
    return f[0].imagem;
  }

  function iniciais(nome) {
    const n = String(nome || "?").trim().split(/\s+/);
    return ((n[0] || "?")[0] + (n.length > 1 ? n[n.length - 1][0] : "")).toUpperCase();
  }
  function avatar(nome, img, extra) {
    return img ? `<img class="av ${extra || ""}" src="${esc(img)}" alt="">`
      : `<span class="av ini ${extra || ""}" aria-hidden="true">${esc(iniciais(nome))}</span>`;
  }

  async function carregarImagem(file) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
    return new Promise((ok, erro) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); ok(im); };
      im.onerror = () => { URL.revokeObjectURL(u); erro(new Error("Não consegui abrir essa imagem.")); };
      im.src = u;
    });
  }
  // recorta o quadrado do meio e reduz
  async function reduzir(file) {
    if (!file || !/^image\//.test(file.type || "image/")) throw new Error("Escolha uma imagem.");
    const im = await carregarImagem(file);
    const w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, lado = Math.min(w, h);
    const c = document.createElement("canvas"); c.width = c.height = LADO;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, LADO, LADO);
    x.drawImage(im, (w - lado) / 2, (h - lado) / 2, lado, lado, 0, 0, LADO, LADO);
    for (const q of [0.82, 0.72, 0.62, 0.5, 0.4]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= MAX) return url;
    }
    throw new Error("Não consegui reduzir essa foto. Tente outra.");
  }

  async function salvar(file) {
    const url = await reduzir(file);
    await RV.rpc("salvar_minha_foto", { p_imagem: url });
    const p = RV.perfilCache();
    let t = null;
    try { const r = await RV.api("/rest/v1/fotos?select=atualizado_em&matricula=eq." + enc(p.matricula)); t = r && r[0] && r[0].atualizado_em; } catch (e) {}
    guardar({ m: p.matricula, t, img: url });
    return url;
  }
  async function remover() {
    await RV.rpc("remover_minha_foto", {});
    guardar(null);
  }

  // ----- janelinha "Minha foto" -----
  let modal = null, aoMudar = null;
  function montar() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "fmodal hidden";
    modal.innerHTML = `<div class="fbox" role="dialog" aria-modal="true" aria-labelledby="fTit">
      <h2 id="fTit">Minha foto</h2>
      <div class="fprev" id="fPrev"></div>
      <p class="fmsg" id="fMsg"></p>
      <label class="btn primary full fpick" id="fPick">📷 Tirar ou escolher foto<input type="file" accept="image/*" id="fArq" hidden></label>
      <button class="btn full" id="fRem" type="button">Remover foto</button>
      <button class="btn full" id="fFechar" type="button">Fechar</button>
    </div>`;
    document.body.appendChild(modal);
    const $ = (i) => modal.querySelector("#" + i);
    const msg = (t, ruim) => { const m = $("fMsg"); m.textContent = t || ""; m.className = "fmsg" + (ruim ? " bad" : ""); };
    const pintar = () => {
      const p = RV.perfilCache() || {}, img = minha();
      $("fPrev").innerHTML = avatar(p.nome, img, "grande");
      $("fRem").style.display = img ? "" : "none";
    };
    modal._pintar = pintar;
    modal.addEventListener("click", (e) => { if (e.target === modal) fechar(); });
    $("fFechar").addEventListener("click", fechar);
    $("fArq").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      msg("Enviando…");
      try { await salvar(f); msg("Foto salva ✓"); pintar(); if (aoMudar) aoMudar(); }
      catch (er) { msg(er.message || "Não foi possível salvar a foto.", true); }
    });
    $("fRem").addEventListener("click", async () => {
      msg("Removendo…");
      try { await remover(); msg("Foto removida."); pintar(); if (aoMudar) aoMudar(); }
      catch (er) { msg(er.message || "Não foi possível remover.", true); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
    return modal;
  }
  function abrir(callback) {
    aoMudar = callback || null;
    const m = montar();
    m.querySelector("#fMsg").textContent = "";
    m._pintar();
    m.classList.remove("hidden");
  }
  function fechar() { if (modal) modal.classList.add("hidden"); }

  window.Foto = { minha, sincronizar, avatar, iniciais, abrir, fechar, reduzir };
})();
