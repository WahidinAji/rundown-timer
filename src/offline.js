// Only the Cloudflare build loads this module. The local Node server needs no cache.
if ('serviceWorker' in navigator) {
  const status = document.createElement('span')
  status.style.cssText = 'font-size:11px;color:#aaa;margin-left:8px'
  document.querySelector('h1')?.append(status)
  status.textContent = 'Preparing offline files'
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async (registration) => {
    await navigator.serviceWorker.ready
    status.textContent = 'Offline ready'
    status.title = 'This browser has cached the app. Keep this address for the event.'
    const check = () => {
      if (registration.waiting) {
        status.textContent = 'Update ready. Close all timer tabs to apply'
      }
    }
    check()
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', check)
    })
  }).catch(() => {
    status.textContent = 'Offline cache unavailable'
  })
}
