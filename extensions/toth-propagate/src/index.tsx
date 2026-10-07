/**
 * El botón «Propagar» de Horos, para el ventaneo. Ver `windowLevelPropagation`.
 *
 * Extensión aparte de `toth-hps` porque aquella es de colgados y ésta de
 * herramientas; las dos son decisiones de nuestro puesto.
 */

import { ToolbarService } from '@ohif/core';
import { utils } from '@ohif/ui-next';

import { id } from './id.js';
import * as windowLevelPropagation from './windowLevelPropagation';

const BUTTON_ID = 'PropagateWindowLevel';
const EVALUATE = 'evaluate.toth.propagateWindowLevel';

const propagateButton = {
  id: BUTTON_ID,
  uiType: 'ohif.toolButton',
  props: {
    icon: 'tool-stack-image-sync',
    label: 'Propagar ventaneo',
    tooltip:
      'Propagar el ventaneo a las series de la misma modalidad. Alt lo invierte mientras se mantiene.',
    commands: 'toggleWindowLevelPropagation',
    evaluate: EVALUATE,
  },
};

/** Lo pone a continuación de la herramienta de ventaneo, o al final si no está. */
function insertAfterWindowLevel(buttonIds: string[] = []): string[] {
  if (buttonIds.includes(BUTTON_ID)) {
    return buttonIds;
  }
  const at = buttonIds.indexOf('WindowLevel');
  return at === -1
    ? [...buttonIds, BUTTON_ID]
    : [...buttonIds.slice(0, at + 1), BUTTON_ID, ...buttonIds.slice(at + 1)];
}

const tothPropagateExtension = {
  id,

  onModeEnter({ servicesManager, commandsManager }) {
    windowLevelPropagation.start({ servicesManager, commandsManager });
  },

  onModeExit() {
    windowLevelPropagation.stop();
  },

  getCommandsModule: () => ({
    definitions: {
      toggleWindowLevelPropagation: {
        commandFn: () => windowLevelPropagation.toggle(),
      },
    },
    defaultContext: 'DEFAULT',
  }),

  getToolbarModule: () => [
    {
      name: EVALUATE,
      evaluate: () => ({
        className: utils.getToggledClassName(windowLevelPropagation.isEnabled()),
      }),
    },
  ],

  // Sobre los paquetes de botones de cornerstone y no sobre los de un modo,
  // para que aparezca en cualquier modo que use la barra estándar.
  getCustomizationModule: () => [
    {
      name: 'global',
      value: {
        'cornerstone.toolbarButtons': { $push: [propagateButton] },
        'cornerstone.toolbarSections': {
          [ToolbarService.TOOLBAR_SECTIONS.primary]: { $apply: insertAfterWindowLevel },
        },
      },
    },
  ],
};

export default tothPropagateExtension;
