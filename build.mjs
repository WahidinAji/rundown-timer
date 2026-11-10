import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'

const root = new URL('./', import.meta.url)
const output = new URL('dist/', root)
const files = ['index.html', 'viewer.html', ...(await readdir(new URL('src/', root))).filter((file) => /\.(js|css)$/.test(file)).map((file) => `src/${file}`)]
const assets = new Map()
for (const file of files) {
  let content = await readFile(new URL(file, root), 'utf8')
  if (file.endsWith('.html')) content = content.replace('</head>', '  <script type="module" src="/src/offline.js"></script>\n</head>')
  assets.set(`/${file}`, content)
}
const hash = createHash('sha256')
for (const [path, content] of [...assets].sort()) hash.update(path).update(content)
const template = await readFile(new URL('sw.template.js', root), 'utf8')
hash.update(template)
const version = hash.digest('hex').slice(0, 16)
const worker = template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify([...assets.keys()].map((path) => path === '/index.html' ? '/' : path === '/viewer.html' ? '/viewer' : path)))
await rm(output, { recursive: true, force: true })
await mkdir(new URL('src/', output), { recursive: true })
for (const [path, content] of assets) await writeFile(new URL(path.slice(1), output), content)
await writeFile(new URL('sw.js', output), worker)
await writeFile(new URL('_headers', output), '/sw.js\n  Cache-Control: no-cache\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n')
console.log(`Built ${assets.size} files, offline cache ${version}`)
