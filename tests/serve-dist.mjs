import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', webp: 'image/webp' };
createServer(async (request, response) => {
  const match = /^\/sakstavla\/(index\.html|assets\/[\w.-]+)?$/.exec(request.url);
  if (match) {
    try {
      const path = match[1] ?? 'index.html';
      const body = await readFile(new URL('../dist/' + path, import.meta.url));
      response.writeHead(200, { 'Content-Type': types[path.split('.').pop()] }).end(body);
      return;
    } catch {
      // Return 404 for missing build assets.
    }
  }
  response.writeHead(404).end();
}).listen(4173, '127.0.0.1');
