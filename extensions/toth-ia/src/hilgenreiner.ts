/**
 * Las dos caderas comparten la línea de Hilgenreiner: cada Cobb de «Medir IA»
 * lleva su copia (sus dos primeros puntos, ver `cobbCaderas`) y, cuando el
 * radiólogo mueve la de una, la otra la sigue. Así se ve y se corrige como
 * una sola línea, y los dos ángulos se recalculan.
 *
 * Cornerstone no tiene anotaciones con puntos compartidos: la copia se hace al
 * oír ANNOTATION_MODIFIED, en cada paso del arrastre y al deshacer o rehacer.
 * Se avisa como un movimiento de la otra cadera, así que también se guarda su
 * corrección (`correcciones.ts`): su ángulo cambió aunque el radiólogo no la
 * haya tocado.
 */

import { eventTarget, getEnabledElementByViewportId } from '@cornerstonejs/core';
import {
  Enums as csToolsEnums,
  annotation as csAnnotation,
  utilities as csToolsUtils,
} from '@cornerstonejs/tools';

const CAMBIOS = new Set<string>([
  csToolsEnums.ChangeTypes.HandlesUpdated,
  csToolsEnums.ChangeTypes.History,
]);

type Pareja = { otra: string; viewportId: string };

const PAREJAS = new Map<string, Pareja>();

/** Que las dos caderas recién creadas en `viewportId` muevan juntas su Hilgenreiner. */
export function compartirHilgenreiner(a: string, b: string, viewportId: string) {
  PAREJAS.set(a, { otra: b, viewportId });
  PAREJAS.set(b, { otra: a, viewportId });
}

const iguales = (p: number[], q: number[]) => p.every((v, i) => v === q[i]);

function alModificar(evt: Event) {
  const { annotation, changeType, viewportId } = (evt as CustomEvent).detail ?? {};
  const pareja = PAREJAS.get(annotation?.annotationUID);
  if (!pareja || !CAMBIOS.has(changeType)) {
    return;
  }
  const otra = csAnnotation.state.getAnnotation(pareja.otra);
  const [a, b] = annotation.data?.handles?.points ?? [];
  const puntos = otra?.data?.handles?.points as number[][] | undefined;
  if (!a || !b || !puntos || (iguales(a, puntos[0]) && iguales(b, puntos[1]))) {
    return;
  }
  puntos[0] = [...a];
  puntos[1] = [...b];
  otra.invalidated = true;
  const donde = viewportId ?? pareja.viewportId;
  csAnnotation.state.triggerAnnotationModified(
    otra,
    getEnabledElementByViewportId(donde)?.viewport?.element,
    csToolsEnums.ChangeTypes.HandlesUpdated
  );
  csToolsUtils.triggerAnnotationRenderForViewportIds([donde]);
}

function alBorrar(evt: Event) {
  const uid = (evt as CustomEvent).detail?.annotation?.annotationUID;
  const pareja = PAREJAS.get(uid);
  if (pareja) {
    PAREJAS.delete(uid);
    PAREJAS.delete(pareja.otra);
  }
}

let escuchando = false;

export function escucharHilgenreiner() {
  if (escuchando) {
    return;
  }
  escuchando = true;
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, alModificar);
  eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_REMOVED, alBorrar);
}
