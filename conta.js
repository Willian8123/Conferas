/* Trocar a própria senha (qualquer pessoa logada). Precisa de rv.js carregado antes. */
(function () {
  let modal = null;
  function montar() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "fmodal hidden";
    modal.innerHTML = '<div class="fbox" role="dialog" aria-modal="true" aria-labelledby="cTit" style="text-align:left">' +
      '<h2 id="cTit" style="text-align:center">🔑 Trocar senha</h2>' +
      '<div class="field"><label for="cNova">Nova senha (mínimo 8 caracteres)</label><input id="cNova" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="cNova2">Repita a nova senha</label><input id="cNova2" type="password" autocomplete="new-password"></div>' +
      '<p class="fmsg" id="cMsg" style="text-align:center"></p>' +
      '<button class="btn primary full" id="cSalvar" type="button">Salvar nova senha</button>' +
      '<button class="btn full" id="cFechar" type="button">Fechar</button></div>';
    document.body.appendChild(modal);
    const $ = (i) => modal.querySelector("#" + i);
    const msg = (t, ruim) => { $("cMsg").textContent = t || ""; $("cMsg").className = "fmsg" + (ruim ? " bad" : ""); };
    modal.addEventListener("click", (e) => { if (e.target === modal) fechar(); });
    $("cFechar").addEventListener("click", fechar);
    $("cSalvar").addEventListener("click", async () => {
      const a = $("cNova").value, b = $("cNova2").value;
      if (a.length < 8) return msg("A senha precisa ter pelo menos 8 caracteres.", true);
      if (a !== b) return msg("As duas senhas não são iguais.", true);
      $("cSalvar").disabled = true; msg("Salvando…");
      try { await RV.trocarSenha(a); $("cNova").value = $("cNova2").value = ""; msg("Senha alterada com sucesso ✓"); }
      catch (e) { msg(e.message || "Não foi possível trocar a senha.", true); }
      finally { $("cSalvar").disabled = false; }
    });
    return modal;
  }
  function fechar() { if (modal) modal.classList.add("hidden"); }
  function abrir() {
    const m = montar();
    m.querySelector("#cMsg").textContent = ""; m.querySelector("#cNova").value = m.querySelector("#cNova2").value = "";
    m.classList.remove("hidden"); setTimeout(() => m.querySelector("#cNova").focus(), 50);
  }
  window.Conta = { abrirSenha: abrir };
})();
