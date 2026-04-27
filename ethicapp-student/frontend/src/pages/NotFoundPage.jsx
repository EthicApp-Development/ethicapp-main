import { Link } from 'react-router-dom';
import { useI18n } from '../app/providers.jsx';

export default function NotFoundPage() {
  const { t } = useI18n();

  return (
    <section className="text-center py-5">
      <h1 className="h4">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.description')}</p>
      <Link to="/" className="btn btn-primary btn-sm">
        <span className="d-inline-flex align-items-center gap-2">
          <i className="fa-solid fa-house" aria-hidden="true" />
          <span>{t('notFound.backHome')}</span>
        </span>
      </Link>
    </section>
  );
}
