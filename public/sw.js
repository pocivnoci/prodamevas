const CACHE_NAME = 'chrlit-v3'
const OFFLINE_URL = '/offline.html'

// Assets to precache (app shell)
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/icon-192.png',
  '/icon-512.png',
  '/chrlit-logo.png',
  '/chrlit-logo-transparent.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET, API calls, auth requests, and non-HTTP requests
  if (request.method !== 'GET') return
  if (!request.url.startsWith('http')) return
  if (request.url.includes('/api/') || request.url.includes('/auth/')) return
  if (request.url.includes('supabase.co')) return

  // Navigace jde vždy na síť — nic se necachuje, aby nešlo narazit na starou
  // stránku nebo cizí přihlášení. Cache slouží jen jako záchrana, když síť
  // spadne: bez ní by nainstalovaná aplikace ukázala chybovou stránku prohlížeče.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
    return
  }

  if (!request.url.match(/\.(js|css|png|jpg|webp|svg|ico|woff2?)(\?|$)/)) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for static assets
        if (response.ok && response.type === 'basic' && (request.url.match(/\.(js|css|png|jpg|webp|svg|ico|woff2?)$/))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone).catch((err) => console.warn('SW cache put error:', err))
          })
        }
        return response
      })
      .catch(() => {
        // Offline fallback — serve from cache, or let browser handle natively
        return caches.match(request).then((cached) => {
          if (cached) return cached
          // No cache hit — return a proper error response instead of undefined
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
        })
      })
  )
})
