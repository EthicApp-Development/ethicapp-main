export default function RankingPhaseView({ phase, isReadOnly, isActivePhase, t }) {
  const phaseInstructions = typeof phase?.instructions === 'string' && phase.instructions.trim().length > 0
    ? phase.instructions
    : (typeof phase?.question === 'string' ? phase.question : '');

  return (
    <div className="d-flex flex-column gap-3">
      {!isActivePhase && !isReadOnly ? (
        <div className="alert alert-info py-2 mb-0" role="status">
          {t('sessionDetail.phaseReadOnlyWhileInactive')}
        </div>
      ) : null}

      {phaseInstructions.trim().length > 0 ? (
        <div className="alert alert-secondary mb-0" role="note">
          <strong>{t('sessionDetail.instructionsLabel')}:</strong> {phaseInstructions}
        </div>
      ) : null}

      <p className="mb-0 text-secondary">{t('sessionDetail.rankingTabPlaceholder')}</p>
    </div>
  );
}
