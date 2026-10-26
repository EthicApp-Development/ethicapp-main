import PhaseInstructions from './PhaseInstructions.jsx';

export default function RankingPhaseView({ phase, isReadOnly, isActivePhase, t }) {
  return (
    <div className="d-flex flex-column gap-3">
      {!isActivePhase && !isReadOnly ? (
        <div className="alert alert-info py-2 mb-0" role="status">
          {t('sessionDetail.phaseReadOnlyWhileInactive')}
        </div>
      ) : null}

      <PhaseInstructions phase={phase} t={t} />

      <p className="mb-0 text-secondary">{t('sessionDetail.rankingTabPlaceholder')}</p>
    </div>
  );
}
