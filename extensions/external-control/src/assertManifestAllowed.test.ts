/**
 * El manifiesto decide qué busca y qué muestra el visor. Que el origen que lo
 * pide esté permitido no convierte la URL en confiable: son dos cosas distintas
 * y esta es la que faltaba comprobar.
 */

import { assertManifestAllowed } from './getCommandsModule';

// jsdom sirve la página desde http://localhost/ por defecto.
const PROPIO = 'http://localhost';

describe('assertManifestAllowed', () => {
  it('deja pasar una ruta relativa: es el caso normal', () => {
    expect(assertManifestAllowed('/api/study/1.2.3?format=ohif', [])).toBe(
      '/api/study/1.2.3?format=ohif'
    );
  });

  it('deja pasar una absoluta del mismo origen', () => {
    expect(assertManifestAllowed(`${PROPIO}/api/study/1.2.3`, [])).toBeTruthy();
  });

  it('rechaza otro origen mientras no esté nombrado', () => {
    expect(() => assertManifestAllowed('https://attacker.example/manifiesto.json', [])).toThrow(
      /no está permitido/
    );
  });

  it('acepta el origen que la configuración nombró', () => {
    expect(
      assertManifestAllowed('https://manifiestos.example/x.json', ['https://manifiestos.example'])
    ).toBeTruthy();
  });

  it('el permiso es por origen exacto, no por sufijo', () => {
    // `manifiestos.example.evil.com` no es `manifiestos.example`.
    expect(() =>
      assertManifestAllowed('https://manifiestos.example.evil.com/x.json', [
        'https://manifiestos.example',
      ])
    ).toThrow();
  });

  it('el esquema cuenta: http no es https', () => {
    expect(() =>
      assertManifestAllowed('http://manifiestos.example/x.json', ['https://manifiestos.example'])
    ).toThrow();
  });

  it('rechaza una URL que no se puede interpretar', () => {
    expect(() => assertManifestAllowed('http://[', [])).toThrow(/no es válida/);
  });
});
