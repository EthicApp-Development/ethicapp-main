function getContentRepresentation(caseDocument) {
  if (!caseDocument || !Array.isArray(caseDocument.representations)) {
    return null;
  }

  return caseDocument.representations.find((representation) => representation.rel === 'content') ?? null;
}

function getPdfUrl(caseDocument, fallbackUrl) {
  const contentUrl = getContentRepresentation(caseDocument)?.href ?? '';
  return contentUrl || fallbackUrl || '';
}

function getRenderedImages(caseDocument) {
  const documentImages = caseDocument?.documentRepresentation?.content?.images;
  const renderedImages = Array.isArray(documentImages) ? documentImages : caseDocument?.renderedImages;

  if (Array.isArray(renderedImages) && renderedImages.length > 0) {
    return renderedImages
      .map((image, index) => ({
        ...image,
        sequenceNumber: image.sequenceNumber || image.pageNumber || index + 1,
        src: image.url || image.dataUri || ''
      }))
      .filter((image) => image.src)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  }

  if (!Array.isArray(caseDocument?.representations)) {
    return [];
  }

  return caseDocument.representations
    .filter((representation) => (
      representation.rel === 'rendered-image' && /^image\//.test(representation.mediaType ?? '')
    ))
    .map((representation, index) => ({
      sequenceNumber: representation.sequenceNumber || representation.pageNumber || index + 1,
      pageNumber: representation.pageNumber,
      contentType: representation.mediaType,
      src: representation.href,
      width: representation.width,
      height: representation.height
    }))
    .filter((image) => image.src)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

function buildPdfFallbackUrl(pdfUrl) {
  if (typeof pdfUrl !== 'string' || pdfUrl.trim().length === 0) {
    return '';
  }

  const normalizedPdfUrl = pdfUrl.trim();
  const hash = '#toolbar=0&navpanes=0&scrollbar=1';
  return normalizedPdfUrl.includes('#') ? normalizedPdfUrl : `${normalizedPdfUrl}${hash}`;
}

export default function CaseDocumentViewer({ caseDocument, caseDocumentUrl, t }) {
  const renderedImages = getRenderedImages(caseDocument);
  const pdfUrl = getPdfUrl(caseDocument, caseDocumentUrl);
  const pdfFallbackUrl = buildPdfFallbackUrl(pdfUrl);
  const processingStatus = caseDocument?.documentProcessing?.status ?? '';
  const isProcessing = processingStatus === 'pending' || processingStatus === 'processing';
  const hasFailed = processingStatus === 'failed';

  return (
    <div className="case-document-viewer d-flex flex-column gap-3">
      {renderedImages.length > 0 ? (
        <div className="case-document-image-scroll d-flex flex-column gap-2">
          {renderedImages.map((image) => {
            const pageNumber = image.pageNumber || image.sequenceNumber;
            return (
              <figure key={image.sequenceNumber} className="case-document-page m-0 bg-white">
                <img
                  src={image.src}
                  alt={t('sessionDetail.caseDocumentPageAlt', { page: pageNumber })}
                  className="case-document-page-image img-fluid d-block mx-auto"
                  loading={image.sequenceNumber > 1 ? 'lazy' : 'eager'}
                />
                <figcaption className="text-center text-muted small mt-2">
                  {t('sessionDetail.caseDocumentPageLabel', { page: pageNumber })}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : null}

      {renderedImages.length === 0 && isProcessing ? (
        <div className="alert alert-info mb-0" role="status">
          <span className="d-inline-flex align-items-center gap-2">
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
            <span>{t('sessionDetail.caseDocumentProcessing')}</span>
          </span>
        </div>
      ) : null}

      {renderedImages.length === 0 && hasFailed ? (
        <div className="alert alert-warning mb-0" role="alert">
          {t('sessionDetail.caseDocumentProcessingFailed')}
        </div>
      ) : null}

      {renderedImages.length === 0 && pdfFallbackUrl ? (
        <iframe
          title={t('sessionDetail.caseTab')}
          src={pdfFallbackUrl}
          width="100%"
          height="640"
          className="border rounded"
        />
      ) : null}

      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <small className="text-muted">{t('sessionDetail.caseViewerHint')}</small>
        {pdfUrl ? (
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn btn-outline-secondary btn-sm">
            {t('sessionDetail.openCaseInNewTab')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
