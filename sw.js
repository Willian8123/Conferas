// Service worker: deixa o app funcionar offline.
// Ao alterar qualquer arquivo, aumente a versão abaixo para o celular atualizar.
const VERSION = "rotinas-v18";
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
