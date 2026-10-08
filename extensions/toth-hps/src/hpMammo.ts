/**
 * Mamografía con las etapas que pide el puesto, todas con id estable.
 *
 * Parte de `@ohif/hpMammo` —mismos selectores RCC/LCC/RMLO/LMLO y mismas
 * áreas de despliegue— y le agrega lo que el radiólogo usa para confrontar
 * izquierda con derecha: una proyección por vez, en 1x2.
 *
 * Los ids de etapa son contrato con el RIS: BioRis guarda por doctor la etapa
 * preferida para cada modalidad (`{"MG": {"protocolId", "stageId"}}`) y la
 * aplica con SET_HANGING_PROTOCOL cada vez que muestra un estudio. Cambiar un
 * id deja esa preferencia apuntando a nada, así que no se cambian: se agregan.
 * Las etapas de upstream no traen id (sólo `name`, que además se traduce), por
 * eso no sirven tal cual.
 */

import hpMammography from '@ohif/extension-default/src/hangingprotocols/hpMammo';

/**
 * Qué serie va en cada posición: la que tenga esa proyección, y ninguna otra.
 *
 * Las reglas de @ohif/hpMammo se apoyan en ViewCodeSequence y
 * PatientOrientation, que el manifiesto de dicom-index no trae, y puntúan en
 * vez de exigir: con ellas la MLO derecha quedaba descartada, la CC derecha
 * empataba con la izquierda, y en una mamografía unilateral el lado que falta
 * se llenaba con el otro. Acá la proyección la calcula `mammoView` (DICOM si
 * viene, la descripción si no) y cada posición la exige.
 */
const reglasDe = vista => [
  { weight: 20, attribute: 'mammoView', constraint: { equals: vista }, required: true },
];

// Actual o previa por el estudio que se cuelga, no por la posición en la
// sesión (ver studyAttributes).
const actual = [{ attribute: 'isActiveStudy', constraint: { equals: true }, required: true }];
const previa = [{ attribute: 'isPriorOfActive', constraint: { equals: true }, required: true }];

const { displaySetSelectors: ohifSelectors } = hpMammography;
const displaySetSelectors = Object.fromEntries(
  Object.keys(ohifSelectors).map(id => [
    id,
    {
      studyMatchingRules: id.endsWith('Prior') ? previa : actual,
      seriesMatchingRules: reglasDe(id.replace(/Prior$/, '')),
    },
  ])
);

/**
 * Una posición sin su proyección queda vacía. OHIF trae allowUnmatchedView,
 * que la llena con cualquier otra serie: en una mamografía unilateral eso
 * ponía la mama izquierda donde va la derecha, que es justo lo que no se puede
 * confundir.
 */
const sinRelleno = viewport => ({
  ...viewport,
  viewportOptions: { ...viewport.viewportOptions, allowUnmatchedView: false },
});
const sinRellenoEnEtapa = stage => ({ ...stage, viewports: stage.viewports.map(sinRelleno) });

const [ccMloStage, ccCompareStage] = hpMammography.stages.map(sinRellenoEnEtapa);
const [rcc, lcc, rmlo, lmlo] = ccMloStage.viewports;

const oneByTwo = {
  type: 'grid',
  layoutType: 'grid',
  properties: { rows: 1, columns: 2 },
};

/**
 * Un id de vista propio para cada cuadro de cada etapa.
 *
 * OHIF guarda la cámara (zoom, pan, área de despliegue) de cada serie y la
 * restaura cuando esa serie vuelve a pantalla; la llave es la serie y, si el
 * cuadro tiene, su `viewportOptions.id`. Sin id, la RCC que ya estaba en un
 * 1x1 volvía con esa cámara al colgarse en la etapa, cortada y corrida,
 * mientras las otras tres sí tomaban el encuadre de mamografía. Con id, cada
 * cuadro de cada etapa tiene su propia memoria.
 */
const conIdDeVista = stage => ({
  ...stage,
  viewports: stage.viewports.map(viewport => ({
    ...viewport,
    viewportOptions: {
      ...viewport.viewportOptions,
      id: `${stage.id}-${viewport.displaySets[0].id}`,
    },
  })),
});

const hpMammo = {
  ...hpMammography,
  id: '@toth/mammo',
  name: 'Mamografía',
  // Mismo propósito y mismas reglas que el de OHIF: al ofrecer formatos, éste
  // va en su lugar y no los dos, con nombres distintos para lo mismo.
  replaces: ['@ohif/hpMammo'],
  displaySetSelectors,
  // Por encima de @ohif/hpMammo, que tiene las mismas reglas: si los dos
  // calzan, manda éste.
  protocolMatchingRules: hpMammography.protocolMatchingRules.map(rule =>
    rule.id === 'Mammography' ? { ...rule, weight: rule.weight + 10 } : rule
  ),
  stages: [
    { ...ccMloStage, id: 'cc-mlo', name: 'CC/MLO' },
    { ...ccCompareStage, id: 'cc-compare', name: 'CC actual / previa' },
    {
      id: 'cc-1x2',
      name: 'CC derecha | izquierda',
      viewportStructure: oneByTwo,
      viewports: [rcc, lcc],
    },
    {
      id: 'mlo-1x2',
      name: 'MLO derecha | izquierda',
      viewportStructure: oneByTwo,
      viewports: [rmlo, lmlo],
    },
  ].map(conIdDeVista),
};

export default hpMammo;
