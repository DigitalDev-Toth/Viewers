/**
 * «Medir IA» en una telerradiografía de EEII: pide la medición de la imagen
 * del cuadro activo y deja, por pierna, cuatro ángulos y dos largos
 * editables:
 *
 *   - eje: [cadera, rodilla, tobillo]; se lee como la desviación en varo o
 *     valgo (180° menos el ángulo en la rodilla), como la informa csf.
 *   - mLDFA y MPTA: con el vértice en el cruce de la línea articular del fémur
 *     (o la tibia) con su eje mecánico, así que el ángulo es el exacto.
 *   - eje anatómico: [diáfisis del fémur, cruce con el eje de la tibia,
 *     tobillo], también como desviación en varo o valgo.
 *   - fémur (borde superior de la cabeza → medio de los cóndilos) y tibia
 *     (medio del platillo → tobillo), con la herramienta Longitud.
 *
 * Con las dos piernas medidas, además dos desniveles: una Longitud entre los
 * bordes superiores de las cabezas femorales y otra entre los platillos
 * tibiales, cuyo texto es la diferencia de altura y la pierna más alta.
 *
 * Ver `pierna.ts` para los textos y `toth/ia-pierna.mjs` para el servidor.
 */

import { metaData, utilities as csUtils } from '@cornerstonejs/core';
import { AngleTool, LengthTool, ToolGroupManager } from '@cornerstonejs/tools';

import { seguirAngulo } from './correcciones';
import { caderaDeLaIzquierda, mmPorPixel, urlMedicion, type Mitad, type Punto } from './medicion';
import { agregarAngulo, borrarAnteriores, orientacion } from './medirIndiceAcetabular';
import {
  DESNIVELES,
  LARGOS,
  MEDIDAS,
  PREFIJOS_PIERNA,
  avisoErrorPierna,
  avisoPiernas,
  dondeTexto,
  etiquetaDesnivel,
  etiquetaPierna,
  textoPierna,
  type DatosIa,
} from './pierna';

const TITULO = 'Medir IA';
const ENVUELTO = Symbol('toth-ia');

/**
 * Que Ángulo escriba «Eje 3,0° varo» o «mLDFA 87°» y Longitud «Fémur 424 mm»
 * o «Desnivel de cabezas femorales: derecha 4 mm más alta» en las medidas de
 * la pierna. Envuelve su getTextLines en cada grupo de herramientas; lo
 * dibujado a mano sigue con el texto de siempre. Longitud pasa el largo que
 * ya calibró (`cachedStats`), así los mm son los mismos que mide a mano.
 */
function instalarTextos() {
  for (const grupo of ToolGroupManager.getAllToolGroups()) {
    for (const nombre of [AngleTool.toolName, LengthTool.toolName]) {
      const herramienta = grupo.getToolInstance(nombre) as
        | { configuration?: { getTextLines?: (...args: unknown[]) => unknown } }
        | undefined;
      const config = herramienta?.configuration;
      if (!config?.getTextLines || config.getTextLines[ENVUELTO]) {
        continue;
      }
      const original = config.getTextLines;
      const envuelta = (data, targetId) =>
        textoPierna(data, data?.cachedStats?.[targetId]) ?? original(data, targetId);
      envuelta[ENVUELTO] = true;
      config.getTextLines = envuelta;
    }
  }
}

/** La dirección de un paso de un píxel desde `[x, y]`, en coordenadas del mundo y de largo 1. */
function direccionMundo(imageId: string, [x, y]: Punto, [dx, dy]: Punto): number[] {
  const a = csUtils.imageToWorldCoords(imageId, [x, y]);
  const b = csUtils.imageToWorldCoords(imageId, [x + dx, y + dy]);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...d) || 1;
  return d.map(v => v / n);
}

/** Hacia afuera de la pierna en la mitad `mitad` de la imagen, en coordenadas del mundo. */
function lateralMundo(imageId: string, mitad: Mitad, punto: Punto): number[] {
  return direccionMundo(imageId, punto, [mitad === 'izq' ? -1 : 1, 0]);
}

