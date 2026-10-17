/**
 * @jest-environment node
 */

jest.mock('@cornerstonejs/dicom-image-loader', () => ({ wadouri: {} }));

import { decodeValue, tagsFromDataSet } from './fileTags';

const encoder = new TextEncoder();

/** Un dataset de dicom-parser de mentira con los valores dados, en bytes. */
function dataSet(values: Record<string, Uint8Array>) {
  const chunks = Object.values(values);
  const byteArray = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  const elements = {};
  let offset = 0;
  for (const [tag, bytes] of Object.entries(values)) {
    byteArray.set(bytes, offset);
    elements[tag] = { dataOffset: offset, length: bytes.length };
    offset += bytes.length;
  }
  return { byteArray, elements };
}

describe('decodeValue', () => {
  it('UTF-8 con acentos sale bien, no «ClÃ­nica»', () => {
    expect(decodeValue(encoder.encode('Clínica Norte '))).toBe('Clínica Norte');
  });

  it('Latin-1 con acentos también, aunque no se declare', () => {
    expect(decodeValue(Uint8Array.from([0x43, 0x6c, 0xed, 0x6e, 0x69, 0x63, 0x61]))).toBe(
      'Clínica'
    );
  });

  it('quita el relleno y se queda con el primer valor', () => {
    expect(decodeValue(encoder.encode('R\\L\0'))).toBe('R');
    expect(decodeValue(encoder.encode('  '))).toBeUndefined();
  });
});

describe('tagsFromDataSet', () => {
  it('lee por su etiqueta lo que el manifiesto no trae', () => {
    const tags = tagsFromDataSet(
      dataSet({
        x00100030: encoder.encode('19700315'),
        x00080080: encoder.encode('CUIDATE '),
        x00080030: encoder.encode('103245'),
        x00200062: encoder.encode('L '),
      })
    );
    expect(tags).toEqual({
      PatientBirthDate: '19700315',
      InstitutionName: 'CUIDATE',
      StudyTime: '103245',
      ImageLaterality: 'L',
    });
  });

  it('un archivo que todavía no bajó no aporta nada', () => {
    expect(tagsFromDataSet(undefined)).toEqual({});
  });
});
