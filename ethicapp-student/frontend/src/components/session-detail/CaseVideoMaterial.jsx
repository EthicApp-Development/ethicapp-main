import { useId, useMemo, useState } from 'react';
import VideoFacade from '../common/VideoFacade.jsx';
import { caseMaterialVideos } from '../../utils/caseMaterial.js';

// A video whose metadata is missing (YouTube unreachable, or video support not
// configured): its watch link and a notice instead of the facade.
function MissingVideoMetadata({ watchUrl, t }) {
  return (
    <div className="video-facade-unavailable case-material__missing" role="note">
      <i className="fa-solid fa-video video-facade-unavailable__icon" aria-hidden="true" />
      <div className="video-facade-unavailable__body">
        <p className="video-facade-unavailable__notice">{t('sessionDetail.caseMaterialMetadataMissing')}</p>
        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
          {watchUrl}
          <span className="visually-hidden">{` (${t('sessionDetail.linkOpensInNewTab')})`}</span>
        </a>
        <p className="case-material__source mb-0">{t('sessionDetail.videoSource')}</p>
      </div>
    </div>
  );
}

function CaseMaterialItem({ video, t }) {
  const descriptionId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsed = video.hasLongDescription && !isExpanded;

  return (
    <li className="case-material__item">
      {video.hasMetadata ? (
        <VideoFacade videoId={video.videoId} title={video.title} />
      ) : (
        <MissingVideoMetadata watchUrl={video.watchUrl} t={t} />
      )}

      {video.description ? (
        <p id={descriptionId} className={`case-material__description${isCollapsed ? ' is-collapsed' : ''}`}>
          {video.description}
        </p>
      ) : null}

      {video.description && video.hasLongDescription ? (
        <button
          type="button"
          className="btn btn-link btn-sm p-0 case-material__toggle"
          aria-expanded={!isCollapsed}
          aria-controls={descriptionId}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {t(isCollapsed ? 'sessionDetail.caseMaterialShowMore' : 'sessionDetail.caseMaterialShowLess')}
        </button>
      ) : null}
    </li>
  );
}

// The case's videos as complementary material below the case document (#788,
// epic #779), in the case's order. Nothing shows for a case without videos.
// The facades read durations and availability from CaseVideosProvider.
export default function CaseVideoMaterial({ videos, t }) {
  const headingId = useId();
  const materialVideos = useMemo(() => caseMaterialVideos(videos), [videos]);

  if (materialVideos.length === 0) {
    return null;
  }

  return (
    <section className="case-material" aria-labelledby={headingId}>
      <h2 id={headingId} className="case-material__heading h5">
        {t('sessionDetail.caseMaterialHeading')}
      </h2>
      <ol className="case-material__list">
        {materialVideos.map((video) => (
          <CaseMaterialItem key={video.videoId} video={video} t={t} />
        ))}
      </ol>
    </section>
  );
}
