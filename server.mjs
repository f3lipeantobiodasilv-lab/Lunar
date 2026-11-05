/**
 * Servidor estático mínimo para o Lunar OS (zero dependências).
 *
 * Por que existe: o projeto usa ES Modules (`import`), que o navegador só
 * carrega via http(s) — abrir index.html com file:// quebra o boot.
 *
 *   node server.mjs            → http://localhost:3000
 *   PORT=8080 node server.mjs  → outra porta
 *
 * Bind em 0.0.0.0 para funcionar em previews/containers.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Versão única do projeto (lida do package.json) — usada pelo cliente para
// detectar que está rodando um build antigo em cache e se atualizar sozinho.
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
).version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

  // Impede sair da raiz do projeto.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  // Endpoint de versão: dinâmico, nunca cacheado. Fica antes do fs.stat
  // porque não corresponde a nenhum arquivo em disco.
  if (pathname === '/version.json') {
    const body = JSON.stringify({ version: VERSION });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — não encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    // no-store: durante o desenvolvimento o navegador não pode reaproveitar
    // CSS/JS antigos e mostrar uma versão velha da interface.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Lunar OS → http://localhost:${PORT}`);
});
