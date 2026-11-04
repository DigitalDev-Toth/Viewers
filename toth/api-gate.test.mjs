/**
 * La compuerta de /api.
 *
 *   node --test toth/api-gate.test.mjs
 *
 * Es la única barrera entre un enlace y el archivo completo, así que lo que se
 * prueba es sobre todo lo que tiene que rebotar: rutas que no exponemos, el
 * estudio de otro, y el centro de otro — que es lo que un token de sesión
 * podría regalar si estuviera mal escrito.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeApiRequest, matchApiRoute } from './api-gate.mjs';

const ESTUDIO = '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.10';
const OTRO_ESTUDIO = '1.2.826.0.1.3680043.2.146.8.532.59015.9999999.11';

const view = { scope: 'view', study_iuid: ESTUDIO, client: 'nim', exp: 0 };
const sesion = { scope: 'session', study_iuid: null, client: 'nim', exp: 0 };

const q = obj => new URLSearchParams(obj);

// ── rutas ──────────────────────────────────────────────────────────────────

test('sólo se exponen las rutas que el visor usa', () => {
  assert.ok(matchApiRoute('/wado'));
  assert.ok(matchApiRoute(`/study/${ESTUDIO}`));
  assert.ok(matchApiRoute(`/study/${ESTUDIO}/ohif`));
  assert.ok(matchApiRoute('/ia/caderas'));
  assert.ok(matchApiRoute('/ia/caderas/correccion'));

  // De /ia/* sólo la medición: /ia/informe y compañía son de otros productos.
  assert.equal(matchApiRoute('/ia/informe'), null);
  assert.equal(matchApiRoute('/ia/caderas/otra'), null);

  // /studies e /intensity existen en el relay y quedaron fuera a propósito:
  // no hay forma de acotar un listado con un token por estudio.
  assert.equal(matchApiRoute('/studies'), null);
  assert.equal(matchApiRoute('/intensity'), null);
  assert.equal(matchApiRoute('/study/1.2/zip'), null);
});

test('una ruta desconocida da 404 antes de mirar el token', () => {
  const r = authorizeApiRequest('/studies', q({ client: 'nim' }), view);

  assert.equal(r.status, 404);
});

test('sin cookie válida da 401', () => {
  const r = authorizeApiRequest('/wado', q({ client: 'nim', studyUID: ESTUDIO }), null);

  assert.equal(r.status, 401);
});

// ── enlace por estudio ─────────────────────────────────────────────────────

test('el enlace de un estudio abre ese estudio', () => {
  assert.equal(authorizeApiRequest('/wado', q({ client: 'nim', studyUID: ESTUDIO }), view), null);
  assert.equal(authorizeApiRequest(`/study/${ESTUDIO}`, q({ client: 'nim' }), view), null);
  assert.equal(authorizeApiRequest(`/study/${ESTUDIO}/ohif`, q({ client: 'nim' }), view), null);
});

test('el enlace de un estudio no sirve de llave maestra para otro', () => {
  const porQuery = authorizeApiRequest('/wado', q({ client: 'nim', studyUID: OTRO_ESTUDIO }), view);
  const porRuta = authorizeApiRequest(`/study/${OTRO_ESTUDIO}`, q({ client: 'nim' }), view);

  assert.equal(porQuery.status, 403);
  assert.equal(porRuta.status, 403);
});

test('sin studyUID en /wado tampoco pasa', () => {
  assert.equal(authorizeApiRequest('/wado', q({ client: 'nim' }), view).status, 403);
});

test('el estudio de la ruta se compara ya decodificado', () => {
  const codificado = `/study/${encodeURIComponent(ESTUDIO)}`;

  assert.equal(authorizeApiRequest(codificado, q({ client: 'nim' }), view), null);
});

// ── «Medir IA» ─────────────────────────────────────────────────────────────

test('medir con IA se acota al estudio del enlace, como una imagen', () => {
  const propio = q({ client: 'nim', studyUID: ESTUDIO });
  const ajeno = q({ client: 'nim', studyUID: OTRO_ESTUDIO });

  assert.equal(authorizeApiRequest('/ia/caderas', propio, view), null);
  assert.equal(authorizeApiRequest('/ia/caderas', ajeno, view).status, 403);
  assert.equal(authorizeApiRequest('/ia/caderas/correccion', propio, view), null);
  assert.equal(authorizeApiRequest('/ia/caderas/correccion', ajeno, view).status, 403);
  assert.equal(authorizeApiRequest('/ia/caderas', propio, null).status, 401);
});

test('medir la pierna se acota igual que las caderas', () => {
  const propio = q({ client: 'nim', studyUID: ESTUDIO });
  const ajeno = q({ client: 'nim', studyUID: OTRO_ESTUDIO });

  assert.equal(authorizeApiRequest('/ia/pierna', propio, view), null);
  assert.equal(authorizeApiRequest('/ia/pierna', ajeno, view).status, 403);
  assert.equal(authorizeApiRequest('/ia/pierna/correccion', propio, view), null);
  assert.equal(authorizeApiRequest('/ia/pierna/correccion', ajeno, view).status, 403);
  assert.equal(authorizeApiRequest('/ia/pierna', propio, null).status, 401);
  assert.equal(authorizeApiRequest('/ia/pierna/otra', propio, view).status, 404);
});

test('medir con IA en sesión: cualquier estudio, pero de su centro', () => {
  assert.equal(
    authorizeApiRequest('/ia/caderas', q({ client: 'nim', studyUID: OTRO_ESTUDIO }), sesion),
    null
  );
  assert.equal(
    authorizeApiRequest('/ia/caderas', q({ client: 'cdc', studyUID: ESTUDIO }), sesion).status,
    403
  );
});

// ── sesión ─────────────────────────────────────────────────────────────────

test('la sesión abre cualquier estudio de su centro', () => {
  assert.equal(authorizeApiRequest('/wado', q({ client: 'nim', studyUID: ESTUDIO }), sesion), null);
  assert.equal(
    authorizeApiRequest(`/study/${OTRO_ESTUDIO}/ohif`, q({ client: 'nim' }), sesion),
    null
  );
});

test('la sesión no alcanza el archivo de otro centro', () => {
  // Es la garantía que hace aceptable ampliar el alcance a todo el centro.
  const r = authorizeApiRequest('/wado', q({ client: 'cdc', studyUID: ESTUDIO }), sesion);

  assert.equal(r.status, 403);
});

test('la sesión de un centro con alias abre por sus dos nombres y nada más', () => {
  // csf-arc2 es csf atendido por arc2; csf es su conector propio, con los
  // estudios que no llegaron a arc2.
  const conAlias = { ...sesion, client: 'csf-arc2', clients: ['csf-arc2', 'csf'] };
  const ruta = `/study/${ESTUDIO}/ohif`;

  assert.equal(authorizeApiRequest(ruta, q({ client: 'csf-arc2' }), conAlias), null);
  assert.equal(authorizeApiRequest(ruta, q({ client: 'csf' }), conAlias), null);
  assert.equal(authorizeApiRequest(ruta, q({ client: 'nim' }), conAlias).status, 403);
});

test('la sesión tampoco pasa sin client', () => {
  assert.equal(authorizeApiRequest('/wado', q({ studyUID: ESTUDIO }), sesion).status, 403);
});

test('la sesión sigue acotada a las rutas expuestas', () => {
  assert.equal(authorizeApiRequest('/studies', q({ client: 'nim' }), sesion).status, 404);
});

// ── parámetros repetidos ───────────────────────────────────────────────────

test('un client repetido no cuela otro centro', () => {
  // Acá se lee el primero y el relay lee el último: sin este rechazo, el
  // relay pediría al centro ajeno lo que la compuerta autorizó para el propio.
  const r = authorizeApiRequest(
    '/wado',
    new URLSearchParams(`client=nim&studyUID=${ESTUDIO}&client=cdc`),
    sesion
  );

  assert.equal(r.status, 400);
});

test('un studyUID repetido no cuela otro estudio', () => {
  const r = authorizeApiRequest(
    '/wado',
    new URLSearchParams(`client=nim&studyUID=${ESTUDIO}&studyUID=${OTRO_ESTUDIO}`),
    view
  );

  assert.equal(r.status, 400);
});

test('la clave repetida se detecta aunque venga codificada', () => {
  const r = authorizeApiRequest(
    `/study/${ESTUDIO}/ohif`,
    new URLSearchParams('client=nim&cl%69ent=cdc'),
    view
  );

  assert.equal(r.status, 400);
});

test('un estudio mal codificado en la ruta se rechaza sin lanzar', () => {
  const r = authorizeApiRequest('/study/%E0%A4%A/ohif', q({ client: 'nim' }), view);

  assert.equal(r.status, 403);
});

test('un scope desconocido en los claims se trata como enlace por estudio', () => {
  // Defensa en profundidad: verifyLinkToken ya rechaza estos, pero si alguna
  // vez dejara pasar uno, la compuerta debe cerrar, no abrir.
  const raro = { scope: 'algo-nuevo', study_iuid: ESTUDIO, client: 'nim', exp: 0 };

  assert.equal(authorizeApiRequest('/wado', q({ client: 'nim', studyUID: ESTUDIO }), raro), null);
  assert.equal(
    authorizeApiRequest('/wado', q({ client: 'nim', studyUID: OTRO_ESTUDIO }), raro).status,
    403
  );
});
