/**
 * «Medir IA» en una telerradiografía de EEII: pide la medición de la imagen
 * del cuadro activo y deja, por pierna, tres ángulos editables:
 *
 *   - eje: [cadera, rodilla, tobillo]; se lee como la desviación en varo o
 *     valgo (180° menos el ángulo en la rodilla), como la informa csf.
 *   - mLDFA y MPTA: con el vértice en el cruce de la línea articular del fémur
 *     (o la tibia) con su eje mecánico, así que el ángulo es el exacto.
 *
 * Ver `pierna.ts` para los textos y `toth/ia-pierna.mjs` para el servidor.
 */

import { metaData, utilities as csUtils } from '@cornerstonejs/core';
import { AngleTool, ToolGroupManager } from '@cornerstonejs/tools';

import { seguirAngulo } from './correcciones';
import { caderaDeLaIzquierda, urlMedicion, type Mitad, type Punto, type Tres } from './medicion';
import { agregarAngulo, borrarAnteriores, orientacion } from './medirIndiceAcetabular';
import {
  MEDIDAS,
  PREFIJOS_PIERNA,
  avisoErrorPierna,
  avisoPiernas,
  etiquetaPierna,
  textoPierna,
  type DatosIa,
} from './pierna';

const TITULO = 'Medir IA';
const ENVUELTO = Symbol('toth-ia');

/**
 * Que la herramienta Ángulo escriba «Eje 3,0° varo» o «mLDFA 87°» en los
 * ángulos de la pierna. Envuelve su getTextLines en cada grupo de
 * herramientas; los ángulos dibujados a mano siguen con el texto de siempre.
 */
function instalarTextos() {
  for (const grupo of ToolGroupManager.getAllToolGroups()) {
    const herramienta = grupo.getToolInstance(AngleTool.toolName) as
      | { configuration?: { getTextLines?: (...args: unknown[]) => unknown } }
      | undefined;
    const config = herramienta?.configuration;
    if (!config?.getTextLines || config.getTextLines[ENVUELTO]) {
      continue;
    }
    const original = config.getTextLines;
    const envuelta = (data, targetId) => textoPierna(data) ?? original(data, targetId);
    envuelta[ENVUELTO] = true;
    config.getTextLines = envuelta;
  }
}

/** Hacia afuera de la pierna en la mitad `mitad` de la imagen, en coordenadas del mundo. */
function lateralMundo(imageId: string, mitad: Mitad, [x, y]: Punto): number[] {
  const paso = mitad === 'izq' ? -1 : 1;
  const a = csUtils.imageToWorldCoords(imageId, [x, y]);
  const b = csUtils.imageToWorldCoords(imageId, [x + paso, y]);
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
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
  for (const mitad of ['izq', 'der'] as const) {
    const p = cuerpo.piernas?.[mitad];
    if (!p?.ok) {
      continue;
    }
    for (const medida of MEDIDAS) {
      const tres: Tres | undefined = p.angulos?.[medida];
      if (!tres) {
        continue;
      }
      // El servicio da el centro del primer píxel como (0, 0); Cornerstone, su esquina.
      const mundo = tres.map(([x, y]: Punto) => csUtils.imageToWorldCoords(imageId, [x + 0.5, y + 0.5]));
      const ia: DatosIa = { medida, mitad, lateral: lateralMundo(imageId, mitad, tres[1]) };
      const uid = agregarAngulo(viewportId, imageId, mundo, etiquetaPierna(medida, pierna[mitad]), { ia });
      seguirAngulo(uid, {
        url,
        imageId,
        campos: { pierna: pierna[mitad], mitad, medida },
        modelo: String(cuerpo.modelo ?? ''),
        puntosIa: tres,
      });
    }
  }
  viewport.render();
  const { tipo, mensaje } = avisoPiernas(cuerpo.piernas ?? {}, pierna);
  avisar(tipo, mensaje);
}
