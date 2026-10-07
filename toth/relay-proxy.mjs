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
 * También sirve para buscar estudios (lo usa external-control/example.html):
 * `/nodos` lista los centros conectados y `/studies?client=` sus estudios.
 * El relay no acepta el RELAY_REQUEST_TOKEN en `/studies` — pide un JWT
 * `scope=list` del centro —, así que ese se firma acá con MIRROR_LINK_SECRETS,
 * igual que lo hace BioRis en getStudiesFromRelay.
 *
 *   RELAY_REQUEST_TOKEN=... MIRROR_LINK_SECRETS=... node toth/relay-proxy.mjs
 *
 * Con los secretos de producción, sin escribirlos a disco:
 *
 *   RELAY_REQUEST_TOKEN="$(gcloud secrets versions access latest --secret=relay-request-token)" \
 *   MIRROR_LINK_SECRETS="$(gcloud secrets versions access latest --secret=mirror-link-secrets)" \
 *   node toth/relay-proxy.mjs
 */

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PROXY_PORT ?? 3001);
const RELAY = new URL(process.env.RELAY_BASE ?? 'https://relay.cui.date');
const TOKEN = process.env.RELAY_REQUEST_TOKEN ?? '';
const ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';
// Con la que se firma el token de listado. Si hay varias (rotación), la
// primera: el relay acepta cualquiera de ellas.
const LINK_SECRET = (process.env.MIRROR_LINK_SECRETS ?? process.env.MIRROR_LINK_SECRET ?? '')
  .split(',')
  .map(secret => secret.trim())
  .filter(Boolean)[0];
const CLIENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const b64url = data => Buffer.from(data).toString('base64url');

/** JWT HS256 que verify_link_token() del relay acepta; vive 5 minutos. */
function listToken(client) {
  const now = Math.floor(Date.now() / 1000);
  // Mismo orden de claims que BioRis y xrayvue: {scope, client, iat, exp}.
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ scope: 'list', client, iat: now, exp: now + 300 }));
  const signature = crypto
    .createHmac('sha256', LINK_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// Apunta al relay (https) o directo a un dicom-index en la LAN (http). Lo
// segundo sirve para probar el visor sin tener el token del relay a mano.
const upstreamModule = RELAY.protocol === 'http:' ? http : https;
const defaultPort = RELAY.protocol === 'http:' ? 80 : 443;

// Solo las rutas que el visor necesita. Deja fuera /admin y /agent, que no
// tienen por qué quedar expuestos en localhost aunque el token los abriría.
const ALLOWED = [
  /^\/wado$/,
  /^\/studies$/,
  /^\/nodos$/,
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

  const params = new URLSearchParams(search);
  let authorization = TOKEN && `Bearer ${TOKEN}`;

  if (pathname === '/studies' && RELAY.protocol === 'https:') {
    const client = params.get('client') ?? '';
    if (!CLIENT_RE.test(client) || !LINK_SECRET) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: LINK_SECRET ? 'client inválido' : 'falta MIRROR_LINK_SECRETS para listar',
        })
      );
      return;
    }
    authorization = `Bearer ${listToken(client)}`;
  }

  // Igual que server.mjs: las URLs de imagen del manifiesto tienen que volver
  // a este proxy, que es el que tiene el token, no ir directo al relay.
  const isManifest = pathname.endsWith('/ohif') || params.get('format') === 'ohif';
  if (isManifest && !params.has('wado_base')) {
    params.set('wado_base', `http://localhost:${PORT}`);
  }
  const query = params.toString();

  const upstream = upstreamModule.request(
    {
      hostname: RELAY.hostname,
      port: RELAY.port || defaultPort,
      path: pathname + (query ? `?${query}` : ''),
      method: req.method,
      headers: {
        ...(authorization && { authorization }),
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
