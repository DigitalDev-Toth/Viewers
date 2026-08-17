/**
 * Verificación de los enlaces firmados.
 *
 *   node --test toth/link-token.test.mjs
 *
 * Lo que se prueba no es que un token bueno pase — eso es lo fácil — sino que
 * los malos no pasen: firma ajena, scope distinto, vencido, con TTL por encima
 * del tope, y el estudio de otro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { verifyLinkToken, parseCookies, buildCookie, linkSecrets } from './link-token.mjs';

const SECRET = 'secreto-de-prueba-no-usado-en-ninguna-parte';
const OTRO_SECRETO = 'otro-secreto-distinto';

const b64url = buf =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function firmar(payload, secret = SECRET) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
}

const ahora = 1_800_000_000;
const valido = (extra = {}) => ({
  scope: 'view',
  study_iuid: '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.10',
  client: 'nim',
  iat: ahora,
  exp: ahora + 3600,
  ...extra,
});

const verificar = (token, extra = {}) =>
  verifyLinkToken(token, { secrets: [SECRET], now: ahora, maxTtlSeconds: 86400, ...extra });

// ── lo que debe pasar ──────────────────────────────────────────────────────

test('acepta un enlace bien firmado y vigente', () => {
  const claims = verificar(firmar(valido()));

  assert.equal(claims.client, 'nim');
  assert.equal(claims.study_iuid, '1.2.826.0.1.3680043.2.146.8.532.59015.2144600.10');
  assert.equal(claims.exp, ahora + 3600);
});

test('acepta el secreto viejo durante una rotación', () => {
  const conViejo = firmar(valido(), OTRO_SECRETO);

  assert.ok(verificar(conViejo, { secrets: [SECRET, OTRO_SECRETO] }));
});

// ── lo que NO debe pasar ───────────────────────────────────────────────────

test('rechaza una firma hecha con otro secreto', () => {
  assert.equal(verificar(firmar(valido(), OTRO_SECRETO)), null);
});

test('rechaza si le cambian el payload sin refirmar', () => {
  // El ataque obvio: tomar un enlace propio y editar el estudio.
  const token = firmar(valido());
  const [h, , s] = token.split('.');
  const alterado = b64url(JSON.stringify(valido({ study_iuid: '9.9.9.9.9.9.9.9.9.9' })));

  assert.equal(verificar(`${h}.${alterado}.${s}`), null);
});

test('rechaza el algoritmo "none"', () => {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = b64url(JSON.stringify(valido()));

  assert.equal(verificar(`${header}.${body}.`), null);
});

test('rechaza un scope que no conoce', () => {
  assert.equal(verificar(firmar(valido({ scope: 'download' }))), null);
  assert.equal(verificar(firmar(valido({ scope: 'list' }))), null);
  assert.equal(verificar(firmar(valido({ scope: '' }))), null);
});

// ── sesión ─────────────────────────────────────────────────────────────────

test('acepta un token de sesión sin estudio', () => {
  const claims = verificar(
    firmar({
      scope: 'session',
      client: 'nim',
      iat: ahora,
      exp: ahora + 8 * 3600,
    })
  );

  assert.equal(claims.scope, 'session');
  assert.equal(claims.client, 'nim');
  assert.equal(claims.study_iuid, null);
});

test('un token de sesión que además nombra un estudio es ambiguo y se rechaza', () => {
  // No se sabría si la compuerta debe acotar por ese estudio o abrir el centro.
  assert.equal(verificar(firmar(valido({ scope: 'session' }))), null);
});

test('el token de sesión sigue exigiendo un client con forma válida', () => {
  assert.equal(
    verificar(
      firmar({
        scope: 'session',
        client: 'NIM; DROP TABLE',
        iat: ahora,
        exp: ahora + 3600,
      })
    ),
    null
  );
});

test('el token de sesión no escapa al tope de vigencia', () => {
  assert.equal(
    verificar(
      firmar({
        scope: 'session',
        client: 'nim',
        iat: ahora,
        exp: ahora + 365 * 24 * 3600,
      })
    ),
    null
  );
});

test('el scope viaja en los claims para que la compuerta pueda distinguirlos', () => {
  assert.equal(verificar(firmar(valido())).scope, 'view');
});

test('rechaza un token vencido', () => {
  assert.equal(verificar(firmar(valido({ exp: ahora - 1 }))), null);
});

test('rechaza un TTL por encima del tope', () => {
  // Sin este límite, quien firma podría emitir un enlace eterno y revocarlo
  // exigiría rotar el secreto para todos.
  const unAnio = firmar(valido({ exp: ahora + 365 * 24 * 3600 }));

  assert.equal(verificar(unAnio), null);
});

test('rechaza claims con forma inválida', () => {
  assert.equal(verificar(firmar(valido({ study_iuid: '../../etc/passwd' }))), null);
  assert.equal(verificar(firmar(valido({ client: 'NIM; DROP TABLE' }))), null);
  assert.equal(verificar(firmar(valido({ study_iuid: '1.2' }))), null); // muy corto
});

test('rechaza tokens malformados sin lanzar', () => {
  for (const basura of ['', 'abc', 'a.b', 'a.b.c.d', '...', null, undefined, 42]) {
    assert.equal(verificar(basura), null);
  }
});

test('rechaza todo si no hay secreto configurado', () => {
  assert.equal(verifyLinkToken(firmar(valido()), { secrets: [], now: ahora }), null);
});

// ── cookie ─────────────────────────────────────────────────────────────────

test('la cookie es httpOnly para que el JS de la página no la lea', () => {
  const cookie = buildCookie('tok', { exp: ahora + 3600 }, true);

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test('sin HTTPS no marca Secure, o el navegador la descartaría en local', () => {
  assert.doesNotMatch(buildCookie('tok', { exp: ahora + 3600 }, false), /Secure/);
});

test('parseCookies lee el valor entre otras cookies', () => {
  const cookies = parseCookies('otra=1; mirror_auth=abc.def.ghi; tercera=2');

  assert.equal(cookies.mirror_auth, 'abc.def.ghi');
});

test('linkSecrets prefiere la lista y descarta vacíos', () => {
  assert.deepEqual(linkSecrets({ MIRROR_LINK_SECRETS: 'a, b ,,c' }), ['a', 'b', 'c']);
  assert.deepEqual(linkSecrets({ MIRROR_LINK_SECRET: 'solo' }), ['solo']);
  assert.deepEqual(linkSecrets({}), []);
});
