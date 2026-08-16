/**
 * Servidor de producción: estáticos de OHIF + proxy al relay, en un origen.
 *
 * El visor es una SPA estática, pero no puede hablar con el relay por su
 * cuenta: el RELAY_REQUEST_TOKEN es una credencial de infraestructura
 * compartida y en el navegador quedaría a la vista de cualquiera con las
 * devtools. Acá vive sólo en el entorno del contenedor (Secret Manager).
 *
 * Servir ambas cosas desde el mismo origen tiene un segundo beneficio: no hay
 * CORS que configurar en el relay, ni preflights por cada imagen.
 *
 *   /api/*  → relay (con el token)
 *   /*      → dist/, con fallback a index.html para las rutas de la SPA
 *
 * Variables:
 *   RELAY_REQUEST_TOKEN  (obligatoria)  token del relay
 *   RELAY_BASE           https://relay.cui.date
 *   PUBLIC_ORIGIN        origen público, p.ej. https://ohif.cui.date
 *   DIST_DIR             ./dist
 *   PORT                 8080 (Cloud Run lo inyecta)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const RELAY = new URL(process.env.RELAY_BASE ?? 'https://relay.cui.date');
const TOKEN = process.env.RELAY_REQUEST_TOKEN ?? '';
const DIST = process.env.DIST_DIR ?? './dist';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? '';

const upstreamModule = RELAY.protocol === 'http:' ? http : https;
const upstreamPort = RELAY.port || (RELAY.protocol === 'http:' ? 80 : 443);

// Sólo lo que el visor necesita. /admin y /agent quedan fuera aunque el token
// los abriría: no hay razón para exponerlos desde el visor.
const API_ROUTES = [
  /^\/wado$/,
  /^\/studies$/,
  /^\/intensity$/,
  /^\/study\/[^/]+$/,
  /^\/study\/[^/]+\/ohif$/,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

if (!TOKEN) {
  console.error('Falta RELAY_REQUEST_TOKEN — el relay responde 401 sin él.');
  process.exit(1);
}

function proxyToRelay(req, res, pathname, search) {
  const params = new URLSearchParams(search);

  // El manifiesto lleva dentro las URLs de imagen que pedirá el navegador, y
  // tienen que apuntar a este mismo origen, no al relay. Se inyecta acá para
  // que el cliente no tenga que saberlo (ni pueda equivocarse).
  const isManifest = pathname.endsWith('/ohif') || params.get('format') === 'ohif';
  if (isManifest && !params.has('wado_base')) {
    const origin = PUBLIC_ORIGIN || `https://${req.headers.host ?? ''}`;
    params.set('wado_base', `${origin}/api`);
  }

  const upstream = upstreamModule.request(
    {
      hostname: RELAY.hostname,
      port: upstreamPort,
      path: `${pathname}?${params}`,
      method: req.method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(req.headers['content-type'] && {
          'content-type': req.headers['content-type'],
        }),
      },
    },
    up => {
      // Sin content-length: el conector del relay tampoco lo reenvía, así que
      // el cuerpo sale chunked y no topa con el límite de 32 MiB que Cloud Run
      // aplica a las respuestas de tamaño conocido.
      const headers = {};
      if (up.headers['content-type']) headers['content-type'] = up.headers['content-type'];
      if (up.headers['content-disposition'])
        headers['content-disposition'] = up.headers['content-disposition'];
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    }
  );

  upstream.on('error', err => {
    console.error(`${pathname} → ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'relay inalcanzable' }));
  });

  req.pipe(upstream);
}

function serveStatic(res, pathname) {
  // path.normalize + prefijo obligatorio: sin esto un `..` en la URL sacaría
  // archivos de fuera de dist.
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(DIST, rel);
  if (!path.resolve(file).startsWith(path.resolve(DIST))) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || stat.isDirectory()) {
      // Fallback de SPA: /viewer y demás rutas las resuelve el router del
      // cliente, no existen como archivo.
      file = path.join(DIST, 'index.html');
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const immutable = /\.[0-9a-f]{8,}\./.test(file);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res).on('error', () => res.end());
  });
}

http
  .createServer((req, res) => {
    const { pathname, search } = new URL(req.url, 'http://localhost');

    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }

    if (pathname.startsWith('/api/')) {
      const apiPath = pathname.slice(4);
      if (!API_ROUTES.some(re => re.test(apiPath))) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'ruta no permitida', path: apiPath }));
        return;
      }
      proxyToRelay(req, res, apiPath, search);
      return;
    }

    serveStatic(res, pathname);
  })
  .listen(PORT, () => {
    console.log(`ohif-viewer :${PORT}  →  ${RELAY.origin}  (dist: ${DIST})`);
  });
