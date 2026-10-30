/**
 * «Medir IA»: lo que el servidor del visor hace con /api/ia/caderas.
 *
 *   node --test toth/ia-caderas.test.mjs
 *
 * Sin red: `fetch` es un doble que anota lo que se le pide. Lo que importa es
 * que nada sin forma conocida llegue a la URL del relay, que el token del relay
 * y la clave del modelo viajen cada uno a su destino, y que los errores del
 * camino no se confundan con un «no es una pelvis» del modelo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirCaderas, parsePedido, urlServicio, wadoJpegPath } from './ia-caderas.mjs';

const ESTUDIO = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.10';
const SERIE = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.11';
const OBJETO = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.12';

const q = obj => new URLSearchParams(obj);
const valido = {
  client: 'csf',
  studyUID: ESTUDIO,
  seriesUID: SERIE,
  objectUID: OBJETO,
  filas: '2328',
  columnas: '2846',
  fotometria: 'MONOCHROME1',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PUNTOS = {
  ok: true,
  puntos: { tcc_izq: [1, 2], asm_izq: [3, 4], tcc_der: [5, 6], asm_der: [7, 8] },
};

function respuesta(status, body, type = 'application/json') {
  return new Response(
    typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': type },
    }
  );
}

/** fetch falso: primero el relay, después el servicio. */
function dobleFetch({
  relay = () => respuesta(200, JPEG, 'image/jpeg'),
  ia = () => respuesta(200, PUNTOS),
} = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    return llamadas.length === 1 ? relay() : ia();
  };
  return { fetchImpl, llamadas };
}

const opciones = extra => ({
  relayBase: 'https://relay.example',
  relayToken: 'token-relay',
  iaUrl: 'http://10.0.0.2:8096/ia/caderas',
  iaToken: 'clave-ia',
  ...extra,
});

// ── la query ───────────────────────────────────────────────────────────────

test('acepta un pedido bien formado', () => {
  const { pedido } = parsePedido(q(valido));

  assert.equal(pedido.columnas, 2846);
  assert.equal(pedido.fotometria, 'MONOCHROME1');
});

test('rechaza lo que no tiene forma de UID, centro o tamaño', () => {
  for (const [campo, valor] of [
    ['client', 'csf&admin=1'],
    ['studyUID', '1.2/../../admin'],
    ['seriesUID', ''],
    ['objectUID', 'abc'],
    ['filas', '-3'],
    ['columnas', '1e9'],
    ['fotometria', 'x&y'],
  ]) {
    const r = parsePedido(q({ ...valido, [campo]: valor }));
    assert.equal(r.status, 400, campo);
    assert.equal(r.pedido, undefined, campo);
  }
});

// ── las URLs ───────────────────────────────────────────────────────────────

test('pide el JPEG reducido a 1.536 columnas sólo si es más ancho', () => {
  const { pedido } = parsePedido(q(valido));
  const ancha = new URLSearchParams(wadoJpegPath(pedido).split('?')[1]);
  const angosta = new URLSearchParams(wadoJpegPath({ ...pedido, columnas: 1200 }).split('?')[1]);

  assert.equal(ancha.get('contentType'), 'image/jpeg');
  assert.equal(ancha.get('objectUID'), OBJETO);
  assert.equal(ancha.get('columns'), '1536');
  assert.equal(angosta.get('columns'), null);
});

test('la URL del servicio conserva la query del túnel', () => {
  const { pedido } = parsePedido(q(valido));
  const url = new URL(urlServicio('https://relay.example/ia/caderas?client=supermicro', pedido));

  assert.equal(url.searchParams.get('client'), 'supermicro');
  assert.equal(url.searchParams.get('filas'), '2328');
  assert.equal(url.searchParams.get('fotometria'), 'MONOCHROME1');
});

// ── el camino ──────────────────────────────────────────────────────────────

test('cada credencial va a su destino y el JPEG llega al servicio', async () => {
  const { pedido } = parsePedido(q(valido));
  const { fetchImpl, llamadas } = dobleFetch();

  const r = await medirCaderas(pedido, opciones({ fetchImpl }));

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, PUNTOS);
  assert.ok(llamadas[0].url.startsWith('https://relay.example/wado?'));
  assert.equal(llamadas[0].opciones.headers.authorization, 'Bearer token-relay');
  assert.ok(llamadas[1].url.startsWith('http://10.0.0.2:8096/ia/caderas?'));
  assert.equal(llamadas[1].opciones.headers.authorization, 'Bearer clave-ia');
  assert.deepEqual(llamadas[1].opciones.body, JPEG);
});

test('sin servicio configurado da 503 y no toca el relay', async () => {
  const { pedido } = parsePedido(q(valido));
  const { fetchImpl, llamadas } = dobleFetch();

  const r = await medirCaderas(pedido, opciones({ fetchImpl, iaUrl: '' }));

  assert.equal(r.status, 503);
  assert.equal(llamadas.length, 0);
});

test('el «no es una pelvis» del modelo llega tal cual', async () => {
  const { pedido } = parsePedido(q(valido));
  const motivo = { ok: false, motivo: 'cartílagos trirradiados demasiado juntos' };
  const { fetchImpl } = dobleFetch({ ia: () => respuesta(422, motivo) });

  const r = await medirCaderas(pedido, opciones({ fetchImpl }));

  assert.equal(r.status, 422);
  assert.deepEqual(r.body, motivo);
});

test('los errores del camino no se confunden con el modelo', async () => {
  const { pedido } = parsePedido(q(valido));
  const casos = [
    [{ relay: () => respuesta(404, 'no') }, 404],
    [{ relay: () => respuesta(200, '{"error":1}') }, 502], // no es una imagen
    [{ relay: () => Promise.reject(new TypeError('fetch failed')) }, 502],
    [{ ia: () => respuesta(401, { detail: 'clave de API inválida' }) }, 502],
    [{ ia: () => respuesta(200, '<html>', 'text/html') }, 502],
    [{ ia: () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })) }, 504],
  ];
  for (const [doble, esperado] of casos) {
    const { fetchImpl } = dobleFetch(doble);
    const r = await medirCaderas(pedido, opciones({ fetchImpl }));
    assert.equal(r.status, esperado);
    assert.equal(r.body.ok, false);
  }
});

test('sin token del relay (dicom-index directo en la LAN) no manda cabecera', async () => {
  const { pedido } = parsePedido(q(valido));
  const { fetchImpl, llamadas } = dobleFetch();

  await medirCaderas(pedido, opciones({ fetchImpl, relayToken: '' }));

  assert.equal(llamadas[0].opciones.headers.authorization, undefined);
});
