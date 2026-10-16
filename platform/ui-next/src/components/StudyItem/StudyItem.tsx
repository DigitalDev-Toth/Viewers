import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { ThumbnailList } from '../ThumbnailList';
import { LoadingStatus } from '../Thumbnail/LoadingStatus';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../Accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';

const StudyItem = ({
  date,
  description,
  numInstances,
  modalities,
  isActive,
  onClick,
  isExpanded,
  displaySets,
  activeDisplaySetInstanceUIDs,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack,
  viewPreset = 'thumbnails',
  ThumbnailMenuItems,
  StudyMenuItems,
  StudyInstanceUID,
}: withAppTypes) => {
  const loadingStatus = getStudyLoadingStatus(displaySets);

  return (
    <Accordion
      type="single"
      collapsible
      onClick={onClick}
      onKeyDown={() => {}}
      role="button"
      tabIndex={0}
      // Controlled: the panel owns which studies are open (a click already goes
      // through it), so a study it opens or folds programmatically — the one
      // just put on screen, say — follows. As `defaultValue` it only counted
      // at mount and later changes were ignored.
      value={isActive ? 'study-item' : ''}
    >
      <AccordionItem value="study-item">
        <AccordionTrigger className={classnames('hover:bg-accent bg-popover group w-full rounded')}>
          <div className="flex h-[40px] w-full flex-row overflow-hidden">
            <div className="flex w-full flex-row items-center justify-between">
              <div className="flex min-w-0 flex-col items-start text-[13px]">
                <Tooltip>
                  <TooltipContent>{date}</TooltipContent>
                  <TooltipTrigger
                    className="w-full"
                    asChild
                  >
                    <div className="text-foreground h-[18px] w-full max-w-[160px] overflow-hidden truncate whitespace-nowrap text-left">
                      {date}
                    </div>
                  </TooltipTrigger>
                </Tooltip>
                <Tooltip>
                  <TooltipContent>{description}</TooltipContent>
                  <TooltipTrigger
                    className="w-full"
                    asChild
                  >
                    <div className="text-muted-foreground h-[18px] w-full overflow-hidden truncate whitespace-nowrap text-left">
                      {description}
                    </div>
                  </TooltipTrigger>
                </Tooltip>
              </div>
              <div className="text-muted-foreground flex flex-col items-end pl-[10px] text-[12px]">
                <div className="max-w-[150px] overflow-hidden text-ellipsis">{modalities}</div>
                <div className="flex items-center gap-[4px]">
                  {loadingStatus && <LoadingStatus {...loadingStatus} />}
                  <div>{numInstances}</div>
                </div>
              </div>
              {StudyMenuItems && (
                <div className="ml-2 flex items-center">
                  <StudyMenuItems StudyInstanceUID={StudyInstanceUID} />
                </div>
              )}
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent
          onClick={event => {
            event.stopPropagation();
          }}
        >
          {isExpanded && displaySets && (
            <ThumbnailList
              thumbnails={displaySets}
              activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
              onThumbnailClick={onClickThumbnail}
              onThumbnailDoubleClick={onDoubleClickThumbnail}
              onClickUntrack={onClickUntrack}
              viewPreset={viewPreset}
              ThumbnailMenuItems={ThumbnailMenuItems}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

/**
 * The download status of a study, out of its series with images: done once
 * they all are. Nothing until the prefetcher has reported on one of them.
 */
function getStudyLoadingStatus(displaySets) {
  const imageDisplaySets = (displaySets ?? []).filter(
    ds => ds.componentType !== 'thumbnailNoImage' && ds.numInstances > 0
  );
  const isReported = ds =>
    typeof ds.loadingProgress === 'number' && !Number.isNaN(ds.loadingProgress);

  if (!imageDisplaySets.some(isReported)) {
    return null;
  }

  let numInstances = 0;
  let numLoaded = 0;
  let numFailedImages = 0;

  imageDisplaySets.forEach(ds => {
    numInstances += ds.numInstances;
    numLoaded += isReported(ds) ? Math.min(ds.loadingProgress, 1) * ds.numInstances : 0;
    numFailedImages += ds.numFailedImages ?? 0;
  });

  return {
    // Rounding must not show as done a study still missing an image
    loadingProgress: numLoaded >= numInstances ? 1 : Math.min(numLoaded / numInstances, 0.99),
    numFailedImages,
    onRetry: () =>
      imageDisplaySets.forEach(ds => ds.numFailedImages > 0 && ds.onRetryFailedImages?.()),
  };
}

StudyItem.propTypes = {
  date: PropTypes.string.isRequired,
  description: PropTypes.string,
  modalities: PropTypes.string.isRequired,
  numInstances: PropTypes.number.isRequired,
  isActive: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  isExpanded: PropTypes.bool,
  displaySets: PropTypes.array,
  activeDisplaySetInstanceUIDs: PropTypes.array,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  viewPreset: PropTypes.string,
  StudyMenuItems: PropTypes.func,
  StudyInstanceUID: PropTypes.string,
};

export { StudyItem };
