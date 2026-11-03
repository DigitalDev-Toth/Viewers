/**
 * Lo que «Medir IA» hace con una telerradiografía de EEII sin tocar el visor:
 * reconocerla, nombrar cada medida y escribir su valor como lo informa el
 * radiólogo. Vive aparte para poder probarlo sin Cornerstone. El lado del
 * servidor está en `toth/ia-pierna.mjs` y el modelo en
 * iaTunning/scripts/servicio_pierna.py (y anatomico_pierna.py).
 *
 * Por pierna: cuatro ángulos (herramienta Ángulo) y dos largos (Longitud).
 * Entre las dos piernas: dos desniveles (Longitud entre los puntos de cada
 * una, con el texto de la diferencia de altura).
 */

import type { Mitad, Punto } from './medicion';

export type Medida = 'eje' | 'mldfa' | 'mpta' | 'anatomico';
export type Largo = 'femur' | 'tibia';
export type Desnivel = 'cabezas' | 'tibias';
export const MEDIDAS: Medida[] = ['eje', 'mldfa', 'mpta', 'anatomico'];
export const LARGOS: Largo[] = ['femur', 'tibia'];
export const DESNIVELES: Desnivel[] = ['cabezas', 'tibias'];
const NOMBRE: Record<Medida | Largo | Desnivel, string> = {
  eje: 'eje',
  mldfa: 'mLDFA',
  mpta: 'MPTA',
  anatomico: 'eje anatómico',
  femur: 'fémur',
  tibia: 'tibia',
  cabezas: 'desnivel de cabezas femorales',
  tibias: 'desnivel de tibias',
};

type Pierna = 'derecha' | 'izquierda';

/**
 * Lo que guarda cada medida de la pierna en `data.ia`, para su texto y sus
 * correcciones. `lateral` y `abajo` son direcciones en el mundo: hacia afuera
 * de esa pierna y hacia abajo en la imagen. `piernas`: de quién es cada punto
 * de un desnivel, en orden.
 */
export type DatosIa =
  | { medida: Medida; mitad: Mitad; lateral: number[] }
  | { medida: Largo; mitad: Mitad }
  | { medida: Desnivel; piernas: [Pierna, Pierna]; abajo: number[] };

/** Lo que la herramienta Longitud calculó para la línea, en su unidad (mm si la imagen trae PixelSpacing). */
export type Largos = { length?: number; unit?: string } | undefined;

/**
 * Si la imagen es una telerradiografía (la pierna completa de pie, cosida en
 * una sola placa alta) y no una pelvis. Las placas de pierna completa son ~3
 * veces más altas que anchas (de 0,9 a 1,8 m por ~43 cm); una pelvis, casi
 * cuadrada. Es el mismo corte que usa el servicio para rechazar.
 */
export function esTelerradiografia(instancia: { Rows?: number; Columns?: number } | undefined) {
  const filas = Number(instancia?.Rows);
  const columnas = Number(instancia?.Columns);
  return filas > 0 && columnas > 0 && filas >= 1.8 * columnas;
}

export const PREFIJOS_PIERNA = [
  ...[...MEDIDAS, ...LARGOS].map(m => `IA · ${NOMBRE[m]} pierna`),
  ...DESNIVELES.map(m => `IA · ${NOMBRE[m]}`),
];

export function etiquetaPierna(medida: Medida | Largo, pierna: Pierna): string {
  return `IA · ${NOMBRE[medida]} pierna ${pierna} (paciente)`;
}

export function etiquetaDesnivel(medida: Desnivel): string {
  return `IA · ${NOMBRE[medida]}`;
}

const resta = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const punto = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const norma = (a: number[]) => Math.sqrt(punto(a, a));

