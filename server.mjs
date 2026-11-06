import http from 'node:http'
import { readFile } from 'node:fs/promises'

const port = Number(process.env.PORT || 4321)
const host = process.env.HOST || '127.0.0.1'
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
const pages = { '/': 'index.html', '/index.html': 'index.html', '/viewer.html': 'viewer.html' }

http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const file = pages[path] ?? (/^\/src\/[\w-]+\.(js|css)$/.test(path) ? path.slice(1) : null)
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found')
    return
  }
  try {
    const content = await readFile(new URL(file, import.meta.url))
    response.writeHead(200, {
      'Content-Type': types[file.slice(file.lastIndexOf('.'))],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, host, () => console.log(`Rundown timer: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`))
