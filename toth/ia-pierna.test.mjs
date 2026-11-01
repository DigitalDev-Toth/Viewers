/**
 * «Medir IA» en una telerradiografía: lo que el servidor del visor hace con
 * /api/ia/pierna.
 *
 *   node --test toth/ia-pierna.test.mjs
 *
 * Como ia-caderas.test.mjs, sin red. Además: el tamaño del píxel viaja al
 * servicio, el JPEG se pide a 2.048 columnas y, si pasa del tope del túnel,
 * otra vez a 1.536.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { guardarCorreccion } from './ia-caderas.mjs';
import {
  medirPierna,
  parseCorreccionPierna,
  parsePedidoPierna,
  urlServicioPierna,
  wadoJpegPierna,
} from './ia-pierna.mjs';

const ESTUDIO = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.10';
const SERIE = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.11';
const OBJETO = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.12';

const q = obj => new URLSearchParams(obj);
const valido = {
  client: 'csf',
  studyUID: ESTUDIO,
  seriesUID: SERIE,
  objectUID: OBJETO,
  filas: '10500',
  columnas: '3500',
  mm: '0.139',
  fotometria: 'MONOCHROME1',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PIERNAS = { ok: true, piernas: { izq: { ok: true }, der: { ok: false, motivo: 'x' } } };

function respuesta(status, body, type = 'application/json') {
  return new Response(
    typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    { status, headers: { 'content-type': type } }
  );
}

/** fetch falso: las llamadas a /wado van a `relay`, las demás a `ia`. */
function dobleFetch({
  relay = () => respuesta(200, JPEG, 'image/jpeg'),
  ia = () => respuesta(200, PIERNAS),
} = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    return String(url).includes('/wado?') ? relay(String(url)) : ia();
  };
  return { fetchImpl, llamadas };
}

const opciones = extra => ({
  relayBase: 'https://relay.example',
  relayToken: 'token-relay',
  iaUrl: 'https://relay.example/ia/pierna?client=supermicro',
  iaToken: 'token-ia',
  ...extra,
});

const columnas = url => new URL(url).searchParams.get('columns');

// ── la query ───────────────────────────────────────────────────────────────

test('acepta un pedido con o sin tamaño de píxel', () => {
  assert.equal(parsePedidoPierna(q(valido)).pedido.mm, 0.139);
  const { mm, ...sinMm } = valido;
  assert.equal(parsePedidoPierna(q(sinMm)).pedido.mm, undefined);
});

test('rechaza un tamaño de píxel sin forma de número razonable', () => {
  for (const mm of ['abc', '-0.1', '0', '1e3', '0.1&x=1', '5']) {
    const r = parsePedidoPierna(q({ ...valido, mm }));
    assert.equal(r.status, 400, mm);
    assert.equal(r.pedido, undefined, mm);
  }
  assert.equal(parsePedidoPierna(q({ ...valido, studyUID: '1/../x' })).status, 400);
});

// ── las URLs ───────────────────────────────────────────────────────────────

test('pide el JPEG a 2.048 columnas sólo si es más ancho', () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const ancha = new URLSearchParams(wadoJpegPierna(pedido).split('?')[1]);
  const angosta = new URLSearchParams(wadoJpegPierna({ ...pedido, columnas: 1800 }).split('?')[1]);

  assert.equal(ancha.get('contentType'), 'image/jpeg');
  assert.equal(ancha.get('columns'), '2048');
  assert.equal(angosta.get('columns'), null);
});

test('la URL del servicio lleva el tamaño del DICOM y del píxel, y conserva la del túnel', () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const url = new URL(urlServicioPierna('https://relay.example/ia/pierna?client=supermicro', pedido));

  assert.equal(url.pathname, '/ia/pierna');
  assert.equal(url.searchParams.get('client'), 'supermicro');
  assert.equal(url.searchParams.get('filas'), '10500');
  assert.equal(url.searchParams.get('mm'), '0.139');
});

// ── el camino ──────────────────────────────────────────────────────────────

test('cada credencial va a su destino y el JPEG llega al servicio', async () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const { fetchImpl, llamadas } = dobleFetch();

  const r = await medirPierna(pedido, opciones({ fetchImpl }));

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, PIERNAS);
  assert.equal(llamadas.length, 2);
  assert.equal(columnas(llamadas[0].url), '2048');
  assert.equal(llamadas[0].opciones.headers.authorization, 'Bearer token-relay');
  assert.ok(llamadas[1].url.startsWith('https://relay.example/ia/pierna?client=supermicro&'));
  assert.equal(llamadas[1].opciones.headers.authorization, 'Bearer token-ia');
  assert.deepEqual(llamadas[1].opciones.body, JPEG);
});

