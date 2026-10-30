/**
 * «Medir IA»: un botón que deja medido el índice acetabular de una RX de
 * pelvis pediátrica, como dos ángulos que el radiólogo revisa y corrige.
 *
 * Extensión aparte de las otras toth-* porque depende de un servicio externo
 * (el modelo en el Supermicro) y se puede apagar sacándola de la config sin
 * tocar nada más.
 */

import { ToolbarService } from '@ohif/core';

import { id } from './id.js';
import { medirIndiceAcetabular } from './medirIndiceAcetabular';

const BUTTON_ID = 'MedirIndiceAcetabular';

const medirButton = {
  id: BUTTON_ID,
  uiType: 'ohif.toolButton',
  props: {
    icon: 'tool-angle',
    label: 'Medir IA',
    tooltip: 'Medir con IA el índice acetabular de esta RX de pelvis (Mayús + M)',
    commands: 'medirIndiceAcetabular',
    evaluate: 'evaluate.action',
  },
};

/** Lo pone a continuación de las herramientas de medición, o al final si no están. */
function insertAfterMeasurementTools(buttonIds: string[] = []): string[] {
  if (buttonIds.includes(BUTTON_ID)) {
    return buttonIds;
  }
  const at = buttonIds.indexOf('MeasurementTools');
  return at === -1
    ? [...buttonIds, BUTTON_ID]
    : [...buttonIds.slice(0, at + 1), BUTTON_ID, ...buttonIds.slice(at + 1)];
}

const tothIaExtension = {
  id,

  getCommandsModule: ({ servicesManager }) => ({
    definitions: {
      medirIndiceAcetabular: {
        commandFn: () => medirIndiceAcetabular({ servicesManager }),
      },
    },
    defaultContext: 'DEFAULT',
  }),

  // Como toth-propagate: sobre los paquetes de botones de cornerstone, para
  // que aparezca en cualquier modo que use la barra estándar.
  getCustomizationModule: () => [
    {
      name: 'global',
      value: {
        'cornerstone.toolbarButtons': { $push: [medirButton] },
        'cornerstone.toolbarSections': {
          [ToolbarService.TOOLBAR_SECTIONS.primary]: { $apply: insertAfterMeasurementTools },
        },
      },
    },
  ],
};

export default tothIaExtension;
