/**
 * «Medir IA»: un botón que deja medido el índice acetabular de una RX de
 * pelvis pediátrica, como dos ángulos que el radiólogo revisa y corrige, o el
 * eje, el mLDFA y el MPTA de cada pierna en una telerradiografía de EEII.
 * Cuál de las dos, lo decide la forma de la imagen (`esTelerradiografia`).
 *
 * Extensión aparte de las otras toth-* porque depende de un servicio externo
 * (el modelo en el Supermicro) y se puede apagar sacándola de la config sin
 * tocar nada más.
 */

import { metaData } from '@cornerstonejs/core';
import { ToolbarService } from '@ohif/core';

import { escucharCorrecciones } from './correcciones';
import { id } from './id.js';
import { medirIndiceAcetabular } from './medirIndiceAcetabular';
import { medirPierna } from './medirPierna';
import { esTelerradiografia } from './pierna';

const BUTTON_ID = 'MedirIndiceAcetabular';

const medirButton = {
  id: BUTTON_ID,
  uiType: 'ohif.toolButton',
  props: {
    icon: 'tool-angle',
    label: 'Medir IA',
    tooltip:
      'Medir con IA: índice acetabular en una RX de pelvis, o eje, mLDFA y MPTA en una telerradiografía de EEII (Mayús + M)',
    commands: 'medirIA',
    evaluate: 'evaluate.action',
  },
};

/** Pierna si la imagen del cuadro activo es una telerradiografía; si no, caderas. */
function medirIA({ servicesManager }) {
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(
    viewportGridService.getActiveViewportId()
  );
  const imageId: string | undefined = viewport?.getCurrentImageId?.();
  const instancia = imageId ? metaData.get('instance', imageId) : undefined;
  return esTelerradiografia(instancia)
    ? medirPierna({ servicesManager })
    : medirIndiceAcetabular({ servicesManager });
}

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

  preRegistration: () => escucharCorrecciones(),

  getCommandsModule: ({ servicesManager }) => ({
    definitions: {
      medirIA: {
        commandFn: () => medirIA({ servicesManager }),
      },
      medirIndiceAcetabular: {
        commandFn: () => medirIndiceAcetabular({ servicesManager }),
      },
      medirPierna: {
        commandFn: () => medirPierna({ servicesManager }),
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
