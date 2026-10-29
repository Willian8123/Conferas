// Lista de produtos compartilhada (Produtos e Recontagem usam a mesma).
// Ordem de preferência: servidor (Supabase) -> cópia guardada no aparelho -> lista base do app (produtos-dados.js).
// Precisa de rv-config.js e rv.js carregados antes (para falar com o servidor).
(function () {
  const CK = "produtos_cache_v1";
  const estado = { fonte: "base", tabela: null, vazia: false, erro: null };
  const ouvintes = [];
  let lista = null;

  const base = () => (window.PRODUTOS || []).map((p) => [String(p[0]), String(p[1])]);
  function doCache() {
    try { const c = JSON.parse(localStorage.getItem(CK)); if (c && Array.isArray(c.itens) && c.itens.length) return c.itens; } catch (e) {}
    return null;
  }
  function gravarCache(l) { try { localStorage.setItem(CK, JSON.stringify({ em: Date.now(), itens: l })); } catch (e) {} }
  const avisar = () => ouvintes.forEach((f) => { try { f(); } catch (e) {} });

  (function iniciar() {
    const c = doCache();
    lista = c || base();
    estado.fonte = c ? "cache" : "base";
  })();

  const normCodigo = (c) => String(c == null ? "" : c).trim().replace(/\s+/g, "");
  const normNome = (n) => String(n == null ? "" : n).trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");

  function traduzir(e) {
    const m = String((e && e.message) || "");
    if (e && e.rede) return e;
    if (e && (e.status === 409 || /duplicate|unique|já existe/i.test(m))) return new Error("Já existe um produto com esse código.");
    if (/check constraint|violates check/i.test(m)) return new Error("Código (até 20 caracteres) e nome (até 120) são obrigatórios.");
    if (e && (e.status === 401 || e.status === 403 || /row-level security|permission denied/i.test(m))) return new Error("Seu login não tem permissão para alterar a lista de produtos.");
    return e;
  }

  // Quem pode alterar: conferente ou administrador (o banco também confere isso).
  function permitido() {
    try { const p = window.RV && RV.perfilCache(); return !!p && (p.admin || (p.acessos || []).includes("conferente")); } catch (e) { return false; }
  }

  async function carregar() {
    if (!window.RV || !RV.logado()) return estado;
    try {
      let out = [], off = 0;
      for (;;) {
        const r = await RV.api("/rest/v1/produtos?select=codigo,nome&order=nome.asc&limit=1000&offset=" + off);
        out = out.concat(r);
        if (r.length < 1000) break;
        off += 1000;
      }
      estado.tabela = true; estado.erro = null;
      if (out.length) {
        lista = out.map((x) => [x.codigo, x.nome]);
        gravarCache(lista);
        estado.fonte = "servidor"; estado.vazia = false;
      } else {
        estado.vazia = true;
        const c = doCache();
        lista = c || base(); estado.fonte = c ? "cache" : "base";
      }
    } catch (e) {
      estado.erro = e;
      // tabela inexistente (parte 6 do banco ainda não rodou) x sem conexão
      estado.tabela = (e.status === 404 || /relation|schema cache|does not exist/i.test(e.message || "")) ? false : null;
      estado.vazia = false;
    }
    avisar();
    return estado;
  }

  const editavel = () => estado.fonte === "servidor" && estado.tabela === true && permitido();
  const podeSemear = () => estado.vazia && estado.tabela === true && permitido();

  async function mudar(fn) {
    if (!permitido()) throw new Error("Seu login não tem permissão para alterar a lista de produtos.");
    if (estado.fonte !== "servidor") throw new Error("Conecte-se à internet e use a lista compartilhada para alterar produtos.");
    try { return await fn(); } catch (e) { throw traduzir(e); }
  }
  const sincronizaLocal = (nova) => { lista = nova; gravarCache(lista); estado.fonte = "servidor"; avisar(); };

  async function criar(codigo, nome) {
    const c = normCodigo(codigo), n = normNome(nome);
    if (!c || !n) throw new Error("Preencha o código e o nome.");
    if (lista.some((p) => p[0] === c)) throw new Error("Já existe um produto com esse código.");
    await mudar(() => RV.api("/rest/v1/produtos", { method: "POST", headers: { Prefer: "return=minimal" }, body: { codigo: c, nome: n } }));
    sincronizaLocal(lista.concat([[c, n]]).sort((a, b) => a[1].localeCompare(b[1], "pt-BR")));
    return [c, n];
  }
  async function atualizar(antigo, codigo, nome) {
    const c = normCodigo(codigo), n = normNome(nome);
    if (!c || !n) throw new Error("Preencha o código e o nome.");
    if (c !== antigo && lista.some((p) => p[0] === c)) throw new Error("Já existe um produto com esse código.");
    const r = await mudar(() => RV.api("/rest/v1/produtos?codigo=eq." + encodeURIComponent(antigo), { method: "PATCH", headers: { Prefer: "return=representation" }, body: { codigo: c, nome: n } }));
    if (!Array.isArray(r) || !r.length) throw new Error("Não consegui alterar: o produto não existe mais ou você não tem permissão. Atualize a página.");
    sincronizaLocal(lista.map((p) => (p[0] === antigo ? [c, n] : p)).sort((a, b) => a[1].localeCompare(b[1], "pt-BR")));
    return [c, n];
  }
  async function excluir(codigo) {
    const r = await mudar(() => RV.api("/rest/v1/produtos?codigo=eq." + encodeURIComponent(codigo), { method: "DELETE", headers: { Prefer: "return=representation" } }));
    if (!Array.isArray(r) || !r.length) throw new Error("Não consegui excluir: o produto não existe mais ou você não tem permissão. Atualize a página.");
    sincronizaLocal(lista.filter((p) => p[0] !== codigo));
  }
  // Envia a lista base (produtos-dados.js) para o servidor. Um único envio: ou entra tudo, ou nada.
  async function semear() {
    if (!podeSemear()) throw new Error("A lista compartilhada já foi criada ou você não tem permissão.");
    const itens = base();
    if (!itens.length) throw new Error("A lista base do app não carregou (produtos-dados.js).");
    try {
      await RV.api("/rest/v1/produtos", { method: "POST", headers: { Prefer: "return=minimal" }, body: itens.map((p) => ({ codigo: p[0], nome: normNome(p[1]) })) });
    } catch (e) { throw traduzir(e); }
    await carregar();
    return itens.length;
  }

  window.Catalogo = {
    lista: () => lista, estado, carregar, permitido, editavel, podeSemear, criar, atualizar, excluir, semear,
    aoMudar: (f) => ouvintes.push(f), normCodigo, normNome
  };
})();
