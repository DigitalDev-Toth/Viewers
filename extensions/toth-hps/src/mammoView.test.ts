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

  it('lo que dice el DICOM manda sobre la descripción', () => {
    const instancia = { ImageLaterality: 'L', ViewCodeSequence: [{ CodeValue: '399368009' }] };
    expect(mammoView(serie('R CC', instancia))).toBe('LMLO');
  });
});
