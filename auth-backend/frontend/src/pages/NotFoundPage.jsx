import { Link } from 'react-router-dom';
import { useI18n } from '../app/providers';
import AuthLayout from '../components/auth/AuthLayout';

function NotFoundPage() {
  const { t } = useI18n();

  return (
    <AuthLayout title={t('notFound.code')} subtitle={t('notFound.title')}>
      <p>{t('notFound.message')}</p>
      <Link to="/login">{t('notFound.backToLogin')}</Link>
    </AuthLayout>
  );
}

export default NotFoundPage;
