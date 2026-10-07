import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function requestHandler(req, res) {
  try {
    const urlPath = (req.url || '/').split('?')[0];

    // Health check endpoints for Cloud Run, Nginx, and Docker
    if (urlPath === '/healthz' || urlPath === '/_health' || urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK');
      return;
    }

    // Sanitize path against directory traversal
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');

    let candidateFile = null;

    // 1. Check dist directory
    const distPath = path.join(__dirname, 'dist', safePath);
    try {
      if (fs.existsSync(distPath)) {
        const stat = fs.statSync(distPath);
        if (stat.isFile()) candidateFile = distPath;
        else if (stat.isDirectory()) {
          const idx = path.join(distPath, 'index.html');
          if (fs.existsSync(idx) && fs.statSync(idx).isFile()) candidateFile = idx;
        }
      }
    } catch (e) {}

    // 2. Check root directory
    if (!candidateFile) {
      const rootPath = path.join(__dirname, safePath);
      try {
        if (fs.existsSync(rootPath)) {
          const stat = fs.statSync(rootPath);
          if (stat.isFile()) candidateFile = rootPath;
          else if (stat.isDirectory()) {
            const idx = path.join(rootPath, 'index.html');
            if (fs.existsSync(idx) && fs.statSync(idx).isFile()) candidateFile = idx;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback to index.html for SPA routing
    if (!candidateFile) {
      const distIndex = path.join(__dirname, 'dist', 'index.html');
      const rootIndex = path.join(__dirname, 'index.html');
      if (fs.existsSync(distIndex)) candidateFile = distIndex;
      else if (fs.existsSync(rootIndex)) candidateFile = rootIndex;
    }

    if (candidateFile && fs.existsSync(candidateFile)) {
      const ext = path.extname(candidateFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Support HEAD requests for liveness/readiness probes
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(candidateFile);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error streaming file');
        }
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    console.error('[KLYRO Server] Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}

// 1. Primary listener on port 3000 (required for Nginx reverse-proxy & AI Studio iframe)
const server3000 = http.createServer(requestHandler);
server3000.on('error', err => {
  console.warn('[KLYRO Server] Port 3000 notice:', err.message);
});
server3000.listen(3000, '0.0.0.0', () => {
  console.log('[KLYRO Server] Listening on 0.0.0.0:3000');
});

// 2. Secondary listener on assigned Cloud Run PORT (if different from 3000)
const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
if (envPort && envPort !== 3000) {
  const serverEnv = http.createServer(requestHandler);
  serverEnv.on('error', err => {
    // If port 8080 is already bound by Nginx, Nginx proxies to 3000 so this is harmless
    console.log(`[KLYRO Server] Port ${envPort} handled by proxy (${err.code || err.message})`);
  });
  serverEnv.listen(envPort, '0.0.0.0', () => {
    console.log(`[KLYRO Server] Also listening on 0.0.0.0:${envPort}`);
  });
}

process.on('SIGTERM', () => {
  try { server3000.close(); } catch (e) {}
  process.exit(0);
});
