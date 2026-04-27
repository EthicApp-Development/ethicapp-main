export default function WaitingStatePanel({ t }) {
  return (
    <section className="mt-4 text-center border rounded p-4 bg-light" aria-live="polite">
      <h3 className="h5 mb-2">{t('sessionDetail.waitingTitle')}</h3>
      <p className="text-secondary mb-0">{t('sessionDetail.waitingDescription')}</p>
    </section>
  );
}
