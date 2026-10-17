/**
 * Los atributos que el manifiesto no trae, leídos del archivo DICOM que el
 * visor ya descargó para mostrar la imagen.
 *
 * Las imágenes se piden como DICOM crudo por WADO-URI y el cargador de
 * Cornerstone guarda cada archivo ya parseado. Leer de ahí no cuesta nada ni
 * pide nada a la red, y evita tener que sumar campos al manifiesto de
 * dicom-index — que se sirve desde el conector de cada centro, así que
 * cambiarlo es actualizar todos los centros.
 *
 * Mientras la imagen no termina de bajar, el archivo no está: el cuadro
 * muestra lo del manifiesto y se completa solo cuando se redibuja.
 */

import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { Keyword, Tags } from './patientData';

/** Dónde vive cada atributo en el archivo. */
const TAGS: Record<Keyword, string> = {
  PatientName: 'x00100010',
  PatientID: 'x00100020',
  PatientBirthDate: 'x00100030',
  PatientSex: 'x00100040',
  PatientAge: 'x00101010',
  InstitutionName: 'x00080080',
  StudyDate: 'x00080020',
  StudyTime: 'x00080030',
  StudyDescription: 'x00081030',
  AccessionNumber: 'x00080050',
  SeriesNumber: 'x00200011',
  SeriesDescription: 'x0008103e',
  ImageLaterality: 'x00200062',
  Laterality: 'x00200060',
  ViewPosition: 'x00185101',
};

type DataSet = {
  byteArray: Uint8Array;
  elements: Record<string, { dataOffset: number; length: number } | undefined>;
};

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('windows-1252');

/**
 * Los bytes de un valor como texto.
 *
 * `dataSet.string()` de dicom-parser los toma de a uno, como Latin-1, y una
 * «Clínica» en UTF-8 sale «ClÃ­nica». Los equipos además no siempre declaran
 * bien su juego de caracteres. Así que se prueba UTF-8, que rechaza casi
 * cualquier texto que no lo sea, y si no calza se lee como Latin-1.
 */
export function decodeValue(bytes: Uint8Array): string | undefined {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) {
    end -= 1;
  }
  const trimmed = bytes.subarray(0, end);
  let value: string;
  try {
    value = utf8.decode(trimmed);
  } catch {
    value = latin1.decode(trimmed);
  }
  // Un atributo con varios valores: el primero.
  const first = value.split('\\')[0].trim();
  return first || undefined;
}

export function tagsFromDataSet(dataSet: DataSet | undefined): Tags {
  const tags: Tags = {};
  if (!dataSet?.elements || !dataSet.byteArray) {
    return tags;
  }
  for (const [keyword, tag] of Object.entries(TAGS) as Array<[Keyword, string]>) {
    const element = dataSet.elements[tag];
    if (!element || !element.length) {
      continue;
    }
    const value = decodeValue(
      dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + element.length)
    );
    if (value !== undefined) {
      tags[keyword] = value;
    }
  }
  return tags;
}

/** Lo que el archivo de esta imagen dice, si ya está bajado. */
export function fileTags(imageId: string | undefined): Tags {
  if (!imageId) {
    return {};
  }
  try {
    const { url } = wadouri.parseImageId(imageId);
    return tagsFromDataSet(wadouri.dataSetCacheManager.get(url) as DataSet | undefined);
  } catch {
    // Una imagen que no viene de WADO-URI (una reconstrucción, un video):
    // queda lo del manifiesto.
    return {};
  }
}
