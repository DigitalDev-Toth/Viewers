/**
 * Proxy local: navegador → este proceso → relay.cui.date → dicom-index.
 *
 * Existe por dos razones:
 *
 *  1. El RELAY_REQUEST_TOKEN es una credencial de infraestructura compartida,
 *     no un token por usuario. Si el visor lo mandara desde el navegador,
 *     quedaría a la vista de cualquiera con las devtools abiertas. Acá vive
 *     solo en el entorno de este proceso.
 *  2. El navegador habla únicamente con localhost, así que no hay CORS que
 *     configurar en el relay para desarrollo local.
 *
 * La respuesta se reenvía con pipe(), sin bufferear: un estudio son cientos
 * de archivos y el visor los va pidiendo a medida que los necesita.
 *
 *   RELAY_REQUEST_TOKEN=... node toth/relay-proxy.mjs
 */

import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PROXY_PORT ?? 3001);
const RELAY = new URL(process.env.RELAY_BASE ?? 'https://relay.cui.date');
const TOKEN = process.env.RELAY_REQUEST_TOKEN ?? '';
const ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';

// Apunta al relay (https) o directo a un dicom-index en la LAN (http). Lo
// segundo sirve para probar el visor sin tener el token del relay a mano.
const upstreamModule = RELAY.protocol === 'http:' ? http : https;
const defaultPort = RELAY.protocol === 'http:' ? 80 : 443;

// Solo las rutas que el visor necesita. Deja fuera /admin y /agent, que no
// tienen por qué quedar expuestos en localhost aunque el token los abriría.
const ALLOWED = [
  /^\/wado$/,
  /^\/studies$/,
  /^\/intensity$/,
  /^\/study\/[^/]+$/,
  /^\/study\/[^/]+\/ohif$/,
];

if (!TOKEN && RELAY.protocol === 'https:') {
  console.error('Falta RELAY_REQUEST_TOKEN. El relay responde 401 sin él.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const { pathname, search } = new URL(req.url, 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  if (req.method === 'OPTIONS') {
    // Refleja lo que el preflight pide en vez de una lista fija: Cornerstone
    // manda `Accept` en cada petición de imagen, y una lista cerrada hace que
    // el navegador bloquee el GET *después* de un preflight en 204 — un fallo
    // que se lee como error de red y no como CORS.
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ?? 'Content-Type'
    );
    res.setHeader('Access-Control-Max-Age', '600');
    res.writeHead(204).end();
    return;
  }

  if (!ALLOWED.some(re => re.test(pathname))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ruta no permitida por el proxy', pathname }));
    return;
  }

  const upstream = upstreamModule.request(
    {
      hostname: RELAY.hostname,
      port: RELAY.port || defaultPort,
      path: pathname + search,
      method: req.method,
      headers: {
        ...(TOKEN && { authorization: `Bearer ${TOKEN}` }),
        ...(req.headers['content-type'] && { 'content-type': req.headers['content-type'] }),
      },
    },
    up => {
      // Sin content-length: el conector del relay tampoco lo reenvía, y así
      // el cuerpo sale chunked igual que desde dicom-index.
      const headers = { 'Access-Control-Allow-Origin': ORIGIN };
      if (up.headers['content-type']) headers['content-type'] = up.headers['content-type'];
      if (up.headers['content-disposition'])
        headers['content-disposition'] = up.headers['content-disposition'];

      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    }
  );

  upstream.on('error', err => {
    console.error(`${pathname} → ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'relay inalcanzable', detail: err.message }));
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`proxy   http://localhost:${PORT}  →  ${RELAY.origin}`);
  console.log(`origen  ${ORIGIN}`);
});
