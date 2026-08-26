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

const tothHangingProtocolsExtension = {
  id,

  getHangingProtocolModule: () => [
    {
      name: hpSecondScreen.id,
      protocol: hpSecondScreen,
    },
  ],
};

export default tothHangingProtocolsExtension;
export { hpSecondScreen };
