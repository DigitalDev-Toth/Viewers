/**
 * «Medir IA» en una telerradiografía de EEII: el eje mecánico, el mLDFA y el
 * MPTA de cada pierna, para la extensión toth-ia. Mismo camino que
 * ia-caderas.mjs: el navegador pide
 *
 *   /api/ia/pierna?client=&studyUID=&seriesUID=&objectUID=&filas=&columnas=&mm=&fotometria=
 *
 * y este proceso baja del relay el JPEG de esa instancia y se lo pasa al
 * servicio ia-pierna (iaTunning/scripts/servicio_pierna.py), que devuelve los
 * ángulos ya en píxeles del DICOM. `mm` es el PixelSpacing del DICOM: el
 * modelo recorta cada articulación en milímetros.
 *
 * El JPEG va a 2.048 columnas, como las placas con que se entrenó el modelo
 * (iaTunning/scripts/traer_pierna_csf.sh). Algunas pasan de 3 MB, el tope de
 * una petición por el túnel del relay: esas se vuelven a pedir a 1.536
 * columnas (~0,3 mm/px en una placa de 43 cm, dentro de lo que el modelo vio
 * al entrenar con resolución degradada).
 *
 * Las correcciones del radiólogo vuelven por
 *
 *   POST /api/ia/pierna/correccion?<la misma query>   cuerpo JSON
 *
 * hacia la misma ruta del servicio, que las distingue por el content-type.
 *
 *   IA_PIERNA_URL    sin ella la ruta responde 503. En desarrollo, el
 *                    servicio en la LAN: http://10.10.10.2:8098/ia/pierna. En
 *                    producción, el túnel del relay hacia el Supermicro
 *                    (<relay>/ia/pierna?client=<nodo>).
 *   IA_PIERNA_TOKEN  Bearer para ese servicio: una clave de
 *                    ~/.config/ia/api-keys del Supermicro en desarrollo, o el
 *                    token del relay en producción.
 */

import { parsePedido, urlServicio } from './ia-caderas.mjs';

export const COLUMNAS_PIERNA = 2048;
export const COLUMNAS_PIERNA_REDUCIDA = 1536;
export const MAX_BYTES_RELAY = 3000000; // RELAY_PIERNA_MAX_BYTES en dicom-relay/main.py
const MAX_BYTES = 16 * 1024 * 1024;
const MM_RE = /^[0-9]{1,2}(\.[0-9]{1,8})?$/;
const ANOTACION_RE = /^[0-9a-f-]{8,64}$/i;
const MODELO_RE = /^[A-Za-z0-9._-]{0,64}$/;
const MEDIDAS = ['eje', 'mldfa', 'mpta'];

/** Como parsePedido, más el tamaño del píxel (opcional: sin él el servicio supone 0,3 mm/px en el JPEG). */
export function parsePedidoPierna(params) {
  const r = parsePedido(params);
  if (!r.pedido) {
    return r;
  }
  const mm = params.get('mm');
  if (mm !== null && mm !== '') {
    if (!MM_RE.test(mm) || !(Number(mm) > 0.01 && Number(mm) <= 2)) {
      return { status: 400, message: 'mm inválido' };
    }
    r.pedido.mm = Number(mm);
  }
  return r;
}

/** La ruta /wado del JPEG, reducido a `columnas` (sólo reducir, nunca ampliar). */
export function wadoJpegPierna(pedido, columnas = COLUMNAS_PIERNA) {
  const q = new URLSearchParams({
    requestType: 'WADO',
    client: pedido.client,
    studyUID: pedido.studyUID,
    seriesUID: pedido.seriesUID,
    objectUID: pedido.objectUID,
    contentType: 'image/jpeg',
  });
  if (pedido.columnas > columnas) {
    q.set('columns', String(columnas));
  }
  return `/wado?${q}`;
}

/** La URL del servicio: la de caderas (filas, columnas, fotometria) más mm. */
export function urlServicioPierna(base, pedido) {
  const url = new URL(urlServicio(base, pedido));
  if (pedido.mm) {
    url.searchParams.set('mm', String(pedido.mm));
  }
  return url.toString();
}

/** Tres puntos [x, y] con números finitos y razonables para el tamaño del DICOM. */
function tresPuntos(valor, pedido) {
  const margen = Math.max(pedido.filas, pedido.columnas);
  const dentro = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 2 * margen;
  if (
    !Array.isArray(valor) ||
    valor.length !== 3 ||
    !valor.every(p => Array.isArray(p) && p.length === 2 && p.every(dentro))
  ) {
    return null;
  }
  return valor.map(p => p.map(n => Math.round(n * 100) / 100));
}

/**
 * Valida una corrección a uno de los ángulos de la pierna, como
 * parseCorreccion de caderas: se rearma campo por campo.
 */
