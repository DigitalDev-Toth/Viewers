/**
 * La proyección de una serie de mamografía: 'RCC', 'LCC', 'RMLO', 'LMLO', o
 * undefined si no es ninguna de esas (una ML, una pieza quirúrgica…).
 *
 * Primero lo que diga el DICOM —ImageLaterality y ViewCodeSequence— y si no
 * viene, la descripción de la serie. Con el manifiesto de dicom-index casi
 * siempre es lo segundo, y los mamógrafos de los centros usan dos
 * convenciones: "R CC" / "L MLO" y "CC-D" / "MLO-I".
 */

const VIEW_CODES = {
  '399162004': 'CC',
  '399368009': 'MLO',
};

type SeriesLike = {
  SeriesDescription?: string;
  images?: Array<{ ImageLaterality?: string; ViewCodeSequence?: Array<{ CodeValue?: string }> }>;
  instances?: Array<{ ImageLaterality?: string; ViewCodeSequence?: Array<{ CodeValue?: string }> }>;
};

export default function mammoView(series: SeriesLike): string | undefined {
  const instance = series?.images?.[0] ?? series?.instances?.[0];
  const tokens = (series?.SeriesDescription ?? '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);

  const view =
    VIEW_CODES[instance?.ViewCodeSequence?.[0]?.CodeValue] ??
    (tokens.includes('MLO') ? 'MLO' : tokens.includes('CC') ? 'CC' : undefined);

  const laterality = instance?.ImageLaterality;
  const side =
    laterality === 'R' || laterality === 'L'
      ? laterality
      : tokens.some(token => ['R', 'RIGHT', 'D', 'DER', 'DERECHA'].includes(token))
        ? 'R'
        : tokens.some(token => ['L', 'LEFT', 'I', 'IZQ', 'IZQUIERDA'].includes(token))
          ? 'L'
          : undefined;

  return view && side ? side + view : undefined;
}
