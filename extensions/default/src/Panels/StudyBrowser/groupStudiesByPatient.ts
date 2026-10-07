import type { TabsProps } from '@ohif/core/src/utils/createStudyBrowserTabs';

/**
 * Splits each tab of the study browser into the patient being read and the
 * ones waiting behind them.
 *
 * On a reading workstation the worklist pushes the next studies into the open
 * viewer ahead of time, so the panel ends up holding several patients at once.
 * Mixed together by date they are hard to tell apart; this puts on top the
 * study on screen and the rest of that patient's studies (priors included,
 * loaded or not, which is what the radiologist may want to compare against),
 * and below them, marked `group: 'queue'`, the other patients' studies in the
 * order they arrived. Other patients' priors are left out until that patient
 * comes up: they belong to a later report, not this one.
 *
 * Off by default — `studyBrowser.groupByPatient` turns it on.
 */
export function groupStudiesByPatient(
  tabs: TabsProps,
  {
    activeStudyInstanceUID,
    arrivalOrder,
  }: {
    /** The study on screen in the active viewport. */
    activeStudyInstanceUID?: string;
    /** StudyInstanceUIDs in the order their display sets arrived. */
    arrivalOrder: string[];
  }
): TabsProps {
  if (!activeStudyInstanceUID) {
    return tabs;
  }

  return tabs.map(tab => {
    const active = tab.studies.find(study => study.studyInstanceUid === activeStudyInstanceUID);
    if (!active) {
      return tab;
    }
    // Without an ID on both sides there is no telling two patients apart, and
    // guessing "same" would hide the queue inside the current patient.
    const isCurrentPatient = study =>
      study.studyInstanceUid === activeStudyInstanceUID ||
      (Boolean(active.patientId) && study.patientId === active.patientId);

    const current = [
      active,
      ...tab.studies.filter(study => study !== active && isCurrentPatient(study)),
    ].map(study => ({ ...study, group: 'patient' }));

    const queue = tab.studies
      .filter(study => !isCurrentPatient(study) && arrivalOrder.includes(study.studyInstanceUid))
      .sort(
        (a, b) =>
          arrivalOrder.indexOf(a.studyInstanceUid) - arrivalOrder.indexOf(b.studyInstanceUid)
      )
      .map(study => ({
        ...study,
        group: 'queue',
        // The block shows only date and description; for someone else's study
        // the patient is the first thing to know.
        description: [formatPatientName(study.patientName), study.description]
          .filter(Boolean)
          .join(' · '),
      }));

    return { ...tab, studies: [...current, ...queue] };
  });
}

/** `APELLIDO^NOMBRE` → `APELLIDO NOMBRE`. */
function formatPatientName(name?: string) {
  return (name ?? '').replace(/\^+/g, ' ').trim();
}
