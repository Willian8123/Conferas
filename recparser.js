// Leitor da lista colada pelo Controle.
// Aceita a lista em uma linha só (como vem do WhatsApp) ou uma por linha:
//   25174 51 ICE BALADA GFA VD 275ML CX24 25178 51 ICE LIMAO GFA VD 275ML CX24 ...
// Cada item começa em um CÓDIGO: número de 5 ou 6 dígitos, ou de 3 a 4 dígitos que exista no catálogo.
// Números do meio do nome (51, 275ML, 750 ML, CX 24) não são tomados por código.
(function () {
  const UNID = /^(ml|l|lt|g|kg|cx|un|und|c|sh|pet|tp|gfa)$/i;
  const soDigitos = (t) => /^\d+$/.test(t);

  // catalogo: Map(código -> nome). Retorna { itens, repetidos, ignorado, foraCatalogo }.
  function ler(texto, catalogo) {
    const cat = catalogo || new Map();
    const limpo = String(texto == null ? "" : texto).replace(/[​-‍﻿]/g, "").replace(/ /g, " ");
    // tokens com a informação "começa uma linha"
    const toks = [];
    limpo.split(/\r\n|\r|\n/).forEach((linha) => {
      linha.split(/[\s;|\t]+/).map((x) => x.replace(/^,+|,+$/g, "")).filter(Boolean).forEach((t, i) => toks.push({ t, ini: i === 0 }));
    });
    const ehCodigo = (k) => {
      const t = toks[k].t;
      if (!soDigitos(t)) return false;
      if (t.length >= 5 && t.length <= 6) return true;
      if (t.length >= 3 && t.length <= 4 && cat.has(t)) {
        const prox = toks[k + 1] && toks[k + 1].t, ant = toks[k - 1] && toks[k - 1].t;
        if (prox && UNID.test(prox)) return false;          // "750 ML"
        if (ant && /^(cx|c|c\/|sh|x)$/i.test(ant)) return false; // "CX 1000"
        return true;
      }
      return false;
    };
    const itens = [], visto = new Set();
    let repetidos = 0, ignorado = "", atual = null, foraCatalogo = 0;
    const fechar = () => {
      if (!atual) return;
      const cod = atual.cod, nomeColado = atual.nome.join(" ").replace(/\s+/g, " ").trim();
      if (visto.has(cod)) { repetidos++; atual = null; return; }
      visto.add(cod);
      const noCat = cat.has(cod);
      if (!noCat) foraCatalogo++;
      itens.push({ cod, nome: noCat ? cat.get(cod) : (nomeColado || cod), noCatalogo: noCat, colado: nomeColado });
      atual = null;
    };
    for (let k = 0; k < toks.length; k++) {
      if (ehCodigo(k)) { fechar(); atual = { cod: toks[k].t, nome: [] }; }
      else if (atual) atual.nome.push(toks[k].t);
      else ignorado += (ignorado ? " " : "") + toks[k].t;
    }
    fechar();
    return { itens, repetidos, ignorado, foraCatalogo };
  }

  // Divide em blocos seguidos, o mais igual possível (31 em 2 -> 16 e 15). Mantém a ordem.
  function dividir(lista, k) {
    const n = lista.length, partes = [];
    if (!k || k < 1) return partes;
    const base = Math.floor(n / k), resto = n % k;
    let i = 0;
    for (let j = 0; j < k; j++) { const q = base + (j < resto ? 1 : 0); partes.push(lista.slice(i, i + q)); i += q; }
    return partes;
  }
  window.RecParser = { ler, dividir };
  if (typeof module !== "undefined") module.exports = window.RecParser;
})();
