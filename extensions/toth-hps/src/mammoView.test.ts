import mammoView from './mammoView';

const serie = (SeriesDescription, instance = {}) => ({ SeriesDescription, images: [instance] });

describe('mammoView', () => {
  it.each([
    ['R CC', 'RCC'],
    ['L CC', 'LCC'],
    ['R MLO', 'RMLO'],
    ['L MLO', 'LMLO'],
    ['CC-D', 'RCC'],
    ['CC-I', 'LCC'],
    ['MLO-D', 'RMLO'],
    ['MLO-I', 'LMLO'],
    ['cc izquierda', 'LCC'],
  ])('%s es %s', (descripcion, vista) => {
    expect(mammoView(serie(descripcion))).toBe(vista);
  });

  it.each([['L ML'], ['R SPECIMEN'], ['CC'], ['']])('%s no es ninguna de las cuatro', descripcion => {
    expect(mammoView(serie(descripcion))).toBeUndefined();
  });

  it.each([
    ['R', 'R-10242', 'CC', 'RCC'],
    ['L', 'R-10242', 'CC', 'LCC'],
    ['R', 'R-10226', 'MLO', 'RMLO'],
    ['L', 'R-10226', 'MLO', 'LMLO'],
  ])(
    'códigos SRT antiguos sin descripción, como manda norteimagen: %s %s → %s',
    (ImageLaterality, CodeValue, ViewPosition, vista) => {
      const instancia = {
        ImageLaterality,
        ViewPosition,
        ViewCodeSequence: [{ CodeValue, CodingSchemeDesignator: 'SRT' }],
      };
      expect(mammoView({ images: [instancia] })).toBe(vista);
    }
  );

  it('sin ViewCodeSequence, usa ViewPosition', () => {
    expect(mammoView({ images: [{ ImageLaterality: 'L', ViewPosition: 'MLO' }] })).toBe('LMLO');
  });

  it('acepta la secuencia de un solo ítem como objeto', () => {
    const instancia = { ImageLaterality: 'R', ViewCodeSequence: { CodeValue: 'R-10242' } };
    expect(mammoView({ images: [instancia] })).toBe('RCC');
  });

  it('una proyección que no es CC ni MLO no se confunde con ellas', () => {
    expect(mammoView({ images: [{ ImageLaterality: 'R', ViewPosition: 'ML' }] })).toBeUndefined();
  });

  it('lo que dice el DICOM manda sobre la descripción', () => {
    const instancia = { ImageLaterality: 'L', ViewCodeSequence: [{ CodeValue: '399368009' }] };
    expect(mammoView(serie('R CC', instancia))).toBe('LMLO');
  });
});
