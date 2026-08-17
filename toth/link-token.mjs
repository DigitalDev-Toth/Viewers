/**
 * Verificación de los enlaces firmados de Mirror.
 *
 * Es el mismo token que ya abre un estudio en mirror.cui.date: JWT HS256 con
 * `{scope:"view", study_iuid, client, iat, exp}`, firmado con
 * MIRROR_LINK_SECRET. Reusarlo tal cual significa que quien hoy genera esos
 * enlaces no tiene que emitir nada nuevo para OHIF — cambia el dominio y nada
 * más — y que no aparece un segundo secreto que rotar.
 *
 * Puerto directo de services/auth.php de mirror-std-v2. Las validaciones se
 * mantienen una a una a propósito: si las dos implementaciones divergen, un
 * token aceptado por una y rechazado por la otra es un bug muy difícil de ver.
 */

import crypto from 'node:crypto';

// Lista para permitir rotación: se firma con el primero y se sigue aceptando
// el anterior hasta que expiren los enlaces ya repartidos.
export function linkSecrets(env = process.env) {
  const many = (env.MIRROR_LINK_SECRETS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (many.length) return many;
  const one = (env.MIRROR_LINK_SECRET ?? '').trim();
  return one ? [one] : [];
}

function base64urlDecode(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signatureMatches(signingInput, providedB64, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(providedB64);
  // timingSafeEqual exige el mismo largo; comparar el largo antes no filtra
  // nada útil (es público) pero evita que lance.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const STUDY_IUID_RE = /^[0-9.]{10,128}$/;
const CLIENT_RE = /^[a-z0-9_-]{1,32}$/;

// `view` es el enlace de Mirror: un estudio, para compartir afuera.
//
// `session` es el puesto de diagnóstico: el radiólogo deja el visor abierto en
// su segunda pantalla toda la jornada y el RIS le va empujando estudios. Atarlo
// a un estudio haría falta reabrir el visor —y perder mediciones, layout y
// caché— en cada informe. Vale para todo el centro (`client`), que es lo que el
// radiólogo ya puede ver desde el RIS: no amplía su acceso real, sólo evita
// pedir un token nuevo por estudio.
const SCOPES = new Set(['view', 'session']);

/**
 * Devuelve `{scope, study_iuid, client, exp}` si el token es válido, o null.
 * `study_iuid` es null en los de sesión, que no acotan por estudio.
 *
 * Nunca lanza ni distingue el motivo del rechazo hacia afuera: un atacante no
 * tiene por qué saber si falló la firma, el scope o la expiración.
 */
export function verifyLinkToken(token, { secrets = linkSecrets(), maxTtlSeconds, now } = {}) {
  if (typeof token !== 'string' || token === '') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  if (!secrets.length) {
    console.error('[auth] MIRROR_LINK_SECRET(S) no configurado');
    return null;
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  if (!secrets.some(secret => signatureMatches(signingInput, signatureB64, secret))) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const scope = String(payload.scope ?? '');
  if (!SCOPES.has(scope)) return null;

  const client = String(payload.client ?? '');
  if (!CLIENT_RE.test(client)) return null;

  let studyIuid = null;
  if (scope === 'view') {
    studyIuid = String(payload.study_iuid ?? '');
    if (!STUDY_IUID_RE.test(studyIuid)) return null;
  } else if (payload.study_iuid != null) {
    // Un token de sesión que además nombra un estudio es ambiguo: no se sabría
    // si la compuerta debe acotar o no. Se rechaza en vez de elegir por él.
    return null;
  }

  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;

  const nowSeconds = now ?? Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) return null;

  // Tope de vigencia: sin esto, quien firma podría emitir un enlace eterno y
  // el revocarlo dependería de rotar el secreto para todos.
  const maxTtl = maxTtlSeconds ?? Number(process.env.MIRROR_MAX_TOKEN_TTL_SECONDS ?? 86400);
  if (exp <= iat || exp - iat > maxTtl) return null;

  return { scope, study_iuid: studyIuid, client, exp };
}

export const COOKIE_NAME = 'mirror_auth';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

/**
 * `secure` sólo cuando la conexión es HTTPS de verdad. Detrás del LB, Cloud
 * Run termina TLS y reenvía HTTP al contenedor, así que hay que mirar
 * X-Forwarded-Proto; marcarla `secure` sobre http://localhost haría que el
 * navegador la descarte y todo diera 401 en desarrollo.
 */
export function buildCookie(token, claims, isHttps) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(claims.exp * 1000).toUTCString()}`,
  ];
  if (isHttps) attrs.push('Secure');
  return attrs.join('; ');
}

export function requestIsHttps(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  return forwarded === 'https' || Boolean(req.socket?.encrypted);
}
