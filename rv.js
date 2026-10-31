// Núcleo do sistema de RV: acesso ao Supabase (sem bibliotecas), formatação e desenho do painel.
(function () {
  const C = window.RV_CONFIG;
  const KEY = "rv_sessao_v1";
  const PK = "rv_perfil_v1";
  let mem = null;

  // ---------- sessão ----------
  function lerSessao() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { mem = null; }
    return mem;
  }
  function gravarSessao(s) {
    mem = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {}
    if (!s) { try { localStorage.removeItem(PK); localStorage.removeItem("rv_foto_v1"); } catch (e) {} }
  }
  // Cópia do perfil (nome, cargo, acessos) para abrir as telas mesmo sem internet.
  // Não guarda nenhum dado de RV.
  function perfilCache() {
    try { return JSON.parse(localStorage.getItem(PK) || "null"); } catch (e) { return null; }
  }
  function guardarPerfil(p) {
    try { localStorage.setItem(PK, JSON.stringify({ id: p.id, matricula: p.matricula, nome: p.nome, cargo: p.cargo, admin: !!p.admin, acessos: p.acessos || [] })); } catch (e) {}
  }
  function daResposta(r) {
    return {
      access_token: r.access_token, refresh_token: r.refresh_token,
      expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
      user_id: r.user && r.user.id
    };
  }

  async function chamar(caminho, o) {
    o = o || {};
    const h = Object.assign({ apikey: C.KEY }, o.headers || {});
    if (o.token) h.Authorization = "Bearer " + o.token;
    if (o.body !== undefined) h["Content-Type"] = "application/json";
    let r;
    try {
      r = await fetch(C.URL + caminho, { method: o.method || "GET", headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    } catch (e) {
      const err = new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
      err.rede = true; throw err;
    }
    let dados = null;
    const txt = await r.text();
    if (txt) { try { dados = JSON.parse(txt); } catch (e) { dados = txt; } }
    if (!r.ok) {
      const err = new Error((dados && (dados.message || dados.msg || dados.error_description || dados.error)) || ("Erro " + r.status));
      err.status = r.status; err.dados = dados; throw err;
    }
    return dados;
  }

  async function renovar() {
    const s = lerSessao();
    if (!s || !s.refresh_token) throw Object.assign(new Error("Sessão expirada."), { status: 401 });
    try {
      const r = await chamar("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token } });
      gravarSessao(daResposta(r));
    } catch (e) {
      if (!e.rede) gravarSessao(null);
      throw e;
    }
  }

  // chamada autenticada (renova o token se estiver perto de vencer; tenta de novo se der 401)
  async function api(caminho, o) {
    o = Object.assign({}, o);
    let s = lerSessao();
    if (!s) throw Object.assign(new Error("Faça login."), { status: 401 });
    if (s.expires_at - 30 < Date.now() / 1000) { await renovar(); s = lerSessao(); }
    o.token = s.access_token;
    try {
      return await chamar(caminho, o);
    } catch (e) {
      if (e.status === 401) {
        await renovar(); s = lerSessao(); o.token = s.access_token;
        return await chamar(caminho, o);
      }
      throw e;
    }
  }

  const emailDe = (mat) => String(mat).trim().toLowerCase() + "@" + C.DOMINIO;

  async function entrar(matricula, senha) {
    try {
      const r = await chamar("/auth/v1/token?grant_type=password", { method: "POST", body: { email: emailDe(matricula), password: senha } });
      gravarSessao(daResposta(r));
    } catch (e) {
      if (e.rede) throw e;
      if (e.status === 400 || e.status === 401) throw new Error("Matrícula ou senha incorretas.");
      if (e.status === 429) throw new Error("Muitas tentativas. Espere alguns minutos e tente de novo.");
      throw e;
    }
  }
  async function sair() {
    const s = lerSessao();
    gravarSessao(null);
    // este aparelho deixa de receber os avisos desta pessoa
    let ep = null; try { ep = localStorage.getItem("push_ep_v1"); localStorage.removeItem("push_ep_v1"); } catch (e) {}
    if (s && ep) { try { await chamar("/rest/v1/rpc/push_remover", { method: "POST", token: s.access_token, body: { p_endpoint: ep } }); } catch (e) {} }
    if (s) { try { await chamar("/auth/v1/logout", { method: "POST", token: s.access_token }); } catch (e) {} }
  }
  const logado = () => !!lerSessao();
  const userId = () => (lerSessao() || {}).user_id;

  async function trocarSenha(nova) {
    return api("/auth/v1/user", { method: "PUT", body: { password: nova } });
  }

  async function meuPerfil() {
    const r = await api("/rest/v1/perfis?select=*&id=eq." + encodeURIComponent(userId()));
    const p = r && r[0] || null;
    if (p) guardarPerfil(p);
    return p;
  }
  async function config() {
    const r = await api("/rest/v1/rv_config?select=config&id=eq.1");
    return r && r[0] && r[0].config || null;
  }
  async function dadosDe(matricula) {
    let q = "/rest/v1/rv_dados?select=mes,dados,atualizado_em&order=mes.desc";
    if (matricula) q += "&matricula=eq." + encodeURIComponent(matricula);
    return api(q);
  }
  const rpc = (nome, args) => api("/rest/v1/rpc/" + nome, { method: "POST", body: args });
  const funcao = (nome, corpo) => api("/functions/v1/" + nome, { method: "POST", body: corpo || {} });

  // ---------- formatação ----------
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  function mesLongo(m) { const p = String(m).split("-"); return (MESES[+p[1] - 1] || m) + " de " + p[0]; }
  function mesCurto(m) { const p = String(m).split("-"); return (MESES[+p[1] - 1] || "").slice(0, 3) + "/" + String(p[0]).slice(2); }
  const moeda = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const numero = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function dataHora(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // ---------- painel ----------
  // Calcula o "estado" de um indicador: quão perto da meta, e se é bom, quase ou ruim.
  function avaliar(ind, d) {
    const meta = num(d[ind.meta]), res = num(d[ind.resultado]);
    if (meta === null || res === null) return null;
    let razao;
    if (ind.menorMelhor) razao = res <= meta ? 1 : (res > 0 ? meta / res : 0);
    else razao = meta > 0 ? res / meta : (res >= meta ? 1 : 0);
    const pct = Math.max(0, Math.min(1, razao));
    const nivel = razao >= 1 ? "ok" : razao >= 0.9 ? "warn" : "bad";
    const texto = nivel === "ok" ? (ind.menorMelhor ? "Dentro do limite" : "Meta batida")
      : nivel === "warn" ? (ind.menorMelhor ? "Um pouco acima do limite" : "Quase lá") : (ind.menorMelhor ? "Acima do limite" : "Abaixo da meta");
    return { meta, res, pct, nivel, texto };
  }

  // Desenha o painel dentro de "el". estado = { mes } é guardado entre os desenhos.
  function painel(el, perfil, linhas, cfg, estado) {
    estado = estado || {};
    if (!linhas.length) {
      el.innerHTML = '<div class="callout yellow"><span class="ci">ℹ️</span><p>Ainda não há dados de RV para esta matrícula. Quando o administrador importar a planilha, eles aparecem aqui.</p></div>';
      return;
    }
    if (!estado.mes || !linhas.some((l) => l.mes === estado.mes)) estado.mes = linhas[0].mes;
    const i = linhas.findIndex((l) => l.mes === estado.mes);
    const atual = linhas[i], d = atual.dados || {};
    const anterior = linhas[i + 1];
    const val = num(d[cfg.valor]);
    const primeiro = String(perfil.nome || "").trim().split(/\s+/)[0] || "";

    let html = "";
    html += '<div class="rvmeses" role="tablist">' + linhas.map((l) =>
      `<button type="button" class="rvmes ${l.mes === estado.mes ? "on" : ""}" data-mes="${esc(l.mes)}">${esc(mesCurto(l.mes))}</button>`).join("") + "</div>";

    html += '<div class="rvhero"><div class="rvhl">' + esc(cfg.valorRotulo || "Sua RV") + " · " + esc(mesLongo(atual.mes)) + "</div>";
    html += '<div class="rvval">' + (val === null ? "—" : esc(moeda(val))) + "</div>";
    if (anterior && val !== null && num((anterior.dados || {})[cfg.valor]) !== null) {
      const dif = val - num(anterior.dados[cfg.valor]);
      if (Math.abs(dif) < 0.005) html += '<div class="rvdif">Igual ao mês anterior</div>';
      else html += `<div class="rvdif ${dif > 0 ? "up" : "down"}">${dif > 0 ? "▲" : "▼"} ${esc(moeda(Math.abs(dif)))} ${dif > 0 ? "a mais" : "a menos"} que em ${esc(mesLongo(anterior.mes))}</div>`;
    }
    html += "</div>";

    const inds = (cfg.indicadores || []).map((ind) => ({ ind, a: avaliar(ind, d) })).filter((x) => x.a);
    if (inds.length) {
      html += '<div class="sec">Indicadores</div><div class="rvcards">' + inds.map(({ ind, a }) => {
        const suf = ind.sufixo || "";
        return `<div class="rvcard ${a.nivel}"><div class="rvct">${esc(ind.nome)}</div>
          <div class="rvcv">${esc(numero(a.res))}${esc(suf)}</div>
          <div class="rvbar"><i style="width:${Math.round(a.pct * 100)}%"></i></div>
          <div class="rvcm">Meta: ${ind.menorMelhor ? "até " : ""}${esc(numero(a.meta))}${esc(suf)}</div>
          <div class="rvcs">${esc(a.texto)}</div></div>`;
      }).join("") + "</div>";
    }

    const comp = (cfg.composicao || []).map((c) => ({ c, v: num(d[c.campo]) })).filter((x) => x.v !== null);
    if (comp.length) {
      html += '<div class="sec">Como chegou nesse valor</div><div class="list rvcomp">' + comp.map(({ c, v }) =>
        `<div class="li"><div class="t">${esc(c.rotulo)}</div><b class="${c.sinal < 0 && v ? "neg" : ""}">${c.sinal < 0 && v ? "− " : ""}${esc(moeda(Math.abs(v)))}</b></div>`).join("") +
        (val !== null ? `<div class="li tot"><div class="t"><b>Total</b></div><b>${esc(moeda(val))}</b></div>` : "") + "</div>";
    }

    const hist = linhas.map((l) => ({ mes: l.mes, v: num((l.dados || {})[cfg.valor]) })).filter((x) => x.v !== null).reverse();
    if (hist.length > 1) {
      const max = Math.max.apply(null, hist.map((h) => h.v)) || 1;
      html += '<div class="sec">Histórico</div><div class="rvhist">' + hist.map((h) =>
        `<button type="button" class="rvb ${h.mes === estado.mes ? "on" : ""}" data-mes="${esc(h.mes)}" aria-label="${esc(mesLongo(h.mes))}: ${esc(moeda(h.v))}">
          <span class="rvbv">${esc(moeda(h.v).replace(/\s/g, " "))}</span><span class="rvbc"><i style="height:${Math.max(4, Math.round(h.v / max * 100))}%"></i></span><span class="rvbl">${esc(mesCurto(h.mes))}</span></button>`).join("") + "</div>";
    }

    html += `<p class="rvfoot">Atualizado em ${esc(dataHora(atual.atualizado_em))}. Em caso de dúvida sobre os valores, procure o seu gestor ou o RH.</p>`;
    el.innerHTML = html;
    el.querySelectorAll("[data-mes]").forEach((b) => b.addEventListener("click", () => {
      estado.mes = b.dataset.mes; painel(el, perfil, linhas, cfg, estado);
    }));
    return primeiro;
  }

  window.RV = { entrar, sair, logado, userId, perfilCache, guardarPerfil, trocarSenha, meuPerfil, config, dadosDe, rpc, funcao, api, emailDe, painel,
    esc, moeda, numero, num, mesLongo, mesCurto, dataHora };
})();
