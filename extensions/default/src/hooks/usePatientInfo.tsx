import { useState, useEffect } from 'react';
import { utils, useSystem } from '@ohif/core';

const { formatPN, formatDate } = utils;

function usePatientInfo() {
  const { servicesManager } = useSystem();
  const { displaySetService, viewportGridService, customizationService } = servicesManager.services;
  // With the study browser grouped by patient the session holds several
  // patients on purpose — the one being read and a queue of the next ones — so
  // "Multiple Patients" says nothing useful. The header follows the patient of
  // the study on screen instead. Read on every event, not once: the header
  // mounts before the mode has applied its customizations.
  const followActiveStudy = () =>
    Boolean(customizationService.getCustomization('studyBrowser.groupByPatient'));

  const [patientInfo, setPatientInfo] = useState({
    PatientName: '',
    PatientID: '',
    PatientSex: '',
    PatientDOB: '',
  });
  const [isMixedPatients, setIsMixedPatients] = useState(false);

  const checkMixedPatients = (PatientID: string) => {
    const displaySets = displaySetService.getActiveDisplaySets();
    let isMixedPatients = false;
    displaySets.forEach(displaySet => {
      const instance = displaySet?.instances?.[0] || displaySet?.instance;
      if (!instance) {
        return;
      }
      if (instance.PatientID !== PatientID) {
        isMixedPatients = true;
      }
    });
    setIsMixedPatients(isMixedPatients);
  };

  const setFromInstance = instance => {
    setPatientInfo({
      PatientID: instance.PatientID || null,
      PatientName: instance.PatientName ? formatPN(instance.PatientName) : null,
      PatientSex: instance.PatientSex || null,
      PatientDOB: formatDate(instance.PatientBirthDate) || null,
    });
  };

  const updateFromActiveViewport = () => {
    if (!followActiveStudy()) {
      return;
    }
    let state;
    try {
      state = viewportGridService.getState();
    } catch {
      return;
    }
    const uid = state?.viewports?.get(state.activeViewportId)?.displaySetInstanceUIDs?.[0];
    const displaySet = uid ? displaySetService.getDisplaySetByUID(uid) : null;
    const instance = displaySet?.instances?.[0] || displaySet?.instance;
    if (instance) {
      setFromInstance(instance);
      setIsMixedPatients(false);
    }
  };

  const updatePatientInfo = ({ displaySetsAdded }) => {
    if (followActiveStudy()) {
      updateFromActiveViewport();
      return;
    }
    if (!displaySetsAdded.length) {
      return;
    }
    const displaySet = displaySetsAdded[0];
    const instance = displaySet?.instances?.[0] || displaySet?.instance;
    if (!instance) {
      return;
    }

    setPatientInfo({
      PatientID: instance.PatientID || null,
      PatientName: instance.PatientName ? formatPN(instance.PatientName) : null,
      PatientSex: instance.PatientSex || null,
      PatientDOB: formatDate(instance.PatientBirthDate) || null,
    });
    checkMixedPatients(instance.PatientID || null);
  };

  useEffect(() => {
    const subscriptions = [
      displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, props =>
        updatePatientInfo(props)
      ),
    ];
    updateFromActiveViewport();
    subscriptions.push(
      viewportGridService.subscribe(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        updateFromActiveViewport
      ),
      viewportGridService.subscribe(
        viewportGridService.EVENTS.GRID_STATE_CHANGED,
        updateFromActiveViewport
      )
    );
    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, []);

  return { patientInfo, isMixedPatients };
}

export default usePatientInfo;
