/**
 * Los datos del paciente y del estudio en cada cuadro, como en Horos.
 *
 * Con varios pacientes en la misma sesión —el que se informa y la cola que
 * empuja el RIS— y el visor repartido en dos o tres ventanas, la cabecera de
 * una ventana no dice nada de las otras. Cada imagen tiene que decir de quién
 * es. Ver `patientData` para qué va en cada esquina y `fileTags` para de
 * dónde sale lo que el manifiesto no trae.
 *
 * Extensión aparte de `toth-hps` y `toth-propagate` porque no es de colgados
 * ni de herramientas; las tres son decisiones de nuestro puesto.
 */

import { getEnabledElement } from '@cornerstonejs/core';

import { id } from './id.js';
import { fileTags } from './fileTags';
import { mergeTags, TOP_LEFT, TOP_RIGHT, type Line, type Tags } from './patientData';

/** La imagen que el cuadro está mostrando ahora. */
function currentImageId(element?: HTMLElement): string | undefined {
  try {
    return element ? getEnabledElement(element)?.viewport?.getCurrentImageId?.() : undefined;
  } catch {
    return undefined;
  }
}

/** Lo que se sabe de la imagen del cuadro: el manifiesto, completado con el archivo. */
function tagsFor(props): Tags {
  const instance = props.instance ?? props.referenceInstance ?? {};
  return mergeTags(instance, fileTags(currentImageId(props.element)));
}

const fallbackPN = (pn: string) => pn.replace(/\^+/g, ' ').trim();

function overlayItem(line: Line) {
  const render = props =>
    line.text(tagsFor(props), props.formatters?.formatPN ?? fallbackPN) ?? undefined;
  return {
    id: line.id,
    inheritsFrom: 'ohif.overlayItem',
    label: '',
    title: line.title,
    condition: props => Boolean(render(props)),
    contentF: render,
  };
}

const tothOverlayExtension = {
  id,

  // Global y no de modo: así vale en cualquier modo, y gana sobre las esquinas
  // que trae la extensión de cornerstone.
  getCustomizationModule: () => [
    {
      name: 'global',
      value: {
        'viewportOverlay.topLeft': { $set: TOP_LEFT.map(overlayItem) },
        'viewportOverlay.topRight': { $set: TOP_RIGHT.map(overlayItem) },
      },
    },
  ],
};

export default tothOverlayExtension;
