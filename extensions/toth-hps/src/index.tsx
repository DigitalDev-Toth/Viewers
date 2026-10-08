/**
 * Los colgados propios del puesto de diagnóstico.
 *
 * Están acá y no en `@ohif/extension-external-control` a propósito: esa se
 * mantiene libre de todo lo nuestro para poder ofrecerla upstream, y esto es
 * lo contrario — decisiones de nuestro puesto.
 *
 * Se elige por URL, que es como `config/toth.js` le da un colgado distinto a
 * cada monitor: `&hangingProtocolId=@toth/secondScreen`.
 */

import { id } from './id.js';
import hpSecondScreen from './hpSecondScreen';
import hpMammo from './hpMammo';
import { registerStudyAttributes } from './studyAttributes';

const tothHangingProtocolsExtension = {
  id,

  preRegistration({ servicesManager }) {
    // Los usa @toth/mammo para elegir actual y previa.
    registerStudyAttributes(servicesManager.services.hangingProtocolService);
  },

  getHangingProtocolModule: () => [
    {
      name: hpSecondScreen.id,
      protocol: hpSecondScreen,
    },
    {
      name: hpMammo.id,
      protocol: hpMammo,
    },
  ],
};

export default tothHangingProtocolsExtension;
export { hpSecondScreen, hpMammo };
