// Decrypts the brand book on demand. Requests under ./app/ are mapped to encrypted files under ./e/.
// The key is a non-extractable CryptoKey held in IndexedDB, written by the login screen.
const BASE = new URL('./', self.location).pathname
const APP = BASE + 'app/'
const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
  mp4: 'video/mp4', pdf: 'application/pdf',
}
const enc = new TextEncoder()
let cfg = null

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

function getKey() {
  return new Promise((resolve) => {
    const open = indexedDB.open('brand-gate', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('k')
    open.onerror = () => resolve(null)
    open.onsuccess = () => {
      const get = open.result.transaction('k').objectStore('k').get('key')
      get.onsuccess = () => resolve(get.result || null)
      get.onerror = () => resolve(null)
    }
  })
}

async function nameFor(rel) {
  if (!cfg) cfg = await (await fetch(BASE + 'config.json', {cache: 'no-store'})).json()
  const salt = Uint8Array.from(atob(cfg.salt), (c) => c.charCodeAt(0))
  const data = new Uint8Array(salt.length + enc.encode(rel).length)
  data.set(salt, 0)
  data.set(enc.encode(rel), salt.length)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40) + '.bin'
}

async function serve(rel) {
  const key = await getKey()
  if (!key) return Response.redirect(BASE, 302)
  let res
  try {
    res = await fetch(BASE + 'e/' + (await nameFor(rel)), {cache: 'no-store'})
  } catch (err) {
    return new Response('Offline', {status: 503})
  }
  if (!res.ok) return new Response('Not found', {status: 404})
  const buf = await res.arrayBuffer()
  try {
    const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf.slice(0, 12)}, key, buf.slice(12))
    const ext = rel.split('.').pop().toLowerCase()
    return new Response(plain, {headers: {'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store'}})
  } catch (err) {
    return Response.redirect(BASE + '#expired', 302) // the key no longer matches (password changed)
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP)) return
  let rel = decodeURIComponent(url.pathname.slice(APP.length))
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'
  event.respondWith(serve(rel))
})
