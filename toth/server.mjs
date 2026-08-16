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
 *   /open?token= → canjea el enlace firmado por una cookie y abre el estudio
 *   /api/*       → relay (con el token), sólo con cookie válida
 *   /*           → dist/, con fallback a index.html para las rutas de la SPA
 *
 * La autorización es la misma de Mirror: un JWT `scope=view` atado a
 * (client, study_iuid) que se canjea por una cookie httpOnly. Que sea cookie
 * y no cabecera es lo que hace que el visor no necesite cambio alguno — el
 * navegador la adjunta sola en las cientos de peticiones de imagen — y que el
 * JavaScript de la página nunca pueda leer el token.
 *
 * Variables:
 *   RELAY_REQUEST_TOKEN  (obligatoria)  token del relay
 *   MIRROR_LINK_SECRET   (obligatoria)  firma de los enlaces; o
 *   MIRROR_LINK_SECRETS  lista separada por comas, para rotar
 *   RELAY_BASE           https://relay.cui.date
 *   PUBLIC_ORIGIN        origen público, p.ej. https://ohif.cui.date
 *   DIST_DIR             ./dist
 *   PORT                 8080 (Cloud Run lo inyecta)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

import {
  COOKIE_NAME, buildCookie, linkSecrets, parseCookies, requestIsHttps, verifyLinkToken,
} from './link-token.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const RELAY = new URL(process.env.RELAY_BASE ?? 'https://relay.cui.date');
const TOKEN = process.env.RELAY_REQUEST_TOKEN ?? '';
const DIST = process.env.DIST_DIR ?? './dist';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? '';

const upstreamModule = RELAY.protocol === 'http:' ? http : https;
const upstreamPort = RELAY.port || (RELAY.protocol === 'http:' ? 80 : 443);

// Cada ruta declara de dónde sale el estudio que se está pidiendo, porque hay
// que compararlo contra el del token: sin esa comparación, un enlace a un
// estudio abriría cualquier otro.
//
// /studies e /intensity quedaron fuera a propósito. El token de Mirror es por
// estudio, así que no hay forma de autorizar un listado completo con él; y el
// visor no las usa. Exponerlas sin poder acotarlas sería regalar el archivo
// entero a cualquiera con un enlace válido a un solo estudio.
const API_ROUTES = [
  { re: /^\/wado$/, studyFrom: 'query' },
  { re: /^\/study\/([^/]+)$/, studyFrom: 'path' },
  { re: /^\/study\/([^/]+)\/ohif$/, studyFrom: 'path' },
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

if (!linkSecrets().length) {
  // Arrancar sin secreto dejaría el visor abierto a cualquiera con la URL, con
  // el token del relay puesto por el servidor. Preferimos no arrancar.
  console.error('Falta MIRROR_LINK_SECRET(S) — sin él no hay forma de autorizar a nadie.');
  process.exit(1);
}

function denied(res, status, mensaje) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: mensaje }));
}

function claimsFor(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyLinkToken(cookies[COOKIE_NAME]);
}

/** El estudio que la petición está pidiendo, según la ruta. */
function requestedStudy(route, match, params) {
  return route.studyFrom === 'path' ? decodeURIComponent(match[1]) : params.get('studyUID');
}

/**
 * Canjea el enlace firmado por la cookie y manda al visor.
 *
 * Que el enlace sea corto y el servidor arme la URL del visor no es sólo
 * comodidad: así el estudio que se abre sale del token firmado y no de un
 * parámetro que cualquiera puede editar en la barra de direcciones.
 */
function openStudy(req, res, params) {
  const token = params.get('token') ?? '';
  const claims = verifyLinkToken(token);
  if (!claims) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8">'
      + '<title>Enlace inválido</title>'
      + '<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">'
      + '<h1 style="font-size:1.25rem">Enlace inválido o expirado</h1>'
      + '<p>Pide un enlace nuevo a quien te compartió el estudio.</p>');
    return;
  }

  const manifest = `/api/study/${encodeURIComponent(claims.study_iuid)}`
    + `?client=${encodeURIComponent(claims.client)}&format=ohif`;
  const destino = `/viewer?url=${encodeURIComponent(manifest)}`
    + `&StudyInstanceUIDs=${encodeURIComponent(claims.study_iuid)}`;

  res.writeHead(302, {
    'set-cookie': buildCookie(token, claims, requestIsHttps(req)),
    location: destino,
    'cache-control': 'no-store',
  });
  res.end();
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

    if (pathname === '/open') {
      openStudy(req, res, new URLSearchParams(search));
      return;
    }

    if (pathname.startsWith('/api/')) {
      const apiPath = pathname.slice(4);

      let route, match;
      for (const candidate of API_ROUTES) {
        const m = candidate.re.exec(apiPath);
        if (m) { route = candidate; match = m; break; }
      }
      if (!route) {
        denied(res, 404, 'ruta no permitida');
        return;
      }

      const claims = claimsFor(req);
      if (!claims) {
        denied(res, 401, 'sin autorización válida');
        return;
      }

      // El token vale para UN estudio de UN cliente. Comparar contra lo que se
      // está pidiendo es lo que impide que un enlace legítimo sirva de llave
      // maestra para el resto del archivo.
      const params = new URLSearchParams(search);
      if (requestedStudy(route, match, params) !== claims.study_iuid
          || params.get('client') !== claims.client) {
        denied(res, 403, 'el enlace no autoriza ese estudio');
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
