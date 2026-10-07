/**
 * RELOAD_SESSION navigates the viewer, so where it may go is the whole of its
 * safety: an allowed host gets to hand over new credentials, not to send the
 * radiologist's window anywhere it likes.
 */

import { assertReloadUrl } from './getCommandsModule';

const here = window.location.origin;

describe('assertReloadUrl', () => {
  it('acepta el enlace /open de este mismo visor', () => {
    expect(assertReloadUrl(`${here}/open?token=abc&study=1.2.3`)).toBe(
      `${here}/open?token=abc&study=1.2.3`
    );
  });

  it('resuelve una ruta relativa contra el visor', () => {
    expect(assertReloadUrl('/open?token=abc')).toBe(`${here}/open?token=abc`);
  });

  it.each([
    ['otro origen', 'https://attacker.example/open?token=abc'],
    ['otra ruta del visor', `${here}/viewer?url=https://attacker.example/x.json`],
    ['un esquema javascript', 'javascript:alert(1)'],
    ['una ruta que sólo empieza igual', `${here}/opener`],
  ])('rechaza %s', (_, url) => {
    expect(() => assertReloadUrl(url)).toThrow(/sólo se puede recargar/);
  });
});
