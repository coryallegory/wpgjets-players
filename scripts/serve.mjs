// Tiny static file server for the site/ directory. No dependencies.
// Usage: npm run serve  (PORT env var overrides the default 8000)

import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORT = Number(process.env.PORT) || 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function resolveRequestPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const filePath = path.join(SITE_DIR, decoded);
  const relative = path.relative(SITE_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return filePath;
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method Not Allowed');
  }

  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    let filePath = resolveRequestPath(pathname);
    if (!filePath) return sendText(res, 403, 'Forbidden');

    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    } else if (!info) {
      return sendText(res, 404, 'Not Found');
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    if (err.code === 'ENOENT') return sendText(res, 404, 'Not Found');
    console.error(err);
    sendText(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${SITE_DIR}`);
  console.log(`Open http://localhost:${PORT}/`);
});