export async function medirPierna({ servicesManager }) {
  const { viewportGridService, cornerstoneViewportService, uiNotificationService } =
    servicesManager.services;
  const avisar = (type: 'info' | 'success' | 'warning' | 'error', message: string) =>
    uiNotificationService.show({
      title: TITULO,
      message,
      type,
      duration: type === 'error' || type === 'warning' ? 7000 : 4000,
    });

  const viewportId = viewportGridService.getActiveViewportId();
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const imageId: string | undefined = viewport?.getCurrentImageId?.();
  if (!imageId) {
    avisar('warning', 'Abre una telerradiografía de EEII en el cuadro activo.');
    return;
  }

  const url = urlMedicion(imageId, metaData.get('instance', imageId), 'pierna');
  if (!url) {
    avisar('warning', 'Esta imagen no viene del archivo del centro: no se puede medir.');
    return;
  }

  avisar('info', 'Midiendo las piernas…');
  let respuesta: Response;
  let cuerpo;
  try {
    respuesta = await fetch(url, { credentials: 'same-origin' });
    cuerpo = await respuesta.json().catch(() => null);
  } catch {
    avisar('error', 'No se pudo contactar al servicio de IA.');
    return;
  }
  if (!respuesta.ok || !cuerpo?.ok) {
    avisar(respuesta.status === 422 ? 'warning' : 'error', avisoErrorPierna(respuesta.status, cuerpo));
    return;
  }

  instalarTextos();
  // Sobre la imagen que se midió, aunque el cuadro haya avanzado mientras tanto.
  borrarAnteriores(imageId, PREFIJOS_PIERNA);
  const izquierda = caderaDeLaIzquierda(orientacion(imageId));
  const pierna: Record<Mitad, 'derecha' | 'izquierda'> = {
    izq: izquierda,
    der: izquierda === 'derecha' ? 'izquierda' : 'derecha',
  };
  // El servicio da el centro del primer píxel como (0, 0); Cornerstone, su esquina.
  const aMundo = ([x, y]: Punto) => csUtils.imageToWorldCoords(imageId, [x + 0.5, y + 0.5]);
  const mm = mmPorPixel(metaData.get('instance', imageId)) ?? 0.15;
  const modelo = String(cuerpo.modelo ?? '');
  const dibujar = (
    puntos: Punto[],
    etiqueta: string,
    ia: DatosIa,
    campos: Record<string, string>,
    texto: Punto | null
  ) => {
    const uid = agregarAngulo(viewportId, imageId, puntos.map(aMundo), etiqueta, { ia }, {
      herramienta: puntos.length === 2 ? LengthTool : AngleTool,
      ...(texto && { texto: aMundo(texto) }),
    });
    seguirAngulo(uid, { url, imageId, campos, modelo, puntosIa: puntos });
  };
  for (const mitad of ['izq', 'der'] as const) {
    const p = cuerpo.piernas?.[mitad];
    if (!p?.ok) {
      continue;
    }
    const campos = medida => ({ pierna: pierna[mitad], mitad, medida });
    for (const medida of MEDIDAS) {
      const tres: Punto[] | undefined = p.angulos?.[medida];
      if (tres) {
        const ia: DatosIa = { medida, mitad, lateral: lateralMundo(imageId, mitad, tres[1]) };
        dibujar(tres, etiquetaPierna(medida, pierna[mitad]), ia, campos(medida), dondeTexto(medida, tres, mitad, mm));
      }
    }
    for (const medida of LARGOS) {
      const dos: Punto[] | undefined = p.lineas?.[medida];
      if (dos) {
        const ia: DatosIa = { medida, mitad };
        dibujar(dos, etiquetaPierna(medida, pierna[mitad]), ia, campos(medida), dondeTexto(medida, dos, mitad, mm));
      }
    }
  }
  for (const medida of DESNIVELES) {
    const d = cuerpo.desniveles?.[medida];
    if (!d?.puntos?.izq || !d?.puntos?.der) {
      continue;
    }
    const dos: Punto[] = [d.puntos.izq, d.puntos.der];
    const ia: DatosIa = {
      medida,
      piernas: [pierna.izq, pierna.der],
      abajo: direccionMundo(imageId, dos[0], [0, 1]),
    };
    const campos = { pierna: 'ambas', mitad: 'ambas', medida };
    dibujar(dos, etiquetaDesnivel(medida), ia, campos, dondeTexto(medida, dos, null, mm));
  }
  viewport.render();
  const { tipo, mensaje } = avisoPiernas(cuerpo.piernas ?? {}, pierna);
  avisar(tipo, mensaje);
}
