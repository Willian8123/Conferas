// Leitor de planilhas direto no navegador (sem bibliotecas): .xlsx e .csv.
// Resultado: { colunas: [nomes], linhas: [ {coluna: valor} ] }
(function () {
  async function inflar(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const utf8 = (u8) => new TextDecoder("utf-8").decode(u8);

  function abrirZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("O arquivo não parece ser um .xlsx válido.");
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const arq = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      arq[utf8(u8.subarray(p + 46, p + 46 + nl))] = { metodo: dv.getUint16(p + 10, true), tam: dv.getUint32(p + 20, true), pos: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    return {
      tem: (nome) => !!arq[nome],
      async ler(nome) {
        const f = arq[nome];
        if (!f) return null;
        const nl = dv.getUint16(f.pos + 26, true), el = dv.getUint16(f.pos + 28, true);
        const ini = f.pos + 30 + nl + el;
        const dados = u8.subarray(ini, ini + f.tam);
        if (f.metodo === 0) return utf8(dados);
        if (f.metodo === 8) return utf8(await inflar(dados));
        throw new Error("Compressão do .xlsx não suportada.");
      }
    };
  }

  const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
  const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const colIdx = (ref) => { const m = /^[A-Z]+/i.exec(ref)[0].toUpperCase(); let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  async function lerXlsx(buf) {
    const z = abrirZip(buf);
    const wb = xml(await z.ler("xl/workbook.xml"));
    const rels = xml(await z.ler("xl/_rels/workbook.xml.rels"));
    const abas = Array.from(wb.getElementsByTagName("sheet")).map((s) => ({ nome: s.getAttribute("name"), rid: s.getAttributeNS(NS_REL, "id") || s.getAttribute("r:id") }));
    if (!abas.length) throw new Error("A planilha não tem abas.");
    const aba = abas.find((a) => /^rv$/i.test(a.nome)) || abas[0];
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === aba.rid);
    let alvo = rel.getAttribute("Target").replace(/^\//, "");
    if (!alvo.startsWith("xl/")) alvo = "xl/" + alvo;

    const comp = [];
    if (z.tem("xl/sharedStrings.xml")) {
      const ss = xml(await z.ler("xl/sharedStrings.xml"));
      Array.from(ss.getElementsByTagName("si")).forEach((si) => comp.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent).join("")));
    }
    const folha = xml(await z.ler(alvo));
    const matriz = [];
    Array.from(folha.getElementsByTagName("row")).forEach((row) => {
      const linha = [];
      Array.from(row.getElementsByTagName("c")).forEach((c) => {
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
        let val = null;
        if (t === "s") val = v ? comp[+v.textContent] : null;
        else if (t === "inlineStr") val = Array.from(c.getElementsByTagName("t")).map((x) => x.textContent).join("");
        else if (t === "str") val = v ? v.textContent : null;
        else if (t === "b") val = v ? v.textContent === "1" : null;
        else if (v && v.textContent !== "") val = parseFloat(v.textContent);
        linha[colIdx(c.getAttribute("r") || "A1")] = val;
      });
      matriz.push(linha);
    });
    return matriz;
  }

  function lerCsv(texto) {
    texto = texto.replace(/^﻿/, "");
    const prim = texto.split(/\r?\n/)[0] || "";
    const cont = (ch) => prim.split(ch).length - 1;
    const sep = cont(";") >= cont(",") && cont(";") >= cont("\t") ? ";" : cont("\t") > cont(",") ? "\t" : ",";
    const m = []; let lin = [], cel = "", asp = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (asp) {
        if (ch === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
        else if (ch === '"') asp = false;
        else cel += ch;
      } else if (ch === '"') asp = true;
      else if (ch === sep) { lin.push(cel); cel = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && texto[i + 1] === "\n") i++; lin.push(cel); m.push(lin); lin = []; cel = ""; }
      else cel += ch;
    }
    if (cel !== "" || lin.length) { lin.push(cel); m.push(lin); }
    return m;
  }

  function matrizParaTabela(m) {
    m = m.filter((l) => l && l.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
    if (m.length < 2) throw new Error("A planilha precisa ter a linha de títulos e pelo menos uma linha de dados.");
    const idx = [], colunas = [];
    (m[0] || []).forEach((c, i) => {
      const nome = String(c == null ? "" : c).trim();
      if (nome && !colunas.includes(nome)) { colunas.push(nome); idx.push(i); }
    });
    const linhas = m.slice(1).map((l) => {
      const o = {};
      colunas.forEach((nome, k) => { const v = l[idx[k]]; o[nome] = typeof v === "string" ? v.trim() : (v === undefined ? null : v); });
      return o;
    });
    return { colunas, linhas };
  }

  async function lerArquivo(arquivo) {
    const nome = (arquivo.name || "").toLowerCase();
    const buf = await arquivo.arrayBuffer();
    if (nome.endsWith(".xlsx")) return matrizParaTabela(await lerXlsx(buf));
    if (nome.endsWith(".csv") || nome.endsWith(".txt")) {
      let t;
      try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder("windows-1252").decode(buf); }
      return matrizParaTabela(lerCsv(t));
    }
    throw new Error("Use um arquivo .xlsx ou .csv. (Se for .xls antigo, abra no Excel e salve como .xlsx.)");
  }

  // ---------- conversões ----------
  function paraNumero(v) {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (/^-?\d+([.,]\d+)?$/.test(s)) return parseFloat(s.replace(",", "."));
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", "."));
    if (/^R\$\s*-?[\d.]+(,\d+)?$/.test(s)) return parseFloat(s.replace(/[^\d,-]/g, "").replace(",", "."));
    if (/^-?\d+([.,]\d+)?\s*%$/.test(s)) return parseFloat(s.replace("%", "").replace(",", "."));
    return v;
  }
  function normMatricula(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
    return String(v).trim();
  }
  // Aceita "2026-10", "10/2026", "01/10/2026", data do Excel (número) e "out/2026".
  function normMes(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"); }
      return null;
    }
    const s = String(v).trim().toLowerCase();
    let m;
    if ((m = /^(\d{4})[-\/.](\d{1,2})/.exec(s))) return m[1] + "-" + m[2].padStart(2, "0");
    if ((m = /^(\d{1,2})[\/.-](\d{4})$/.exec(s))) return m[2] + "-" + m[1].padStart(2, "0");
    if ((m = /^\d{1,2}[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) return m[2] + "-" + m[1].padStart(2, "0");
    const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    if ((m = /^([a-zç]{3})[a-zç]*[\s\/.-]+(\d{2}|\d{4})$/.exec(s))) {
      const k = nomes.indexOf(m[1]);
      if (k >= 0) return (m[2].length === 2 ? "20" + m[2] : m[2]) + "-" + String(k + 1).padStart(2, "0");
    }
    return null;
  }

  window.RVPlanilha = { lerArquivo, lerXlsx, lerCsv, paraNumero, normMatricula, normMes };
})();
