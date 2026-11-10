import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('build includes only app assets and registers offline caching on both pages', async () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root })
  const first = await readFile(new URL('dist/sw.js', root), 'utf8')
  execFileSync(process.execPath, ['build.mjs'], { cwd: root })
  assert.equal(await readFile(new URL('dist/sw.js', root), 'utf8'), first)
  assert.deepEqual((await readdir(new URL('dist/', root))).sort(), ['_headers', 'index.html', 'src', 'sw.js', 'viewer.html'])
  for (const page of ['index.html', 'viewer.html']) {
    assert.match(await readFile(new URL(`dist/${page}`, root), 'utf8'), /src="\/src\/offline.js"/)
  }

  const handlers = {}
  const requests = []
  let claimed = false
  const deleted = []
  vm.runInNewContext(first, {
    URL,
    self: {
      location: { origin: 'https://timer.example' },
      clients: { claim: async () => { claimed = true } },
      addEventListener: (name, callback) => { handlers[name] = callback },
    },
    caches: {
      open: async () => ({ addAll: async (paths) => requests.push(...paths), match: async (path) => `cached:${path}` }),
      keys: async () => ['unrelated-cache', 'rundown-offline-old'],
      delete: async (key) => deleted.push(key),
    },
    fetch: () => { throw new Error('Should use the cache') },
  })
  await new Promise((resolve, reject) => handlers.install({ waitUntil: (promise) => promise.then(resolve, reject) }))
  assert.ok(requests.includes('/') && requests.includes('/viewer'))
  assert.ok(requests.includes('/src/core.js'))
  await new Promise((resolve, reject) => handlers.activate({ waitUntil: (promise) => promise.then(resolve, reject) }))
  assert.equal(claimed, true)
  assert.deepEqual(deleted, ['rundown-offline-old'])
  for (const [url, path] of [['/viewer.html?screen=2', '/viewer'], ['/viewer?preview', '/viewer'], ['/index.html', '/']]) {
    let result
    handlers.fetch({ request: { method: 'GET', url: `https://timer.example${url}` }, respondWith: (promise) => { result = promise } })
    assert.equal(await result, `cached:${path}`)
  }
})
