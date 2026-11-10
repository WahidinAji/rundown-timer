// build.mjs fills in the version and complete list of app files.
const CACHE = 'rundown-offline-__VERSION__'
const ASSETS = __ASSETS__

self.addEventListener('install', (event) => {
  // Install only if every file downloads. Keep the old version if any request fails.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
  // Do not skip waiting. An event may be running in another window.
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('rundown-offline-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Cloudflare redirects /viewer.html to /viewer. Both resolve to the same cached page.
  const path = url.pathname === '/viewer.html' ? '/viewer' : url.pathname === '/index.html' ? '/' : url.pathname
  if (!ASSETS.includes(path)) return
  // Ignore screen/preview query parameters. They affect rendering, not file contents.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    return await cache.match(path) ?? fetch(event.request)
  })())
})
