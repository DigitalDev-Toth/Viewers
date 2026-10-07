import React from 'react';
import PropTypes from 'prop-types';

import { StudyItem } from '../StudyItem';
import { StudyBrowserSort } from '../StudyBrowserSort';
import { StudyBrowserViewOptions } from '../StudyBrowserViewOptions';
import { ScrollArea } from '../ScrollArea';

const noop = () => {};

const StudyBrowser = ({
  tabs,
  activeTabName,
  expandedStudyInstanceUIDs,
  onClickTab = noop,
  onClickStudy = noop,
  onClickThumbnail = noop,
  onDoubleClickThumbnail = noop,
  onClickUntrack = noop,
  activeDisplaySetInstanceUIDs,
  servicesManager,
  showSettings,
  viewPresets,
  ThumbnailMenuItems,
  StudyMenuItems,
}: withAppTypes) => {
  const viewPreset = viewPresets
    ? viewPresets.filter(preset => preset.selected)[0]?.id
    : 'thumbnails';
  const studies = tabs.find(tab => tab.name === activeTabName)?.studies ?? [];

  // Studies may come grouped: the patient being read, and a queue of other
  // patients' studies pushed in ahead of time (see `studyBrowser.groupByPatient`).
  // The queue is docked at the bottom of the panel in a colour of its own, so
  // it reads as "what comes next" and never gets mixed up with the current
  // patient. Ungrouped studies — the default — render exactly as before.
  const current = studies.filter(study => study.group !== 'queue');
  const queue = studies.filter(study => study.group === 'queue');
  const isGrouped = studies.some(study => study.group);

  const renderStudy = ({
    studyInstanceUid,
    date,
    description,
    numInstances,
    modalities,
    displaySets,
  }) => {
    const isExpanded = expandedStudyInstanceUIDs.includes(studyInstanceUid);
    return (
      <StudyItem
        key={studyInstanceUid}
        date={date}
        description={description}
        numInstances={numInstances}
        isExpanded={isExpanded}
        displaySets={displaySets}
        modalities={modalities}
        isActive={isExpanded}
        onClick={() => onClickStudy(studyInstanceUid)}
        onClickThumbnail={onClickThumbnail}
        onDoubleClickThumbnail={onDoubleClickThumbnail}
        onClickUntrack={onClickUntrack}
        activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
        data-cy="thumbnail-list"
        viewPreset={viewPreset}
        ThumbnailMenuItems={ThumbnailMenuItems}
        StudyMenuItems={StudyMenuItems}
        StudyInstanceUID={studyInstanceUid}
      />
    );
  };

  const groupHeader = (label, className, group) => (
    <div
      className={`px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide ${className}`}
      data-cy={`studyBrowser-group-${group}`}
    >
      {label}
    </div>
  );

  const mainList = (
    <ScrollArea className={queue.length ? 'min-h-0 flex-1' : undefined}>
      <div
        className="bg-background flex flex-1 flex-col gap-[4px]"
        data-cy={'studyBrowser-panel'}
      >
        <div className="flex flex-col gap-[4px]">
          {showSettings && (
            <div className="w-100 bg-background flex h-[48px] items-center justify-center gap-[10px] px-[8px] py-[10px]">
              <>
                <StudyBrowserViewOptions
                  tabs={tabs}
                  onSelectTab={onClickTab}
                  activeTabName={activeTabName}
                />
                <StudyBrowserSort servicesManager={servicesManager} />
              </>
            </div>
          )}
          {isGrouped &&
            current.length > 0 &&
            groupHeader('Paciente actual', 'text-muted-foreground', 'patient')}
          {current.map(renderStudy)}
        </div>
      </div>
    </ScrollArea>
  );

  if (!queue.length) {
    return mainList;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {mainList}
      <div
        className={[
          'flex max-h-[45%] shrink-0 flex-col gap-[4px] overflow-y-auto',
          'border-t-2 border-[#E0A33A] bg-[#1F1808] pb-1',
          // StudyItem paints its own header; tint it from here rather than
          // teach it about queues.
          '[&_.bg-popover]:bg-[#3D2F10] [&_.bg-popover:hover]:bg-[#4E3C14]',
          '[&_.text-foreground]:text-[#F5C76A] [&_.text-muted-foreground]:text-[#D9B373]',
        ].join(' ')}
        data-cy="studyBrowser-queue"
      >
        {groupHeader(`En cola (${queue.length})`, 'pt-1.5 text-[#E0A33A]', 'queue')}
        {queue.map(renderStudy)}
      </div>
    </div>
  );
};

StudyBrowser.propTypes = {
  onClickTab: PropTypes.func.isRequired,
  onClickStudy: PropTypes.func,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  activeTabName: PropTypes.string.isRequired,
  expandedStudyInstanceUIDs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeDisplaySetInstanceUIDs: PropTypes.arrayOf(PropTypes.string),
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      studies: PropTypes.arrayOf(
        PropTypes.shape({
          studyInstanceUid: PropTypes.string.isRequired,
          date: PropTypes.string,
          numInstances: PropTypes.number,
          modalities: PropTypes.string,
          description: PropTypes.string,
          displaySets: PropTypes.arrayOf(
            PropTypes.shape({
              displaySetInstanceUID: PropTypes.string.isRequired,
              imageSrc: PropTypes.string,
              imageAltText: PropTypes.string,
              seriesDate: PropTypes.string,
              seriesNumber: PropTypes.any,
              numInstances: PropTypes.number,
              description: PropTypes.string,
              componentType: PropTypes.oneOf(['thumbnail', 'thumbnailTracked', 'thumbnailNoImage'])
                .isRequired,
              isTracked: PropTypes.bool,
              /**
               * Data the thumbnail should expose to a receiving drop target. Use a matching
               * `dragData.type` to identify which targets can receive this draggable item.
               * If this is not set, drag-n-drop will be disabled for this thumbnail.
               *
               * Ref: https://react-dnd.github.io/react-dnd/docs/api/use-drag#specification-object-members
               */
              dragData: PropTypes.shape({
                /** Must match the "type" a dropTarget expects */
                type: PropTypes.string.isRequired,
              }),
            })
          ),
        })
      ).isRequired,
    })
  ),
  StudyMenuItems: PropTypes.func,
};

export { StudyBrowser };
