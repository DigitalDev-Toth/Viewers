import React from 'react';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Icons } from '../Icons';
import { TooltipTrigger, TooltipContent, Tooltip } from '../Tooltip';

type LoadingStatusProps = {
  /** From 0 to 1, as the study prefetcher reports it. Nothing is shown without it. */
  loadingProgress?: number;
  /** Images that could not be loaded; they count as done in `loadingProgress`. */
  numFailedImages?: number;
  /** Tries the failed images again. */
  onRetry?: () => void;
  className?: string;
};

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Whether the images of a series (or a whole study) are already downloaded:
 * a ring while they load, a check once they are all here, and a warning, which
 * retries on click, when some could not be loaded.
 */
const LoadingStatus = ({
  loadingProgress,
  numFailedImages = 0,
  onRetry,
  className,
}: LoadingStatusProps) => {
  const { t } = useTranslation('StudyBrowser');

  if (typeof loadingProgress !== 'number' || Number.isNaN(loadingProgress)) {
    return null;
  }

  const isDone = loadingProgress >= 1;
  let icon: React.ReactNode;
  let tooltip: string;

  if (isDone && numFailedImages > 0) {
    tooltip = t('Images could not be downloaded', { number: numFailedImages });
    icon = (
      <button
        type="button"
        aria-label={tooltip}
        className="flex"
        onClick={event => {
          // Neither select the series nor fold the study
          event.stopPropagation();
          onRetry?.();
        }}
      >
        <Icons.StatusWarning className="h-[15px] w-[15px]" />
      </button>
    );
  } else if (isDone) {
    tooltip = t('Downloaded');
    icon = <Icons.StatusSuccess className="h-[15px] w-[15px] text-green-500" />;
  } else {
    tooltip = t('Downloading', { percent: Math.floor(loadingProgress * 100) });
    icon = (
      <svg
        viewBox="0 0 16 16"
        className="text-primary h-[15px] w-[15px] -rotate-90"
        aria-label={tooltip}
      >
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - loadingProgress)}
        />
      </svg>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={classnames('flex items-center', className)}
          data-cy="loading-status"
        >
          {icon}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};

export { LoadingStatus };
export type { LoadingStatusProps };
