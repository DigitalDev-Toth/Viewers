import { Types } from '@ohif/core';

/**
 * El colgado del segundo monitor de diagnóstico: lo que el primero no muestra.
 *
 * El monitor principal abre con el colgado que OHIF elija por su cuenta —tiene
 * reglas por modalidad y sabe más que nosotros—, así que acá no se decide qué
 * ver, sino desde dónde: este protocolo empieza en la **segunda** serie.
 *
 * Es `@ohif/mnGrid` corrido en uno.
 *
 * El orden de las etapas importa y no es el que uno esperaría: **el modo abre
 * siempre en la primera**. `Mode.tsx` calcula el índice de etapa y, cuando la
 * URL no trae `stageId`, `getStageIndex` devuelve 0; ese 0 llega a
 * `hangingProtocolService.run` y gana sobre toda la escalera de
 * `stageActivation`, que en la práctica sólo sirve para elegir a mano después.
 * Es también la razón por la que `@ohif/mnGrid` abre siempre en 2x2 aunque el
 * estudio traiga una sola serie.
 *
 * Así que la primera etapa es la que tiene que servir para el caso común —una
 * serie por monitor— y las grillas quedan disponibles para cuando el
 * radiólogo las pida.
 */

const viewportOptions = {
  toolGroupId: 'default',
  // Sin esto, un estudio de una sola serie no tiene con qué llenar este
  // monitor y el colgado falla en vez de dejarlo vacío.
  allowUnmatchedView: true,
};

/** Los display sets con imágenes, en el orden en que el visor los tiene. */
const nextDisplaySetId = 'nextDisplaySetId';

const displaySetSelectors = {
  [nextDisplaySetId]: {
    seriesMatchingRules: [
      {
        weight: 10,
        attribute: 'numImageFrames',
        constraint: { greaterThan: { value: 0 } },
      },
    ],
  },
};

/** El viewport que muestra la serie número `index`, contando desde cero. */
const viewportShowing = (index: number) => ({
  viewportOptions,
  displaySets: [{ id: nextDisplaySetId, matchedDisplaySetsIndex: index }],
});

const grid = (rows: number, columns: number) => ({
  layoutType: 'grid',
  properties: { rows, columns },
});

const hpSecondScreen: Types.HangingProtocol.Protocol = {
  id: '@toth/secondScreen',
  name: 'Segundo monitor',
  description: 'Las series que el monitor principal no está mostrando',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors,
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', ...viewportOptions },
    displaySets: [{ id: nextDisplaySetId, matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      // La primera, y por lo tanto con la que abre. Sin regla de activación:
      // tiene que aceptar cualquier estudio, incluido uno de una sola serie
      // — ahí este monitor queda vacío, que es preferible a repetir la imagen
      // del otro.
      id: '1x1-desde-la-segunda',
      name: '1x1',
      viewportStructure: grid(1, 1),
      viewports: [viewportShowing(1)],
    },
    // Las grillas quedan para elegir a mano. Su `stageActivation` no decide
    // con cuál se abre —eso lo fija el modo— pero sí impide elegir una que no
    // se pueda llenar.
    {
      id: '2x1-desde-la-segunda',
      name: '2x1',
      stageActivation: { enabled: { minViewportsMatched: 2 } },
      viewportStructure: grid(1, 2),
      viewports: [1, 2].map(viewportShowing),
    },
    {
      id: '2x2-desde-la-segunda',
      name: '2x2',
      stageActivation: { enabled: { minViewportsMatched: 4 } },
      viewportStructure: grid(2, 2),
      viewports: [1, 2, 3, 4].map(viewportShowing),
    },
  ],
};

export default hpSecondScreen;
