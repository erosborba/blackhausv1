/* Lumihaus SDR — Service Worker
 *
 * Estratégia deliberadamente conservadora:
 *   - HTML/páginas: NETWORK-FIRST com fallback pra cache (evita mostrar
 *     tela velha quando o corretor precisa ver lead novo);
 *   - Estáticos (/_next/static, /icons, fonts): CACHE-FIRST com revalidate
 *     em background;
 *   - API/supabase/evolution: NEVER cache (passa direto pra rede).
 *
 * A app é quase toda server-rendered + fetch pra APIs vivas — um SW
 * agressivo quebraria o inbox. O objetivo aqui é só: (a) habilitar
 * install PWA e (b) ter uma tela offline decente. Nada de background
 * sync/push ainda.
 */

const VERSION = "lh-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;

const PRECACHE = ["/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Mesmo origin só — nunca intercepta webhook/API externo (Supabase, Evolution).
  if (url.origin !== self.location.origin) return;

  // APIs internas: never cache. Sempre rede viva.
  if (url.pathname.startsWith("/api/")) return;

  // Estáticos do Next + ícones: cache-first + revalidate em background.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Navegações (HTML): network-first com fallback pra cache.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) {
    // Revalida em background, mas entrega o cache agora.
    fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Sem cache e sem rede — devolve erro de rede mesmo.
    return Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Última linha — página offline mínima inline.
    return new Response(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Offline · Lumihaus</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0b0b0d;color:#e7e7ea;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-weight:300;font-size:28px;margin:0 0 8px}p{color:#8f8f9a;font-size:14px;max-width:360px;line-height:1.55}</style></head><body><div><h1>Sem conexão</h1><p>Você está offline. Quando a conexão voltar, esta página vai recarregar automaticamente.</p></div><script>window.addEventListener("online",()=>location.reload())</script></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
    );
  }
}
