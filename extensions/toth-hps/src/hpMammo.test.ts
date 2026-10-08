/**
 * Los ids de etapa quedan guardados en la preferencia de cada doctor en el
 * RIS: si este test falla porque un id cambió, el cambio rompe preferencias
 * ya guardadas. Se agregan etapas nuevas; las existentes no se renombran.
 */

jest.mock('i18next', () => ({ t: key => key }), { virtual: true });

import hpMammo from './hpMammo';

const selectores = stage => stage.viewports.map(viewport => viewport.displaySets[0].id);

describe('@toth/mammo', () => {
  it('tiene un id de protocolo estable', () => {
    expect(hpMammo.id).toBe('@toth/mammo');
  });

  it('mantiene los ids de etapa que el RIS puede tener guardados', () => {
    expect(hpMammo.stages.map(stage => stage.id)).toEqual([
      'cc-mlo',
      'cc-compare',
      'cc-1x2',
      'mlo-1x2',
    ]);
  });

  it('cc-1x2 confronta derecha con izquierda en craneocaudal', () => {
    const stage = hpMammo.stages.find(it => it.id === 'cc-1x2');
    expect(stage.viewportStructure.properties).toEqual({ rows: 1, columns: 2 });
    expect(selectores(stage)).toEqual(['RCC', 'LCC']);
  });

  it('mlo-1x2 confronta derecha con izquierda en oblicua', () => {
    const stage = hpMammo.stages.find(it => it.id === 'mlo-1x2');
    expect(stage.viewportStructure.properties).toEqual({ rows: 1, columns: 2 });
    expect(selectores(stage)).toEqual(['RMLO', 'LMLO']);
  });

  it('cada posición exige su proyección, también en la previa', () => {
    const regla = id => hpMammo.displaySetSelectors[id].seriesMatchingRules[0];
    expect(regla('RCC')).toMatchObject({ attribute: 'mammoView', constraint: { equals: 'RCC' }, required: true });
    expect(regla('LMLOPrior').constraint.equals).toBe('LMLO');
  });

  it('actual y previa se deciden por el estudio que se cuelga, no por posición', () => {
    expect(hpMammo.displaySetSelectors.RCC.studyMatchingRules[0].attribute).toBe('isActiveStudy');
    expect(hpMammo.displaySetSelectors.RCCPrior.studyMatchingRules[0].attribute).toBe('isPriorOfActive');
  });

  it('una posición sin su proyección queda vacía, no se rellena con otra', () => {
    hpMammo.stages.forEach(stage =>
      stage.viewports.forEach(viewport =>
        expect(viewport.viewportOptions.allowUnmatchedView).toBe(false)
      )
    );
  });

  it('cada cuadro de cada etapa tiene su propio id de vista', () => {
    const ids = hpMammo.stages.flatMap(stage =>
      stage.viewports.map(viewport => viewport.viewportOptions.id)
    );
    expect(ids).toContain('cc-1x2-RCC');
    expect(ids).toContain('cc-mlo-LMLO');
    expect(ids).toContain('cc-compare-RCCPrior');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('se ofrece en lugar de @ohif/hpMammo, no junto a él', () => {
    expect(hpMammo.replaces).toEqual(['@ohif/hpMammo']);
  });

  it('calza por encima de @ohif/hpMammo, con las mismas reglas', () => {
    const peso = hpMammo.protocolMatchingRules.find(rule => rule.id === 'Mammography').weight;
    expect(peso).toBeGreaterThan(150);
  });
});
