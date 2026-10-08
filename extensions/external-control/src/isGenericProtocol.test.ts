import { isGenericProtocol } from './getCommandsModule';

describe('isGenericProtocol', () => {
  it('una grilla que sólo pide imágenes es genérica', () => {
    expect(
      isGenericProtocol({ protocolMatchingRules: [{ attribute: 'numberOfDisplaySetsWithImages' }] })
    ).toBe(true);
  });

  it('una comparación con previa, sin mirar qué estudio es, es genérica', () => {
    expect(isGenericProtocol({ protocolMatchingRules: [{ attribute: 'StudyInstanceUID' }] })).toBe(
      true
    );
  });

  it('un protocolo que pide una modalidad es específico', () => {
    expect(
      isGenericProtocol({
        protocolMatchingRules: [
          { attribute: 'ModalitiesInStudy' },
          { attribute: 'numberOfDisplaySetsWithImages' },
        ],
      })
    ).toBe(false);
  });

  it('el protocolo puede declararlo él mismo', () => {
    expect(
      isGenericProtocol({ generic: false, protocolMatchingRules: [{ attribute: 'StudyInstanceUID' }] })
    ).toBe(false);
  });
});
