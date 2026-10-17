/**
 * Qué dice cada cuadro sobre el paciente y el estudio, sin servicios detrás:
 * de qué atributos sale cada línea y cómo se escribe.
 *
 * El reparto copia la plantilla de Horos (`AnnotationsDefault.plist`): el
 * paciente y el estudio arriba, y la lateralidad a la vista. Horos la lee de
 * `ImageLaterality` y, si falta, de `Laterality` (`DCMPix.m`); acá igual.
 */

/** Los atributos que se muestran, por su palabra clave DICOM. */
export const KEYWORDS = [
  'PatientName',
  'PatientID',
  'PatientBirthDate',
  'PatientSex',
  'PatientAge',
  'InstitutionName',
  'StudyDate',
  'StudyTime',
  'StudyDescription',
  'AccessionNumber',
  'SeriesNumber',
  'SeriesDescription',
  'ImageLaterality',
  'Laterality',
  'ViewPosition',
] as const;

export type Keyword = (typeof KEYWORDS)[number];
export type Tags = Partial<Record<Keyword, string>>;

/** Un valor de DICOM como texto, o nada si viene vacío. */
export function text(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return text(value[0]);
  }
  if (typeof value === 'object') {
    // Un PN naturalizado: `{Alphabetic: 'PÉREZ^JUANA'}`.
    return text((value as { Alphabetic?: unknown }).Alphabetic);
  }
  const result = String(value).trim();
  return result || undefined;
}

/**
 * Lo que dice el manifiesto manda, y el archivo completa lo que falta.
 *
 * El índice ya limpió los nombres —el juego de caracteres mal declarado, el
 * relleno— así que donde los dos tienen el dato, el del manifiesto es el
 * bueno. El archivo trae lo que el manifiesto no: el nacimiento, la hora, la
 * institución.
 */
export function mergeTags(fromManifest: Tags, fromFile: Tags): Tags {
  const merged: Tags = {};
  for (const keyword of KEYWORDS) {
    const value = text(fromManifest[keyword]) ?? text(fromFile[keyword]);
    if (value !== undefined) {
      merged[keyword] = value;
    }
  }
  return merged;
}

/** `YYYYMMDD` o `YYYY-MM-DD` como sus tres partes, o nada si no es una fecha. */
function dateParts(value?: string): [number, number, number] | undefined {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value ?? '');
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match.map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? [year, month, day] : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Día-mes-año, como se escriben las fechas acá. */
export function formatDate(value?: string): string | undefined {
  const parts = dateParts(value);
  return parts ? `${pad(parts[2])}-${pad(parts[1])}-${parts[0]}` : undefined;
}

/** `HHMMSS.ffffff` o `HH:MM:SS` como horas y minutos. */
export function formatTime(value?: string): string | undefined {
  const match = /^(\d{2}):?(\d{2})/.exec(value ?? '');
  if (!match) {
    return undefined;
  }
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  return hours < 24 && minutes < 60 ? `${match[1]}:${match[2]}` : undefined;
}

const plural = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;

/**
 * La edad del paciente el día del estudio, que es la que importa al informar.
 * Con el nacimiento y la fecha del estudio se calcula; si falta alguno, se
 * usa `PatientAge` tal como vino (`045Y`, `008M`, `003W`, `012D`). Debajo de
 * dos años va en meses, y debajo de un mes en días: a un recién nacido no le
 * sirve «0 años».
 */
export function formatAge(tags: Tags): string | undefined {
  const birth = dateParts(tags.PatientBirthDate);
  const study = dateParts(tags.StudyDate);
  if (birth && study) {
    const [by, bm, bd] = birth;
    const [sy, sm, sd] = study;
    let months = (sy - by) * 12 + (sm - bm) - (sd < bd ? 1 : 0);
    if (months < 0) {
      return undefined; // un estudio anterior al nacimiento: un dato malo
    }
    if (months >= 24) {
      return plural(Math.floor(months / 12), 'año', 'años');
    }
    if (months >= 1) {
      return plural(months, 'mes', 'meses');
    }
    const days = Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(by, bm - 1, bd)) / 86400000);
    return plural(days, 'día', 'días');
  }

  const match = /^(\d{1,3})\s*([DWMY])$/i.exec(tags.PatientAge ?? '');
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'Y') return plural(n, 'año', 'años');
  if (unit === 'M') return plural(n, 'mes', 'meses');
  if (unit === 'W') return plural(n, 'semana', 'semanas');
  return plural(n, 'día', 'días');
}

/** La lateralidad de la imagen, o la de la serie si la imagen no la trae. */
export function laterality(tags: Tags): string | undefined {
  return tags.ImageLaterality ?? tags.Laterality;
}

/** Una línea de una esquina: un id estable, su texto y la ayuda al pasar el mouse. */
export type Line = {
  id: string;
  title: string;
  text: (tags: Tags, formatPN: (pn: string) => string) => string | undefined;
};

const joined = (...parts: Array<string | undefined>) => {
  const present = parts.filter(Boolean);
  return present.length ? present.join(' · ') : undefined;
};

/**
 * Arriba a la izquierda, quién es: lo que hay que mirar antes de informar.
 * Donde estaba ayer, para que el radiólogo no tenga que buscarlo de nuevo.
 */
export const TOP_LEFT: Line[] = [
  {
    id: 'PatientName',
    title: 'Paciente',
    text: (tags, formatPN) => (tags.PatientName ? formatPN(tags.PatientName) : undefined),
  },
  {
    id: 'PatientIdentity',
    title: 'Identificador, sexo, nacimiento y edad al momento del estudio',
    text: tags => {
      const birth = formatDate(tags.PatientBirthDate);
      const age = formatAge(tags);
      return joined(
        tags.PatientID,
        tags.PatientSex,
        birth && age ? `${birth} (${age})` : (birth ?? age)
      );
    },
  },
  {
    id: 'InstitutionName',
    title: 'Institución',
    text: tags => tags.InstitutionName,
  },
];

/** Arriba a la derecha, qué es: la imagen, el estudio y la serie. */
export const TOP_RIGHT: Line[] = [
  {
    id: 'Laterality',
    title: 'Lateralidad y proyección',
    text: tags => joined(laterality(tags), tags.ViewPosition),
  },
  {
    id: 'StudyDateTime',
    title: 'Fecha y hora del estudio',
    text: tags =>
      joined(formatDate(tags.StudyDate), formatTime(tags.StudyTime))?.replace(' · ', ' '),
  },
  {
    id: 'StudyDescription',
    title: 'Descripción del estudio',
    text: tags => tags.StudyDescription,
  },
  {
    id: 'AccessionNumber',
    title: 'Número de acceso: el de la orden en el RIS',
    text: tags => (tags.AccessionNumber ? `Acc. ${tags.AccessionNumber}` : undefined),
  },
  {
    id: 'Series',
    title: 'Número y descripción de la serie',
    text: tags =>
      joined(tags.SeriesNumber ? `Serie ${tags.SeriesNumber}` : undefined, tags.SeriesDescription),
  },
];