/** El ángulo en el punto del medio, como la herramienta Ángulo de Cornerstone (2D o 3D). */
export function anguloAlMedio([a, b, c]: number[][]): number {
  const u = resta(a, b);
  const v = resta(c, b);
  const cos = Math.min(1, Math.max(-1, punto(u, v) / (norma(u) * norma(v))));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Desviación del eje mecánico de [cadera, rodilla, tobillo]: 180° menos el
 * ángulo en la rodilla, positiva en varo (la rodilla queda por fuera de la
 * línea cadera-tobillo, hacia `lateral`) y negativa en valgo. Igual que
 * puntos_pierna.eje en el modelo.
 */
export function desviacion(puntos: number[][], lateral: number[]): number {
  const [h, k, a] = puntos;
  const ha = resta(a, h);
  const t = punto(resta(k, h), ha) / punto(ha, ha);
  const fuera = punto(
    resta(
      k,
      h.map((v, i) => v + t * ha[i])
    ),
    lateral
  );
  const d = 180 - anguloAlMedio(puntos);
  return fuera >= 0 ? d : -d;
}

const coma = (v: number, decimales: number) => v.toFixed(decimales).replace('.', ',');

export function textoEje(d: number, nombre = 'Eje'): string {
  if (Math.abs(d) < 0.05) {
    return `${nombre} 0°`;
  }
  return `${nombre} ${coma(Math.abs(d), 1)}° ${d > 0 ? 'varo' : 'valgo'}`;
}

/**
 * La diferencia de altura entre los dos puntos de un desnivel, en la unidad
 * de la línea (`largo` es su largo total, que la herramienta ya calibró), y
 * cuál está más arriba: 0 o 1, o null si están a la misma altura.
 */
export function desnivel(puntos: number[][], abajo: number[], largo: number) {
  const d = resta(puntos[1], puntos[0]);
  const n = norma(d);
  const alto = n > 0 ? (punto(d, abajo) / n) * largo : 0; // > 0: el segundo está más abajo
  return { valor: Math.abs(alto), masAlto: Math.abs(alto) < 0.5 ? null : alto > 0 ? 0 : 1 };
}

/** El texto de una medida de la pierna en la imagen, o null si no es una de la IA. */
export function textoPierna(
  data: { ia?: DatosIa; handles?: { points?: number[][] } } | undefined,
  largos?: Largos
): string[] | null {
  const ia = data?.ia;
  const puntos = data?.handles?.points;
  if (!ia || !Array.isArray(puntos)) {
    return null;
  }
  if ((MEDIDAS as string[]).includes(ia.medida) && puntos.length === 3 && 'lateral' in ia) {
    if (ia.medida === 'eje') {
      return [textoEje(desviacion(puntos, ia.lateral))];
    }
    if (ia.medida === 'anatomico') {
      return [textoEje(desviacion(puntos, ia.lateral), 'Eje anatómico')];
    }
    return [`${NOMBRE[ia.medida]} ${Math.round(anguloAlMedio(puntos))}°`];
  }
  const largo = largos?.length;
  if (puntos.length !== 2 || typeof largo !== 'number' || !Number.isFinite(largo)) {
    return null;
  }
  // Cornerstone agrega el tipo de calibración («mm Unknown», «mm ERMF»): acá basta la unidad.
  const unidad = (largos?.unit ?? 'mm').split(' ')[0];
  if ((LARGOS as string[]).includes(ia.medida)) {
    const nombre = NOMBRE[ia.medida];
    return [`${nombre[0].toUpperCase()}${nombre.slice(1)} ${Math.round(largo)} ${unidad}`];
  }
  if ((DESNIVELES as string[]).includes(ia.medida) && 'abajo' in ia) {
    const { valor, masAlto } = desnivel(puntos, ia.abajo, largo);
    const nombre = ia.medida === 'cabezas' ? 'cabezas femorales' : 'tibias';
    if (masAlto === null) {
      return [`Desnivel de ${nombre}: 0 ${unidad}`];
    }
    return [`Desnivel de ${nombre}: ${ia.piernas[masAlto]} ${Math.round(valor)} ${unidad} más alta`];
  }
  return null;
}

/**
 * Dónde va el recuadro del valor de las medidas nuevas, en píxeles del DICOM,
 * para que no se encimen con los del eje y la rodilla: los largos al lado de
 * su hueso, hacia afuera; el anatómico en el muslo, bajo el del fémur; los
 * desniveles entre las piernas (en la pelvis, bajo las cabezas, y bajo las
 * rodillas). `mm`: mm por píxel.
 */
export function dondeTexto(
  medida: Medida | Largo | Desnivel,
  puntos: Punto[],
  mitad: Mitad | null,
  mm: number
): Punto | null {
  const afuera = mitad === 'izq' ? -1 : 1; // la pierna de la mitad izquierda tiene su lateral hacia x menor
  const p = (mmX: number, mmY: number, [x, y]: number[]): Punto => [x + mmX / mm, y + mmY / mm];
  const entre = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  if (medida === 'femur' || medida === 'tibia') {
    return p(afuera * 30, 0, entre(puntos[0], puntos[1], 0.5));
  }
  if (medida === 'anatomico') {
    return p(afuera * 30, 0, entre(puntos[1], puntos[0], 0.3));
  }
  if (medida === 'cabezas') {
    return p(-40, 20, entre(puntos[0], puntos[1], 0.5)); // arriba se sale de las placas cortadas en la cresta
  }
  if (medida === 'tibias') {
    return p(-30, 60, entre(puntos[0], puntos[1], 0.5));
  }
  return null;
}

type Respuesta = { ok: boolean; motivo?: string };

/** El aviso cuando el servicio midió: cuántas piernas y por qué faltó alguna. */
export function avisoPiernas(
  piernas: Partial<Record<Mitad, Respuesta>>,
  pierna: Record<Mitad, Pierna>
): { tipo: 'success' | 'warning'; mensaje: string } {
  const faltan = (['izq', 'der'] as Mitad[]).filter(m => !piernas[m]?.ok);
  const base =
    'Ejes, mLDFA, MPTA, largos y desniveles listos: revísalos y mueve los puntos si hace falta. Las correcciones se guardan para entrenar la IA.';
  if (!faltan.length) {
    return { tipo: 'success', mensaje: base };
  }
  const detalle = faltan
    .map(m => `la pierna ${pierna[m]} no se midió${piernas[m]?.motivo ? ` (${piernas[m].motivo})` : ''}`)
    .join('; ');
  return { tipo: 'warning', mensaje: `${base} Ojo: ${detalle}.` };
}

/** El aviso cuando no se pudo medir ninguna pierna. */
export function avisoErrorPierna(
  status: number,
  cuerpo: { motivo?: string; error?: string } | null
): string {
  const motivo = cuerpo?.motivo ?? cuerpo?.error;
  if (status === 422) {
    return `La IA no encuentra una pierna completa medible en esta imagen${motivo ? ` (${motivo})` : ''}.`;
  }
  if (status === 401 || status === 403) {
    return 'El enlace no autoriza medir esta imagen.';
  }
  return motivo ? `No se pudo medir: ${motivo}.` : `No se pudo medir (error ${status}).`;
}
