import extension, { hpSecondScreen } from './index';

/**
 * El protocolo es datos, no lógica, y aun así se rompe callado: si el módulo
 * no carga o el id cambia, `getProtocolById` devuelve nada, el modo cae a su
 * colgado por defecto y el segundo monitor termina mostrando lo mismo que el
 * primero — que es exactamente el problema que este protocolo viene a
 * resolver. Por eso se prueba que carga, y desde qué serie empieza.
 */

const indicesDe = (stageId: string) =>
  hpSecondScreen.stages
    .find(stage => stage.id === stageId)
    .viewports.map(viewport => viewport.displaySets[0].matchedDisplaySetsIndex);

describe('@toth/secondScreen', () => {
  it('la extensión lo publica con el id que usa la URL', () => {
    const [entry] = extension.getHangingProtocolModule();

    expect(entry.name).toBe('@toth/secondScreen');
    expect(entry.protocol).toBe(hpSecondScreen);
  });

  it('ninguna etapa muestra la primera serie: esa es del otro monitor', () => {
    const todos = hpSecondScreen.stages.flatMap(stage =>
      stage.viewports.map(viewport => viewport.displaySets[0].matchedDisplaySetsIndex)
    );

    expect(Math.min(...todos)).toBe(1);
  });

  it('empieza en la segunda serie y sigue de ahí', () => {
    expect(indicesDe('2x2-desde-la-segunda')).toEqual([1, 2, 3, 4]);
    expect(indicesDe('2x1-desde-la-segunda')).toEqual([1, 2]);
    expect(indicesDe('1x1-desde-la-segunda')).toEqual([1]);
  });

  it('abre en 1x1: el modo entra siempre por la primera etapa', () => {
    // No es un detalle de estilo. `Mode.tsx` le pasa `stageIndex: 0` a
    // `hangingProtocolService.run` cuando la URL no trae `stageId`, y ese 0
    // gana sobre `stageActivation`. Si la primera etapa fuera una grilla, un
    // estudio de dos series abriría en 2x2 con tres huecos — que es
    // exactamente lo que hace `@ohif/mnGrid`.
    const [primera] = hpSecondScreen.stages;

    expect(primera.id).toBe('1x1-desde-la-segunda');
    expect(primera.viewports).toHaveLength(1);
  });

  it('la etapa de apertura acepta cualquier estudio, incluso uno de una sola serie', () => {
    const [primera] = hpSecondScreen.stages;

    expect(primera.stageActivation).toBeUndefined();
    expect(primera.viewports[0].viewportOptions.allowUnmatchedView).toBe(true);
  });

  it('las grillas piden series suficientes para llenarse', () => {
    const grillas = hpSecondScreen.stages.slice(1);

    grillas.forEach(stage => {
      expect(stage.stageActivation.enabled.minViewportsMatched).toBe(stage.viewports.length);
    });
  });
});
