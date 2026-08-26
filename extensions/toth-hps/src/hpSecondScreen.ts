import { Types } from '@ohif/core';

/**
 * El colgado del segundo monitor de diagnóstico: lo que el primero no muestra.
 *
 * El monitor principal abre con el colgado que OHIF elija por su cuenta —tiene
 * reglas por modalidad y sabe más que nosotros—, así que acá no se decide qué
 * ver, sino desde dónde: este protocolo empieza en la **segunda** serie.
 *
 * Es `@ohif/mnGrid` corrido en uno. Las etapas se activan solas según cuántas
 * series queden: dos series dan una en cada monitor, cinco dejan la primera en
 * el principal y las otras cuatro acá en 2x2.
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
    // Gana la primera etapa que se active, así que van de más a menos: la
    // grilla sólo aparece cuando hay series suficientes para llenarla.
    {
      id: '2x2-desde-la-segunda',
      name: '2x2',
      stageActivation: { enabled: { minViewportsMatched: 4 } },
      viewportStructure: grid(2, 2),
      viewports: [1, 2, 3, 4].map(viewportShowing),
    },
    {
      id: '2x1-desde-la-segunda',
      name: '2x1',
      stageActivation: { enabled: { minViewportsMatched: 2 } },
      viewportStructure: grid(1, 2),
      viewports: [1, 2].map(viewportShowing),
    },
    {
      // Sin regla de activación: es la última y tiene que aceptar cualquier
      // cosa, incluido un estudio de una sola serie — ahí este monitor queda
      // vacío, que es preferible a repetir la imagen del otro.
      id: '1x1-desde-la-segunda',
      name: '1x1',
      viewportStructure: grid(1, 1),
      viewports: [viewportShowing(1)],
    },
  ],
};

export default hpSecondScreen;
