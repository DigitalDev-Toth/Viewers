# Reportar el bug del byte de relleno a Cornerstone3D

Dos partes: **el reporte listo para presentar** (en inglés, copiar y pegar) y
**por qué está escrito así**, que es lo que se lleva uno para el próximo.

Se presenta en <https://github.com/cornerstonejs/cornerstone3D/issues>, con
el botón *New issue* → *Bug report*.

---

## Parte 1 — El reporte

> **Título:** `RGB images with odd rows×columns fail to render: PixelData padding byte is not trimmed`

**Describe the bug**

DICOM PS3.5 §7.1.1 requires every data element value to have an even length.
When `Rows × Columns × SamplesPerPixel` is odd, PixelData carries one trailing
padding byte. That byte is not trimmed, so `vtkDataArray` receives a length
that is not a multiple of `numberOfComponents` and throws:

```
RangeError: model.size is not a multiple of model.numberOfComponents
```

The image fails to render. In practice this hits RGB images (3 samples) whose
rows and columns are both odd — for example Secondary Capture screenshots
produced by MR consoles.

**The visible error is misleading**

`StackViewport._createVTKImageData` swallows the RangeError:

```js
try {
  this._imageData = this.createVTKImageData({ ... });
} catch (e) {
  log.error(e);          // swallowed
}
```

`this._imageData` stays `undefined`, and the caller
(`_updateActorToDisplayImageId`) immediately does:

```js
this._updateVTKImageDataFromCornerstoneImage(image);  // → this._imageData.setOrigin(origin)
```

so what surfaces to the application is:

```
TypeError: Cannot read properties of undefined (reading 'setOrigin')
    at StackViewport._updateVTKImageDataFromCornerstoneImage
    at StackViewport._updateActorToDisplayImageId
    at StackViewport.renderImageObject
    at renderToCanvasGPU
```

That TypeError names neither PixelData nor the actual problem, which makes the
cause hard to find. Consider rethrowing or surfacing the original error.

**To Reproduce**

Load any RGB instance where `Rows × Columns × SamplesPerPixel` is odd. A
569×569 RGB Secondary Capture (`PhotometricInterpretation = RGB`,
`SamplesPerPixel = 3`, `BitsAllocated = 8`) reproduces it every time.

Measured on the decoded image in the browser:

```js
const px = image.voxelManager.getScalarData();
px.length                                  // 971284
image.rows * image.columns * 3             // 971283   ← one byte less
px.length % 3                              // 1        ← not a multiple
```

And in the source file, read with GDCM:

```
Rows × Columns × SamplesPerPixel : 971283   (odd)
PixelData element length (VL)    : 971284
padding                          : 1 byte
```

**Control case (same study, same series type)**

A 568×568 RGB instance from the same study:

```
Rows × Columns × SamplesPerPixel : 967872   (even)
PixelData element length (VL)    : 967872
padding                          : 0 bytes
```

It renders correctly. Only the odd-length case fails, which isolates the
padding byte as the cause.

**Expected behavior**

PixelData should be trimmed to `Rows × Columns × SamplesPerPixel` (per frame)
before the array reaches VTK, and the image should render.

**Suggested fix**

In `postProcessDecodedPixels` (`decodeImageFrameWorker.js`), before any
processing:

```js
const expectedLength = imageFrame.rows * imageFrame.columns * imageFrame.samplesPerPixel;
if (expectedLength > 0 && imageFrame.pixelData?.length === expectedLength + 1) {
  imageFrame.pixelData = imageFrame.pixelData.subarray(0, expectedLength);
}
```

Trimming exactly one element, and only when the excess is exactly one, keeps
the change to the padding case the standard defines; any other length mismatch
means something else and should not be silently reshaped.

**Environment**

- `@cornerstonejs/dicom-image-loader` 5.6.12
- OHIF Viewer 3.14.0-beta.12
- Chrome, macOS
- Transfer syntax: Explicit VR Little Endian (1.2.840.10008.1.2.1), uncompressed

---

## Parte 2 — Por qué el reporte está escrito así

Cada sección responde una pregunta que el mantenedor se va a hacer. Si falta,
el issue se queda esperando respuestas y suele morir ahí.

**El título dice el síntoma y la condición.** «RGB images with odd
rows×columns fail to render» permite que alguien con el mismo problema lo
encuentre buscando, y que un mantenedor decida si le compete sin abrirlo. Un
título como «rendering error» no sirve a nadie.

**Se separa causa de síntoma.** El error que uno *ve* es el `TypeError` de
`setOrigin`. Reportar eso solo habría mandado al mantenedor a mirar el lugar
equivocado. El trabajo de haber seguido la cadena hasta el `catch` que se
traga el `RangeError` es la mitad del valor del reporte.

**Los números son medidos, no aproximados.** 971284 contra 971283 es
verificable; «parece que sobra un byte» no lo es. Se incluye tanto lo que se
midió en el navegador como lo que dice el archivo, porque son dos
comprobaciones independientes: descartan que lo haya agregado nuestra cadena.

**El caso de control es lo que convence.** Una imagen de 568×568 del mismo
estudio, mismo tipo de serie, mismo codificador, que sí funciona. Eso convierte
«creo que es el relleno» en «es el relleno»: cambia una sola variable —que el
producto sea par o impar— y el fallo aparece y desaparece con ella.

**Se cita el estándar.** «DICOM PS3.5 §7.1.1» le dice al mantenedor que el
archivo está bien formado y el bug es de la librería. Sin eso, la respuesta
más probable es «tu DICOM está corrupto».

**El parche propuesto es conservador y explica su límite.** Recortar un solo
elemento, y sólo cuando sobra exactamente uno, es defendible. Recortar
cualquier exceso sería adivinar. Decir por qué se eligió lo estrecho ahorra la
discusión.

**El entorno permite reproducir.** Versiones exactas y transfer syntax: sin
eso, la primera respuesta es siempre pedir esos datos.

### Lo que conviene no hacer

- Reportar varios problemas en un issue. El `catch` que silencia el error es
  un problema real y distinto: va mencionado como observación, pero si quieren
  arreglarlo aparte, que sea su propio issue.
- Adjuntar el DICOM sin pensarlo: **estos archivos tienen datos de pacientes.**
  Si piden un caso de ejemplo, hay que anonimizar primero, o mejor, generar uno
  sintético de 569×569 RGB con pydicom, que reproduce igual y no expone a nadie.
- Pedir urgencia. Es software libre y el reporte compite con otros; lo que
  mueve la aguja es que esté completo, no que esté apurado.

### Después de presentarlo

Vale la pena mencionar que ya hay un parche local aplicado y ofrecer el pull
request. Un issue con un arreglo probado adjunto se resuelve mucho más rápido
que uno que solo describe el problema — y acá el parche ya está corriendo en
`patches/@cornerstonejs__dicom-image-loader@5.6.12.patch`.
