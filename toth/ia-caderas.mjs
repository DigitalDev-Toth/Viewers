/**
 * «Medir IA»: el índice acetabular de una RX de pelvis, para la extensión toth-ia.
 *
 * El navegador no manda la imagen ni habla con el modelo. Pide
 *
 *   /api/ia/caderas?client=&studyUID=&seriesUID=&objectUID=&filas=&columnas=&fotometria=
 *
 * y este proceso baja del relay el JPEG de esa instancia —el mismo render con
 * el que se entrenó el modelo, hasta 1.536 columnas— y se lo pasa al servicio
 * ia-caderas (iaTunning/scripts/servicio_caderas.py), que devuelve los puntos
 * ya en píxeles del DICOM. Así ni el token del relay ni la clave del modelo
 * llegan al navegador, y la compuerta de /api (api-gate.mjs) acota el pedido al
 * estudio del enlace, igual que una imagen.
 *
 * Lo usan server.mjs (producción) y relay-proxy.mjs (desarrollo). Variables:
 *
 *   IA_CADERAS_URL    sin ella la ruta responde 503. En desarrollo, el servicio
 *                     en la LAN: http://10.10.10.2:8096/ia/caderas. En
 *                     producción, el túnel del relay hacia el Supermicro
 *                     (https://relay.cui.date/ia/caderas?client=<nodo>), que
 *                     todavía no existe: ver extensions/toth-ia/README.md.
 *   IA_CADERAS_TOKEN  Bearer para ese servicio: una clave de
 *                     ~/.config/ia/api-keys del Supermicro en desarrollo, o el
 *                     token del relay en producción.
 */

export const COLUMNAS_MAX = 1536;
const MAX_BYTES = 16 * 1024 * 1024;
const UID_RE = /^[0-9.]{1,64}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Sólo importa MONOCHROME1 (el servicio decide si el JPEG vino en negativo);
// las demás se aceptan para no rechazar un pedido por un dato que no se usa.
const FOTOMETRIA_RE = /^[A-Z0-9 _]{0,32}$/;

function entero(valor) {
  return /^[0-9]{1,5}$/.test(valor ?? '') ? Number(valor) : NaN;
}

/**
 * Valida la query. Devuelve `{ pedido }` o `{ status, message }`: lo que
 * llega acá termina en una URL del relay, así que nada pasa sin forma
 * conocida.
 */
export function parsePedido(params) {
  const pedido = {
    client: params.get('client') ?? '',
    studyUID: params.get('studyUID') ?? '',
    seriesUID: params.get('seriesUID') ?? '',
    objectUID: params.get('objectUID') ?? '',
    filas: entero(params.get('filas')),
    columnas: entero(params.get('columnas')),
    fotometria: params.get('fotometria') ?? '',
  };
  if (!CLIENT_RE.test(pedido.client)) {
    return { status: 400, message: 'client inválido' };
  }
  for (const uid of ['studyUID', 'seriesUID', 'objectUID']) {
    if (!UID_RE.test(pedido[uid])) {
      return { status: 400, message: `${uid} inválido` };
    }
  }
  for (const n of ['filas', 'columnas']) {
    if (!(pedido[n] >= 1 && pedido[n] <= 20000)) {
      return { status: 400, message: `${n} inválidas` };
    }
  }
  if (!FOTOMETRIA_RE.test(pedido.fotometria)) {
    return { status: 400, message: 'fotometria inválida' };
  }
  return { pedido };
}

/** La ruta /wado del JPEG, reducido a COLUMNAS_MAX como las RX de entrenamiento. */
export function wadoJpegPath(pedido) {
  const q = new URLSearchParams({
    requestType: 'WADO',
    client: pedido.client,
    studyUID: pedido.studyUID,
    seriesUID: pedido.seriesUID,
    objectUID: pedido.objectUID,
    contentType: 'image/jpeg',
  });
  if (pedido.columnas > COLUMNAS_MAX) {
    q.set('columns', String(COLUMNAS_MAX)); // sólo reducir, nunca ampliar
  }
  return `/wado?${q}`;
}

/** La URL del servicio con el tamaño del DICOM; conserva la query que traiga (p. ej. el client del túnel). */
export function urlServicio(base, pedido) {
  const url = new URL(base);
  url.searchParams.set('filas', String(pedido.filas));
  url.searchParams.set('columnas', String(pedido.columnas));
  if (pedido.fotometria) {
    url.searchParams.set('fotometria', pedido.fotometria);
  }
  return url.toString();
}

const falla = (status, motivo) => ({ status, body: { ok: false, motivo } });

/**
 * Baja el JPEG del relay y lo mide. Devuelve `{ status, body }` para el
 * navegador: 200 con los puntos, 422 si el modelo no ve una pelvis AP (el
 * motivo viene del servicio), 404 si la imagen no está, 502/503/504 si falta
 * algo del camino. `fetchImpl` es para los tests.
 */
export async function medirCaderas(
  pedido,
  { relayBase, relayToken, iaUrl, iaToken, fetchImpl = fetch, timeoutMs = 30000 }
) {
  if (!iaUrl) {
    return falla(503, 'la medición con IA no está configurada en este visor');
  }

  let imagen;
  try {
    const r = await fetchImpl(new URL(wadoJpegPath(pedido), relayBase), {
      headers: relayToken ? { authorization: `Bearer ${relayToken}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 404) {
      return falla(404, 'la imagen no está en el centro');
    }
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) {
      return falla(502, `el relay respondió ${r.status} al pedir la imagen`);
    }
    imagen = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    return falla(err?.name === 'TimeoutError' ? 504 : 502, 'relay inalcanzable');
  }
  if (imagen.length > MAX_BYTES) {
    return falla(502, 'la imagen es demasiado grande');
  }

  try {
    const r = await fetchImpl(urlServicio(iaUrl, pedido), {
      method: 'POST',
      headers: {
        'content-type': 'image/jpeg',
        ...(iaToken && { authorization: `Bearer ${iaToken}` }),
      },
      body: imagen,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body;
    try {
      body = await r.json();
    } catch {
      return falla(502, 'respuesta inválida del servicio de IA');
    }
    // 200 y 422 son respuestas del modelo; lo demás (clave, caída) es del camino.
    if (r.status === 200 || r.status === 422) {
      return { status: r.status, body };
    }
    return falla(502, `el servicio de IA respondió ${r.status}`);
  } catch (err) {
    return falla(err?.name === 'TimeoutError' ? 504 : 502, 'servicio de IA inalcanzable');
  }
}

/** Configuración desde el entorno del proceso. */
export function configIa(env = process.env) {
  return { iaUrl: env.IA_CADERAS_URL ?? '', iaToken: env.IA_CADERAS_TOKEN ?? '' };
}

export function enviarJson(res, { status, body }, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}
