import { isLeadScreen, otherScreens, shownStudy, windowProtocol } from './screens';

describe('isLeadScreen', () => {
  it('la pantalla 0 es la que abrió el RIS', () => {
    expect(isLeadScreen(0)).toBe(true);
  });

  it('la ventana madre sin pantalla propia también lidera', () => {
    expect(isLeadScreen(-1)).toBe(true);
    expect(isLeadScreen(undefined)).toBe(true);
  });

  it('las demás pantallas siguen, no lideran', () => {
    expect(isLeadScreen(1)).toBe(false);
    expect(isLeadScreen(2)).toBe(false);
  });
});

describe('otherScreens', () => {
  const self = { closed: false };

  it('deja fuera esta ventana, las cerradas y los huecos', () => {
    const second = { closed: false };
    const closed = { closed: true };
    const windows = [self, second, closed, undefined];
    expect(otherScreens(windows, self)).toEqual([{ screenNumber: 1, window: second }]);
  });

  it('sin ventanas lanzadas no hay a quién avisar', () => {
    expect(otherScreens(undefined, self)).toEqual([]);
    expect(otherScreens([self], self)).toEqual([]);
  });
});

describe('windowProtocol', () => {
  it('lee el colgado y la etapa de la URL de la ventana', () => {
    expect(windowProtocol('?hangingProtocolId=%40toth%2FsecondScreen&stageId=2x2')).toEqual({
      protocolId: '@toth/secondScreen',
      stageId: '2x2',
    });
  });

  it('no inventa etapa cuando no hay', () => {
    expect(windowProtocol('?a=1&hangingProtocolId=mn')).toEqual({ protocolId: 'mn' });
  });

  it('sin colgado en la URL, decide OHIF', () => {
    expect(windowProtocol('?StudyInstanceUIDs=1.2.3')).toEqual({});
    expect(windowProtocol('?hangingProtocolId=')).toEqual({});
  });

  it('no distingue mayúsculas, como el modo', () => {
    expect(windowProtocol('?hangingprotocolid=mn')).toEqual({ protocolId: 'mn' });
  });
});

describe('shownStudy', () => {
  const displaySetStudy = uid => ({ 'ds-a': 'study-A', 'ds-b': 'study-B' })[uid];

  it('es el estudio del viewport activo', () => {
    const viewports = new Map([
      ['v1', { displaySetInstanceUIDs: ['ds-a'] }],
      ['v2', { displaySetInstanceUIDs: ['ds-b'] }],
    ]);
    expect(
      shownStudy({ activeViewportId: 'v2', viewports, displaySetStudy, activeStudyUID: 'study-A' })
    ).toBe('study-B');
  });

  it('con el viewport activo vacío, el último estudio traído a pantalla', () => {
    const viewports = new Map([['v1', { displaySetInstanceUIDs: [] }]]);
    expect(
      shownStudy({ activeViewportId: 'v1', viewports, displaySetStudy, activeStudyUID: 'study-A' })
    ).toBe('study-A');
  });

  it('sin nada en pantalla no hay qué seguir', () => {
    expect(shownStudy({ displaySetStudy, activeStudyUID: null })).toBeNull();
  });
});
