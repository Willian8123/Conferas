// Utilidades comuns a todas as páginas: copiar código ao tocar e registrar o service worker.
document.addEventListener("click", function (e) {
  var c = e.target.closest(".code[data-c]");
  if (!c) return;
  var t = c.dataset.c;
  var done = function () {
    var old = c.textContent;
    c.classList.add("ok");
    c.textContent = "copiado!";
    setTimeout(function () { c.classList.remove("ok"); c.textContent = old; }, 900);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
  else done();
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}