test('si el JPEG pasa del tope del túnel, lo pide de nuevo a 1.536 columnas', async () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const grande = Buffer.alloc(40, 1);
  const { fetchImpl, llamadas } = dobleFetch({
    relay: url => respuesta(200, columnas(url) === '2048' ? grande : JPEG, 'image/jpeg'),
  });

  const r = await medirPierna(pedido, opciones({ fetchImpl, maxBytesRelay: 20 }));

  assert.equal(r.status, 200);
  assert.deepEqual(
    llamadas.map(l => columnas(l.url)),
    ['2048', '1536', null]
  );
  assert.deepEqual(llamadas[2].opciones.body, JPEG);
});

test('si aun reducido pasa del tope, no lo manda', async () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const { fetchImpl, llamadas } = dobleFetch({
    relay: () => respuesta(200, Buffer.alloc(40, 1), 'image/jpeg'),
  });

  const r = await medirPierna(pedido, opciones({ fetchImpl, maxBytesRelay: 20 }));

  assert.equal(r.status, 502);
  assert.equal(llamadas.length, 2);
});

test('sin servicio configurado da 503 y no toca el relay', async () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const { fetchImpl, llamadas } = dobleFetch();

  const r = await medirPierna(pedido, opciones({ fetchImpl, iaUrl: '' }));

  assert.equal(r.status, 503);
  assert.equal(llamadas.length, 0);
});

test('el «no hay pierna medible» del modelo llega tal cual; los errores del camino no', async () => {
  const { pedido } = parsePedidoPierna(q(valido));
  const motivo = { ok: false, motivo: 'no se ve con claridad la rodilla o el tobillo' };
  const r = await medirPierna(
    pedido,
    opciones({ fetchImpl: dobleFetch({ ia: () => respuesta(422, motivo) }).fetchImpl })
  );
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, motivo);

  for (const [doble, esperado] of [
    [{ relay: () => respuesta(404, 'no') }, 404],
    [{ relay: () => respuesta(200, '{"error":1}') }, 502],
    [{ ia: () => respuesta(401, { detail: 'clave' }) }, 502],
    [{ ia: () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })) }, 504],
  ]) {
    const s = await medirPierna(pedido, opciones({ fetchImpl: dobleFetch(doble).fetchImpl }));
    assert.equal(s.status, esperado);
    assert.equal(s.body.ok, false);
  }
});

// ── las correcciones ───────────────────────────────────────────────────────

const correccion = {
  anotacion: '3f2a9c1e-0b1d-4c2e-9f00-1234567890ab',
  pierna: 'derecha',
  mitad: 'izq',
  medida: 'mldfa',
  modelo: 'pierna-v3',
  puntos_ia: [
    [100, 4000],
    [300, 4100],
    [310, 3500],
  ],
  puntos: [
    [101.234, 4001],
    [300, 4100],
    [310, 3500],
  ],
};

test('una corrección bien formada se rearma con el centro y los UID de la query', () => {
  const r = parseCorreccionPierna(q(valido), JSON.stringify({ ...correccion, extra: 'no pasa' }));

  assert.equal(r.correccion.centro, 'csf');
  assert.equal(r.correccion.objectUID, OBJETO);
  assert.equal(r.correccion.medida, 'mldfa');
  assert.deepEqual(r.correccion.puntos[0], [101.23, 4001]);
  assert.equal(r.correccion.extra, undefined);
});

test('rechaza correcciones sin la forma conocida', () => {
  for (const malo of [
    { ...correccion, pierna: 'ambas' },
    { ...correccion, mitad: 'centro' },
    { ...correccion, medida: 'hka' },
    { ...correccion, anotacion: '<script>' },
    { ...correccion, puntos: [[1, 2]] },
    { ...correccion, puntos_ia: [[1, 2], [3, 4], [5, 1e9]] },
  ]) {
    assert.equal(parseCorreccionPierna(q(valido), JSON.stringify(malo)).status, 400);
  }
  assert.equal(parseCorreccionPierna(q(valido), 'no es json').status, 400);
});

test('la corrección va como JSON a la ruta del servicio', async () => {
  const { pedido, correccion: c } = parseCorreccionPierna(q(valido), JSON.stringify(correccion));
  const { fetchImpl, llamadas } = dobleFetch({ ia: () => respuesta(200, { ok: true }) });

  const r = await guardarCorreccion(pedido, c, { ...opciones(), fetchImpl });

  assert.equal(r.status, 200);
  assert.ok(llamadas[0].url.startsWith('https://relay.example/ia/pierna?client=supermicro&'));
  assert.equal(llamadas[0].opciones.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(llamadas[0].opciones.body).medida, 'mldfa');
});
