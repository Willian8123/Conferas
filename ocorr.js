// Funções compartilhadas das páginas do Alerta Fábrica.
(function () {
  const KEY = "ocorr_fabricas_v1";
  const RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

  function load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(a)) return [];
      return a
        .filter((f) => f && f.nome && f.email)
        .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { sensitivity: "base" }));
    } catch (e) {
      return [];
    }
  }
  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Aceita um ou vários e-mails separados por vírgula, ponto e vírgula ou espaço.
  function parseEmails(str) {
    const list = String(str || "").split(/[;,\s]+/).filter(Boolean);
    return { list, ok: list.length > 0 && list.every((e) => RE.test(e)) };
  }

  // ---------- fábricas no servidor (valem para todos) ----------
  const CACHE = "alerta_fab_cache_v1";
  const lerCache = () => { try { const a = JSON.parse(localStorage.getItem(CACHE) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  // Devolve { lista: [{id, nome, emails[]}], offline }. Sem internet usa a última cópia.
  async function fabricas() {
    try {
      const l = await window.RV.rpc("fab_listar");
      const lista = Array.isArray(l) ? l : [];
      try { localStorage.setItem(CACHE, JSON.stringify(lista)); } catch (e) {}
      return { lista, offline: false };
    } catch (e) {
      if (e.rede) return { lista: lerCache(), offline: true };
      throw e;
    }
  }
  const tkLista = (l) => (l || []).slice().sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { sensitivity: "base" }));
  window.Ocorr = { load, save, esc, parseEmails, fabricas, lerCache, tkLista };
})();
