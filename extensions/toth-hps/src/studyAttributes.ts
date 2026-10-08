/**
 * "El estudio que se está colgando" y "una previa del mismo paciente", como
 * atributos de hanging protocol.
 *
 * Los selectores de OHIF distinguen actual de previa por posición: el primer
 * estudio de la sesión es el actual (`studyInstanceUIDsIndex === 0`) y el
 * segundo la previa. Eso vale cuando el visor se abre con un estudio y sus
 * previas; no en el puesto, donde el RIS va empujando estudios de varios
 * pacientes y el que se muestra casi nunca es el primero. Con la regla por
 * posición, colgar la mamografía recién llegada mostraba la del paciente
 * anterior.
 */

type Study = {
  StudyInstanceUID: string;
  StudyDate?: string;
  PatientID?: string;
  series?: Array<{ instances?: Array<{ PatientID?: string }> }>;
};

const patientOf = (study?: Study) =>
  study?.PatientID ?? study?.series?.[0]?.instances?.[0]?.PatientID;

import mammoView from './mammoView';

export function registerStudyAttributes(hangingProtocolService) {
  hangingProtocolService.addCustomAttribute(
    'mammoView',
    'Proyección de mamografía de la serie (RCC, LCC, RMLO, LMLO)',
    mammoView
  );

  const activeStudy = (): Study | undefined => {
    const { activeStudyUID } = hangingProtocolService.getState() ?? {};
    return hangingProtocolService.studies?.find(study => study.StudyInstanceUID === activeStudyUID);
  };

  hangingProtocolService.addCustomAttribute(
    'isActiveStudy',
    'Es el estudio que se está colgando',
    (study: Study) => study?.StudyInstanceUID === activeStudy()?.StudyInstanceUID
  );

  hangingProtocolService.addCustomAttribute(
    'isPriorOfActive',
    'Es otro estudio del mismo paciente que el que se está colgando',
    (study: Study) => isPriorOf(study, activeStudy())
  );
}

/** Otro estudio, del mismo paciente; sin ID de paciente no se supone nada. */
export function isPriorOf(study?: Study, active?: Study) {
  if (!study || !active || study.StudyInstanceUID === active.StudyInstanceUID) {
    return false;
  }
  const patient = patientOf(active);
  return Boolean(patient) && patientOf(study) === patient;
}
