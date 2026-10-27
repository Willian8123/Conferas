// Service worker: deixa o app funcionar offline.
// Ao alterar qualquer arquivo, aumente a versão abaixo para o celular atualizar.
const VERSION = "rotinas-v7";
const FILES = [
  "./",
  "./index.html",
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
  "./ocorrencias.html",
  "./chamado.html",
  "./fabricas.html",
  "./ocorr.css",
  "./paginas.css",
  "./ocorr.js",
  "./util.js",
  "./config.js",
  "./icon-192.png",
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
