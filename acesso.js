// Guarda de acesso: coloque nas páginas protegidas, DEPOIS de rv-config.js e rv.js:
//   <script src="acesso.js" data-exigir="conferente"></script>
// data-exigir: "" (qualquer pessoa logada), "lobinho", "conferente", "ocorrencias" ou "admin".
// Funciona sem internet: usa a cópia do perfil salva no aparelho e atualiza quando há rede.
(function () {
  const alvo = (document.currentScript && document.currentScript.getAttribute("data-exigir")) || "";
  const arquivo = (location.pathname.split("/").pop() || "index.html");
  const oculta = document.createElement("style");
  oculta.id = "acessoOculta";
  oculta.textContent = "html{visibility:hidden}";
  document.head.appendChild(oculta);
  const mostrar = () => { const e = document.getElementById("acessoOculta"); if (e) e.remove(); };

  // Cada acesso vale só por si: "lobinho", "conferente" ou "ocorrencias". Administrador abre tudo.
  function pode(p, perm) {
    if (!p) return false;
    if (!perm) return true;
    if (p.admin) return true;
    if (perm === "admin") return false;
    return (p.acessos || []).includes(perm);
  }
  function irParaLogin() { location.replace("entrar.html?volta=" + encodeURIComponent(arquivo)); }
  function negado(p) {
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => negado(p)); return; }
    const nomes = { lobinho: "o Lobinho (RV)", conferente: "a área do Conferente", ocorrencias: "as Ocorrências", admin: "o painel de administrador" };
    document.body.innerHTML = '<div class="wrap"><div class="ico">⛔</div><h1>Sem acesso</h1>' +
      '<p class="sub">' + (p ? esc(p.nome) + ", seu login não tem permissão para abrir " : "Seu login não tem permissão para abrir ") + (nomes[alvo] || "esta página") + ".</p>" +
      '<div class="callout yellow"><p>Se isso for um engano, peça ao administrador para liberar o seu acesso.</p></div>' +
      '<div class="row"><a class="btn primary" href="index.html">Voltar ao início</a><button class="btn" id="acSair" type="button">Trocar de login</button></div></div>';
    document.getElementById("acSair").addEventListener("click", async () => { await RV.sair(); irParaLogin(); });
    mostrar();
  }
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function iniciar() {
    if (!RV.logado()) return irParaLogin();
    let p = RV.perfilCache();
    if (p) {
      if (!pode(p, alvo)) { negado(p); atualizar(true); return; }
      mostrar();
      atualizar(false);
    } else {
      try { p = await RV.meuPerfil(); }
      catch (e) { if (e.status === 400 || e.status === 401 || e.status === 403) { await RV.sair(); return irParaLogin(); } mostrar(); return; }
      if (!p) { await RV.sair(); return irParaLogin(); }
      if (!pode(p, alvo)) return negado(p);
      mostrar();
    }
    window.dispatchEvent(new CustomEvent("acesso-ok"));
  }
  // Atualiza o perfil em segundo plano (nome, cargo e acessos podem ter mudado).
  async function atualizar(jaNegado) {
    try {
      const novo = await RV.meuPerfil();
      if (!novo) { await RV.sair(); return irParaLogin(); }
      const ok = pode(novo, alvo);
      if (!ok && !jaNegado) negado(novo);
      else if (ok && jaNegado) location.reload();
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) { await RV.sair(); irParaLogin(); }
      // sem internet: segue com a cópia local
    }
  }
  window.Acesso = { pode, perfil: () => RV.perfilCache(), sair: async () => { await RV.sair(); location.href = "index.html"; } };
  iniciar();
})();
