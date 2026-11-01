/**
 * Lo que «Medir IA» hace con una telerradiografía de EEII sin tocar el visor:
 * reconocerla, nombrar cada ángulo y escribir su valor como lo informa el
 * radiólogo. Vive aparte para poder probarlo sin Cornerstone. El lado del
 * servidor está en `toth/ia-pierna.mjs` y el modelo en
 * iaTunning/scripts/servicio_pierna.py.
 */

import type { Mitad } from './medicion';

export type Medida = 'eje' | 'mldfa' | 'mpta';
export const MEDIDAS: Medida[] = ['eje', 'mldfa', 'mpta'];
const NOMBRE: Record<Medida, string> = { eje: 'eje', mldfa: 'mLDFA', mpta: 'MPTA' };

/** Lo que guarda cada ángulo de la pierna en `data.ia`, para su texto y sus correcciones. */
export type DatosIa = { medida: Medida; mitad: Mitad; lateral: number[] };

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

export const PREFIJOS_PIERNA = MEDIDAS.map(m => `IA · ${NOMBRE[m]} pierna`);

export function etiquetaPierna(medida: Medida, pierna: 'derecha' | 'izquierda'): string {
  return `IA · ${NOMBRE[medida]} pierna ${pierna} (paciente)`;
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

export function textoEje(d: number): string {
  if (Math.abs(d) < 0.05) {
    return 'Eje 0°';
  }
  return `Eje ${coma(Math.abs(d), 1)}° ${d > 0 ? 'varo' : 'valgo'}`;
}

/** El texto de un ángulo de la pierna en la imagen, o null si no es uno de la IA. */
export function textoPierna(
  data: { ia?: DatosIa; handles?: { points?: number[][] } } | undefined
): string[] | null {
  const ia = data?.ia;
  const puntos = data?.handles?.points;
  if (!ia || !MEDIDAS.includes(ia.medida) || !Array.isArray(puntos) || puntos.length !== 3) {
    return null;
  }
  if (ia.medida === 'eje') {
    return [textoEje(desviacion(puntos, ia.lateral))];
  }
  return [`${NOMBRE[ia.medida]} ${Math.round(anguloAlMedio(puntos))}°`];
}

type Pierna = { ok: boolean; motivo?: string };

/** El aviso cuando el servicio midió: cuántas piernas y por qué faltó alguna. */
export function avisoPiernas(
  piernas: Partial<Record<Mitad, Pierna>>,
  pierna: Record<Mitad, 'derecha' | 'izquierda'>
): { tipo: 'success' | 'warning'; mensaje: string } {
  const faltan = (['izq', 'der'] as Mitad[]).filter(m => !piernas[m]?.ok);
  const base =
    'Eje, mLDFA y MPTA listos: revísalos y mueve los puntos si hace falta. Las correcciones se guardan para entrenar la IA.';
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
