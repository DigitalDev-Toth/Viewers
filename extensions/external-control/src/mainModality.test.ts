import { mainModality } from './getCommandsModule';

const series = (...modalities) => modalities.map(Modality => ({ Modality }));

describe('mainModality', () => {
  it('es la de la mayoría de las series', () => {
    expect(mainModality(series('CT', 'CT', 'CT', 'MR'))).toBe('CT');
  });

  it('no cuenta informes, estados de presentación ni objetos clave', () => {
    expect(mainModality(series('SR', 'SR', 'SR', 'PR', 'KO', 'MG'))).toBe('MG');
  });

  it('un estudio sin imágenes no tiene modalidad principal', () => {
    expect(mainModality(series('SR', 'KO'))).toBeNull();
    expect(mainModality([])).toBeNull();
  });
});
