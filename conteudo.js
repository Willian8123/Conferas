// Carrega do servidor o conteúdo interno de uma página (só para quem está logado) e guarda uma cópia no aparelho.
// Uso: Conteudo.montar("procedimentos", elemento, depois)
(function () {
  const CK = (s) => "conteudo_v1_" + s;
  function lerCache(s) { try { const c = JSON.parse(localStorage.getItem(CK(s))); return c && typeof c.html === "string" ? c.html : null; } catch (e) { return null; } }
  function gravar(s, html) { try { localStorage.setItem(CK(s), JSON.stringify({ html: html, em: Date.now() })); } catch (e) {} }
  async function montar(slug, el, depois) {
    const c = lerCache(slug);
    if (c) { el.innerHTML = c; if (depois) depois(); }
    try {
      const r = await RV.rpc("conteudo_ler", { p_slug: slug });
      if (r && typeof r.html === "string") {
        if (r.html !== c) { el.innerHTML = r.html; gravar(slug, r.html); if (depois) depois(); }
      } else if (!c) {
        el.innerHTML = '<div class="empty">Conteúdo ainda não carregado no servidor. Peça ao administrador.</div>';
      }
    } catch (e) {
      if (!c) el.innerHTML = '<div class="empty">Não consegui carregar agora' + (e && e.rede ? " (sem internet)" : "") + '. Conecte-se e abra de novo.</div>';
    }
  }
  window.Conteudo = { montar: montar };
})();
