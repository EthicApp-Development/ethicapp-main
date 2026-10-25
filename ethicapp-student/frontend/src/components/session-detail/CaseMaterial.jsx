import { useId, useMemo, useState } from 'react';
import VideoFacade from '../common/VideoFacade.jsx';
import {
  CASE_DOCUMENT_DISPLAY,
  caseMaterialDocuments,
  caseMaterialVideos
} from '../../utils/caseMaterial.js';

const DOCUMENT_TYPE_KEYS = Object.freeze({
  document: 'sessionDetail.attachedDocumentTypeDocument',
  spreadsheet: 'sessionDetail.attachedDocumentTypeSpreadsheet',
  presentation: 'sessionDetail.attachedDocumentTypePresentation',
  pdf: 'sessionDetail.attachedDocumentTypePdf',
  file: 'sessionDetail.attachedDocumentTypeFile'
});

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

function DocumentTypeIcon({ document, t }) {
  return (
    <>
      <i className={`fa-solid ${document.icon} case-material__document-icon`} aria-hidden="true" />
      <span className="visually-hidden">{`${t(DOCUMENT_TYPE_KEYS[document.type])}: `}</span>
    </>
  );
}

// A document Google reports as not public or not found: a notice, with its
// name when known, and no link.
function UnavailableDocument({ document, t }) {
  return (
    <div className="case-material__document-unavailable" role="note">
      <DocumentTypeIcon document={document} t={t} />
      <span className="case-material__document-name">
        {document.name ? <span className="d-block">{document.name}</span> : null}
        <span className="case-material__document-status">{t('sessionDetail.attachedDocumentUnavailable')}</span>
      </span>
    </div>
  );
}

function CaseDocumentItem({ document, t }) {
  if (document.display === CASE_DOCUMENT_DISPLAY.unavailable) {
    return (
      <li className="case-material__document is-unavailable">
        <UnavailableDocument document={document} t={t} />
      </li>
    );
  }

  return (
    <li className={`case-material__document is-${document.display}`}>
      <a className="case-material__document-link" href={document.url} target="_blank" rel="noopener noreferrer">
        <DocumentTypeIcon document={document} t={t} />
        <span className="case-material__document-name">{document.linkText}</span>
        <span className="visually-hidden">{` (${t('sessionDetail.linkOpensInNewTab')})`}</span>
      </a>
      {document.display === CASE_DOCUMENT_DISPLAY.unverified ? (
        <p className="case-material__document-notice">{t('sessionDetail.attachedDocumentUnverified')}</p>
      ) : null}
    </li>
  );
}

// The case's complementary material below the case document: its videos
// (#788, epic #779), then its Google Drive documents (#794, epic #789), each in
// the case's order. Nothing shows for a case without either. The facades read
// durations and availability from CaseVideosProvider. Documents are plain
// links: nothing is requested from Google before a click.
export default function CaseMaterial({ videos, documents, t }) {
  const headingId = useId();
  const materialVideos = useMemo(() => caseMaterialVideos(videos), [videos]);
  const materialDocuments = useMemo(() => caseMaterialDocuments(documents), [documents]);

  if (materialVideos.length === 0 && materialDocuments.length === 0) {
    return null;
  }

  return (
    <section className="case-material" aria-labelledby={headingId}>
      <h2 id={headingId} className="case-material__heading h5">
        {t('sessionDetail.caseMaterialHeading')}
      </h2>
      {materialVideos.length > 0 ? (
        <ol className="case-material__list">
          {materialVideos.map((video) => (
            <CaseMaterialItem key={video.videoId} video={video} t={t} />
          ))}
        </ol>
      ) : null}
      {materialDocuments.length > 0 ? (
        <ol className="case-material__documents" aria-label={t('sessionDetail.attachedDocumentList')}>
          {materialDocuments.map((document) => (
            <CaseDocumentItem key={document.key} document={document} t={t} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
