/**
 * Qué puede pedirle al relay quien trae una cookie válida.
 *
 * Vive aparte de server.mjs por una razón práctica: server.mjs levanta un
 * puerto al importarse, y esta es justo la lógica que hay que poder probar sin
 * levantar nada. Es también la única barrera entre un enlace y el archivo
 * completo, así que conviene que quepa en una pantalla.
 */

// Cada ruta declara de dónde sale el estudio que se está pidiendo, porque hay
// que compararlo contra el del token: sin esa comparación, un enlace a un
// estudio abriría cualquier otro.
//
// /studies e /intensity quedaron fuera a propósito. El token `view` de Mirror
// es por estudio, así que no hay forma de autorizar un listado completo con él;
// y el visor no las usa. Exponerlas sin poder acotarlas sería regalar el
// archivo entero a cualquiera con un enlace válido a un solo estudio.
//
// /ia/caderas no va al relay tal cual: la atiende ia-caderas.mjs, que pide al
// relay el JPEG de esa misma instancia. Por eso se acota igual que /wado. Lo
// mismo su corrección: lleva la query de la medición. /ia/pierna, igual
// (ia-pierna.mjs).
export const API_ROUTES = [
  { re: /^\/wado$/, studyFrom: 'query' },
  { re: /^\/study\/([^/]+)$/, studyFrom: 'path' },
  { re: /^\/study\/([^/]+)\/ohif$/, studyFrom: 'path' },
  { re: /^\/ia\/caderas$/, studyFrom: 'query' },
  { re: /^\/ia\/caderas\/correccion$/, studyFrom: 'query' },
  { re: /^\/ia\/pierna$/, studyFrom: 'query' },
  { re: /^\/ia\/pierna\/correccion$/, studyFrom: 'query' },
];

export function matchApiRoute(apiPath) {
  for (const route of API_ROUTES) {
    const match = route.re.exec(apiPath);
    if (match) {
      return { route, match };
    }
  }
  return null;
}

/** El estudio que la petición está pidiendo, según la ruta. */
export function requestedStudy(route, match, params) {
  if (route.studyFrom !== 'path') {
    return params.get('studyUID');
  }
  // Un `%` mal formado hace lanzar a decodeURIComponent, y una excepción acá
  // bota el proceso. Un estudio que no se puede leer no es el del token.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Esta compuerta lee el primer valor de cada parámetro y el relay (Starlette)
 * el último: con `client=propio&client=ajeno` acá se vería el propio y allá se
 * pediría el ajeno. Una query con claves repetidas no tiene una sola lectura.
 */
function hasRepeatedKeys(params) {
  const keys = [...params.keys()];
  return new Set(keys).size !== keys.length;
}

/**
 * Decide si la petición pasa. Devuelve `null` si sí, o `{status, message}`.
 *
 * @param apiPath  la ruta ya sin el prefijo /api
 * @param params   los query params de la petición
 * @param claims   lo que devolvió verifyLinkToken, o null si no hay cookie
 */
export function authorizeApiRequest(apiPath, params, claims) {
  const matched = matchApiRoute(apiPath);
  if (!matched) {
    return { status: 404, message: 'ruta no permitida' };
  }
  if (!claims) {
    return { status: 401, message: 'sin autorización válida' };
  }
  if (hasRepeatedKeys(params)) {
    return { status: 400, message: 'parámetros repetidos' };
  }

  // El centro se compara siempre: es lo que impide que un token de un cliente
  // alcance el archivo de otro, y vale para los dos scopes. `clients` son los
  // nombres de ESE centro ante el relay (alias de arc2 y conector propio).
  const clients = claims.clients ?? [claims.client];
  if (!clients.includes(params.get('client'))) {
    return { status: 403, message: 'el enlace no autoriza ese centro' };
  }

  // El token de compartir vale para UN estudio. El de sesión autoriza a todo el
  // centro a propósito: es lo que permite que el visor abierto en el puesto de
  // diagnóstico reciba estudios nuevos sin recargarse.
  if (claims.scope !== 'session') {
    const { route, match } = matched;
    if (requestedStudy(route, match, params) !== claims.study_iuid) {
      return { status: 403, message: 'el enlace no autoriza ese estudio' };
    }
  }

  return null;
}
