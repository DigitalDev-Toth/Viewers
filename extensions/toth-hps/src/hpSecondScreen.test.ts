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

  it('las etapas van de más grande a más chica, que es el orden en que se eligen', () => {
    const requeridos = hpSecondScreen.stages.map(
      stage => stage.stageActivation?.enabled?.minViewportsMatched ?? 0
    );

    expect(requeridos).toEqual([...requeridos].sort((a, b) => b - a));
  });

  it('la última etapa acepta cualquier estudio, incluso uno de una sola serie', () => {
    const ultima = hpSecondScreen.stages[hpSecondScreen.stages.length - 1];

    expect(ultima.stageActivation).toBeUndefined();
    expect(ultima.viewports[0].viewportOptions.allowUnmatchedView).toBe(true);
  });
});