export function parseCorreccionPierna(params, texto) {
  const { pedido, status, message } = parsePedidoPierna(params);
  if (!pedido) {
    return { status, message };
  }
  let c;
  try {
    c = JSON.parse(texto);
  } catch {
    return { status: 400, message: 'el cuerpo no es JSON' };
  }
  if (!c || typeof c !== 'object') {
    return { status: 400, message: 'el cuerpo no es JSON' };
  }
  if (!ANOTACION_RE.test(c.anotacion ?? '')) {
    return { status: 400, message: 'anotacion inválida' };
  }
  if (!['derecha', 'izquierda'].includes(c.pierna) || !['izq', 'der'].includes(c.mitad)) {
    return { status: 400, message: 'pierna inválida' };
  }
  if (!MEDIDAS.includes(c.medida)) {
    return { status: 400, message: 'medida inválida' };
  }
  if (!MODELO_RE.test(c.modelo ?? '')) {
    return { status: 400, message: 'modelo inválido' };
  }
  const puntosIa = tresPuntos(c.puntos_ia, pedido);
  const puntos = tresPuntos(c.puntos, pedido);
  if (!puntosIa || !puntos) {
    return { status: 400, message: 'puntos inválidos' };
  }
  return {
    pedido,
    correccion: {
      centro: pedido.client,
      studyUID: pedido.studyUID,
      seriesUID: pedido.seriesUID,
      objectUID: pedido.objectUID,
      filas: pedido.filas,
      columnas: pedido.columnas,
      anotacion: c.anotacion.toLowerCase(),
      pierna: c.pierna,
      mitad: c.mitad,
      medida: c.medida,
      modelo: c.modelo ?? '',
      puntos_ia: puntosIa,
      puntos,
    },
  };
}

const falla = (status, motivo) => ({ status, body: { ok: false, motivo } });

/** Baja el JPEG del relay: `{ imagen }` o `{ status, body }` si falló. */
async function bajarJpeg(pedido, columnas, { relayBase, relayToken, fetchImpl, timeoutMs }) {
  try {
    const r = await fetchImpl(new URL(wadoJpegPierna(pedido, columnas), relayBase), {
      headers: relayToken ? { authorization: `Bearer ${relayToken}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 404) {
      return falla(404, 'la imagen no está en el centro');
    }
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) {
      return falla(502, `el relay respondió ${r.status} al pedir la imagen`);
    }
    return { imagen: Buffer.from(await r.arrayBuffer()) };
  } catch (err) {
    return falla(err?.name === 'TimeoutError' ? 504 : 502, 'relay inalcanzable');
  }
}

/**
 * Baja el JPEG y lo mide. Devuelve `{ status, body }` para el navegador: 200
 * con las piernas, 422 si el modelo no ve ninguna pierna medible (el motivo
 * viene del servicio), 404 si la imagen no está, 502/503/504 si falta algo del
 * camino. `fetchImpl` es para los tests.
 */
export async function medirPierna(
  pedido,
  {
    relayBase,
    relayToken,
    iaUrl,
    iaToken,
    fetchImpl = fetch,
    timeoutMs = 60000,
    maxBytesRelay = MAX_BYTES_RELAY,
  }
) {
  if (!iaUrl) {
    return falla(503, 'la medición con IA no está configurada en este visor');
  }
  const camino = { relayBase, relayToken, fetchImpl, timeoutMs };
  let r = await bajarJpeg(pedido, COLUMNAS_PIERNA, camino);
  if (r.imagen && r.imagen.length > maxBytesRelay && pedido.columnas > COLUMNAS_PIERNA_REDUCIDA) {
    r = await bajarJpeg(pedido, COLUMNAS_PIERNA_REDUCIDA, camino);
  }
  if (!r.imagen) {
    return r;
  }
  if (r.imagen.length > Math.min(maxBytesRelay, MAX_BYTES)) {
    return falla(502, 'la imagen es demasiado grande');
  }

  try {
    const s = await fetchImpl(urlServicioPierna(iaUrl, pedido), {
      method: 'POST',
      headers: {
        'content-type': 'image/jpeg',
        ...(iaToken && { authorization: `Bearer ${iaToken}` }),
      },
      body: r.imagen,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body;
    try {
      body = await s.json();
    } catch {
      return falla(502, 'respuesta inválida del servicio de IA');
    }
    // 200 y 422 son respuestas del modelo; lo demás (clave, caída) es del camino.
    if (s.status === 200 || s.status === 422) {
      return { status: s.status, body };
    }
    return falla(502, `el servicio de IA respondió ${s.status}`);
  } catch (err) {
    return falla(err?.name === 'TimeoutError' ? 504 : 502, 'servicio de IA inalcanzable');
  }
}

/** Configuración desde el entorno del proceso. */
export function configIaPierna(env = process.env) {
  return { iaUrl: env.IA_PIERNA_URL ?? '', iaToken: env.IA_PIERNA_TOKEN ?? '' };
}
