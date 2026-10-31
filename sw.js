// Service worker: deixa o app funcionar offline.
// Ao alterar qualquer arquivo, aumente a versão abaixo para o celular atualizar.
const VERSION = "rotinas-v24";
const FILES = [
  "./",
  "./index.html",
  "./logo-ambev.png",
  "./manifest.json",
  "./retorno.html",
  "./puxada.html",
  "./carregamento.html",
  "./controle.html",
  "./produtos.html",
  "./rotinas.html",
  "./procedimentos.html",
  "./referencias.html",
  "./checklist.html",
  "./contagem.html",
  "./contagem.css",
  "./produtos-dados.js",
  "./produtos-fonte.js",
  "./pdf-lib.min.js",
  "./ocorrencias.html",
  "./chamado.html",
  "./fabricas.html",
  "./ocorr.css",
  "./paginas.css",
  "./ocorr.js",
  "./util.js",
  "./config.js",
  "./rv.html",
  "./entrar.html",
  "./conferente.html",
  "./acesso.js",
  "./rv-admin.html",
  "./rv.css",
  "./rv.js",
  "./rv-config.js",
  "./rv-planilha.js",
  "./icon-192.png", "./apple-touch-icon.png", "./foto.js", "./conta.js", "./login.css", "./feed.html", "./feed.js", "./feed.css",
  "./recontrole.html", "./recparser.js", "./aviso.js",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Rede primeiro (pega atualização quando online), cache como reserva offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Nunca guarda no cache o que vem de fora do app (ex.: dados de RV vindos do Supabase).
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

// ---- Avisos (push) ----
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { corpo: e.data ? e.data.text() : "" }; }
  const titulo = d.titulo || "Embu Excelente";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || "Você tem uma nova recontagem.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || "recontagem",
    renotify: true,
    vibrate: [250, 120, 250],
    requireInteraction: true,
    data: { url: d.url || "./contagem.html" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || "./contagem.html", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ("focus" in c) { c.navigate(alvo).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(alvo);
  }));
});
