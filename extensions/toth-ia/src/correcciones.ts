/**
 * Las correcciones del radiólogo a los ángulos de «Medir IA», para entrenar el
 * modelo con puntos de experto.
 *
 * Cornerstone avisa (ANNOTATION_MODIFIED) en cada paso del arrastre, no al
 * soltar. Por eso cada ángulo se guarda ESPERA_MS después de su último
 * movimiento, y sólo si los puntos cambiaron desde lo último que se mandó: el
 * servicio anota cada envío y al entrenar se usa el último de cada imagen y
 * cadera. Si el radiólogo cierra o cambia de estudio antes, lo pendiente sale
 * en ese momento.
 *
 * Sólo se siguen los ángulos que creó el botón: de uno dibujado a mano no se
 * sabe qué mide. Borrar un ángulo no se anota, porque cerrar el estudio
 * también los borra y no hay cómo distinguirlo.
 *
 * Si el envío falla no se avisa al radiólogo (no es su problema): se reintenta
 * con el próximo movimiento.
 */

import { eventTarget, utilities as csUtils } from '@cornerstonejs/core';
import { Enums as csToolsEnums } from '@cornerstonejs/tools';

import { cambiaron, tresDesdeCobb, urlCorreccion, type Cuatro, type Tres } from './medicion';

const ESPERA_MS = 2000;
const CAMBIOS = new Set<string>([
  csToolsEnums.ChangeTypes.HandlesUpdated,
  csToolsEnums.ChangeTypes.History, // deshacer y rehacer
]);

type Seguido = {
  url: string; // la de la medición: la corrección va al lado
  imageId: string;
  // Lo que identifica el ángulo, distinto en caderas ({cadera, mitad}) y en la
  // pierna ({pierna, mitad, medida}); el servidor del visor valida cada forma.
  campos: Record<string, string>;
  modelo: string;
  puntosIa: Tres;
  enviados: Tres;
  anotacion?: { data?: { handles?: { points?: number[][] } } };
  reloj?: ReturnType<typeof setTimeout>;
};

const SEGUIDOS = new Map<string, Seguido>();

/** Empieza a seguir un ángulo recién creado por el botón. `puntosIa`, en píxeles del DICOM. */
export function seguirAngulo(
  annotationUID: string,
  datos: Omit<Seguido, 'enviados' | 'anotacion' | 'reloj'>
) {
  SEGUIDOS.set(annotationUID, { ...datos, enviados: datos.puntosIa });
}

const centesimas = (n: number) => Math.round(n * 100) / 100;

/**
 * Los tres puntos en píxeles del DICOM, con el centro del primer píxel como
 * (0, 0) igual que el servicio. Los cuatro de un Cobb de cadera pasan a los
 * tres de siempre con `tresDesdeCobb`, con el punto lateral a la distancia del
 * cartílago que le dio la IA: si no se tocó nada, salen los mismos `puntosIa`.
 */
function puntosImagen(s: Seguido): Tres | null {
  const puntos = s.anotacion?.data?.handles?.points;
  if (!Array.isArray(puntos) || (puntos.length !== 3 && puntos.length !== 4)) {
    return null;
  }
  const imagen = puntos.map(p => {
    const [x, y] = csUtils.worldToImageCoords(s.imageId, p as [number, number, number]);
    return [centesimas(x - 0.5), centesimas(y - 0.5)];
  });
  if (imagen.length === 3) {
    return imagen as Tres;
  }
  const [lateral, tcc] = s.puntosIa;
  const largo = Math.hypot(lateral[0] - tcc[0], lateral[1] - tcc[1]);
  return tresDesdeCobb(imagen as Cuatro, largo).map(p => p.map(centesimas)) as Tres;
}

function enviar(uid: string, keepalive = false) {
  const s = SEGUIDOS.get(uid);
  if (!s) {
    return;
  }
  clearTimeout(s.reloj);
  s.reloj = undefined;
  const puntos = puntosImagen(s);
  if (!puntos || !cambiaron(puntos, s.enviados)) {
    return;
  }
  const anteriores = s.enviados;
  s.enviados = puntos;
  fetch(urlCorreccion(s.url), {
    method: 'POST',
    credentials: 'same-origin',
    keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      anotacion: uid,
      ...s.campos,
      modelo: s.modelo,
      puntos_ia: s.puntosIa,
      puntos,
    }),
  })
    .then(r => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
    })
    .catch(err => {
      // Sólo si nadie mandó algo más nuevo mientras tanto.
      if (s.enviados === puntos) {
        s.enviados = anteriores;
      }
      console.warn(`toth-ia: no se guardó la corrección (${err?.message ?? err})`);
    });
}

function alModificar(evt: Event) {
  const { annotation, changeType } = (evt as CustomEvent).detail ?? {};
  const s = SEGUIDOS.get(annotation?.annotationUID);
  if (!s || !CAMBIOS.has(changeType)) {
    return;
  }
  s.anotacion = annotation;
  clearTimeout(s.reloj);
  s.reloj = setTimeout(() => enviar(annotation.annotationUID), ESPERA_MS);
}

function alBorrar(evt: Event) {
  const uid = (evt as CustomEvent).detail?.annotation?.annotationUID;
  if (SEGUIDOS.get(uid)?.reloj) {
    enviar(uid, true);
  }
  SEGUIDOS.delete(uid);
}

/** Al salir de la página: lo pendiente sale ya, con keepalive para que sobreviva al cierre. */
function alSalir() {
  for (const [uid, s] of SEGUIDOS) {
    if (s.reloj) {
      enviar(uid, true);
    }
  }
}

let escuchando = false;

export function escucharCorrecciones() {
  if (escuchando) {
    return;
  }
  escuchando = true;
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, alModificar);
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_REMOVED, alBorrar);
  window.addEventListener('pagehide', alSalir);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      alSalir();
    }
  });
}
