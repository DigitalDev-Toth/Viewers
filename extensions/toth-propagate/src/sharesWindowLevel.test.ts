import { isPropagating, sharesWindowLevel, type SeriesTraits } from './sharesWindowLevel';

const ct: SeriesTraits = { modality: 'CT', isColor: false, isSuv: false };

describe('sharesWindowLevel', () => {
  it('propaga entre series de la misma modalidad', () => {
    expect(sharesWindowLevel(ct, { ...ct })).toBe(true);
    expect(sharesWindowLevel({ ...ct, modality: 'DX' }, { ...ct, modality: 'DX' })).toBe(true);
  });

  it('no propaga entre modalidades distintas, ni sin modalidad', () => {
    expect(sharesWindowLevel(ct, { ...ct, modality: 'MR' })).toBe(false);
    expect(sharesWindowLevel({ ...ct, modality: undefined }, { ...ct, modality: undefined })).toBe(
      false
    );
  });

  it('nunca propaga en CR ni en NM, como Horos', () => {
    for (const modality of ['CR', 'NM']) {
      expect(sharesWindowLevel({ ...ct, modality }, { ...ct, modality })).toBe(false);
    }
  });

  it('no mezcla color con gris', () => {
    expect(sharesWindowLevel(ct, { ...ct, isColor: true })).toBe(false);
  });

  it('exige el mismo mapa de color, y trata «sin mapa» como escala de grises', () => {
    expect(sharesWindowLevel(ct, { ...ct, colormap: 'Grayscale' })).toBe(true);
    expect(sharesWindowLevel(ct, { ...ct, colormap: 'hot_iron' })).toBe(false);
  });

  it('en PET exige el mismo estado de SUV', () => {
    const pt: SeriesTraits = { modality: 'PT', isColor: false, isSuv: true };
    expect(sharesWindowLevel(pt, { ...pt })).toBe(true);
    expect(sharesWindowLevel(pt, { ...pt, isSuv: false })).toBe(false);
    // Fuera de PET el SUV no cuenta.
    expect(sharesWindowLevel(ct, { ...ct, isSuv: true })).toBe(true);
  });
});

describe('isPropagating', () => {
  it('Alt invierte el botón mientras se mantiene', () => {
    expect(isPropagating(false, false)).toBe(false);
    expect(isPropagating(false, true)).toBe(true);
    expect(isPropagating(true, false)).toBe(true);
    expect(isPropagating(true, true)).toBe(false);
  });
});
