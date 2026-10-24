import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../app/providers.jsx';
import { useCaseVideoMetadata } from '../../context/CaseVideosContext.jsx';
import { describeVideo, VIDEO_PLAYER_ALLOW, videoPlayerUrl } from '../../utils/videoFacade.js';

// A YouTube video in teacher-written text (#786, epic #779). Until the student
// taps it, it is a generic EthicApp card that requests nothing from YouTube or
// Google; the tap swaps in the privacy-enhanced player in the same 16:9 box.
// Everything is built from the validated video id.
export default function VideoFacade({ videoId, title }) {
  const { t } = useI18n();
  const metadata = useCaseVideoMetadata(videoId);
  const [isActive, setIsActive] = useState(false);
  const playerRef = useRef(null);
  const detailsId = useId();
  const video = describeVideo({ videoId, title, metadata });
  const label = video.title || t('sessionDetail.videoUntitled');

  useEffect(() => {
    if (isActive) {
      playerRef.current?.focus();
    }
  }, [isActive]);

  if (!video.playable) {
    return (
      <div className="video-facade-unavailable" role="note">
        <i className="fa-solid fa-video-slash video-facade-unavailable__icon" aria-hidden="true" />
        <div className="video-facade-unavailable__body">
          <p className="video-facade-unavailable__title">{label}</p>
          <p className="video-facade-unavailable__notice">{t('sessionDetail.videoNotAvailable')}</p>
          <a href={video.watchUrl} target="_blank" rel="noopener noreferrer">
            {t('sessionDetail.videoOpenOnYoutube')}
            <span className="visually-hidden">{` (${t('sessionDetail.linkOpensInNewTab')})`}</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="video-facade ratio ratio-16x9">
      {isActive ? (
        <iframe
          ref={playerRef}
          className="video-facade__player"
          src={videoPlayerUrl(videoId)}
          title={label}
          allow={VIDEO_PLAYER_ALLOW}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          className="video-facade__button"
          aria-label={t('sessionDetail.videoPlay', { title: label })}
          aria-describedby={detailsId}
          onClick={() => setIsActive(true)}
        >
          <span className="video-facade__play" aria-hidden="true">
            <i className="fa-solid fa-play" />
          </span>
          <span className="video-facade__caption">
            <span className="video-facade__title">{label}</span>
            <span id={detailsId} className="video-facade__details">
              {video.duration ? <span className="video-facade__duration">{video.duration}</span> : null}
              <span className="video-facade__source">
                <i className="fa-brands fa-youtube" aria-hidden="true" />
                {t('sessionDetail.videoSource')}
              </span>
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
