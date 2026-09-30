// Local dev server: serves public/ and the same /api/album proxy as Vercel.
// Usage: node server.js   (PORT env var optional, default 3000)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAlbumRequest } from './lib/icloud.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/album') {
    const { status, headers, body } = await handleAlbumRequest(url.searchParams.get('token') || '');
    res.writeHead(status, headers).end(body);
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(root, rel));
    res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(process.env.PORT || 3000, () => {
  console.log(`Slideshow on http://localhost:${process.env.PORT || 3000}`);
});
