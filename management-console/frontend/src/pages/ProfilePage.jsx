import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';

import { useI18n } from '../app/providers.jsx';
import { changeOwnPassword, fetchProfile } from '../api/profileApi.js';

function getPasswordChecks(password) {
  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

  return {
    minLength: password.length >= 10,
    twoSymbols: symbolCount >= 2
  };
}

function ProfilePage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    password_confirmation: ''
  });

  const passwordChecks = useMemo(() => getPasswordChecks(form.new_password), [form.new_password]);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      setLoading(true);
      setError('');

      try {
        const result = await fetchProfile();
        if (isMounted) {
          setProfile(result);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || t('pages.profile.loadError'));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [t]);

  function onFieldChange(fieldName, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value
    }));
  }

  function validateForm() {
    if (!form.current_password || !form.new_password || !form.password_confirmation) {
      return t('pages.profile.errors.required');
    }

    if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
      return t('pages.profile.errors.weakPassword');
    }

    if (form.new_password !== form.password_confirmation) {
      return t('pages.profile.errors.passwordMismatch');
    }

    return '';
  }

  function getPasswordRequestErrorMessage(requestError) {
    const errorsByCode = {
      MISSING_REQUIRED_FIELDS: t('pages.profile.errors.required'),
      WEAK_PASSWORD: t('pages.profile.errors.weakPassword'),
      PASSWORD_CONFIRMATION_MISMATCH: t('pages.profile.errors.passwordMismatch')
    };

    return errorsByCode[requestError.message] || requestError.message || t('pages.profile.passwordChangeError');
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    try {
      const result = await changeOwnPassword(form);
      setSuccess(result.message || t('pages.profile.passwordChangeSuccess'));
      setForm({
        current_password: '',
        new_password: '',
        password_confirmation: ''
      });
    } catch (requestError) {
      setError(getPasswordRequestErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2">
        <Spinner size="sm" />
        <span>{t('pages.profile.loading')}</span>
      </div>
    );
  }

  return (
    <Row className="g-4">
      <Col lg={5}>
        <Card>
          <Card.Body>
            <Card.Title className="d-flex align-items-center gap-2">
              <i className="fa-solid fa-id-badge text-primary" aria-hidden="true" />
              <span>{t('pages.profile.heading')}</span>
            </Card.Title>

            {profile ? (
              <dl className="row mb-0">
                <dt className="col-sm-4">{t('pages.profile.fields.name')}</dt>
                <dd className="col-sm-8">
                  {[profile.firstname, profile.lastname].filter(Boolean).join(' ') || profile.email}
                </dd>
                <dt className="col-sm-4">{t('pages.profile.fields.email')}</dt>
                <dd className="col-sm-8">{profile.email}</dd>
                <dt className="col-sm-4">{t('pages.profile.fields.role')}</dt>
                <dd className="col-sm-8">{t(`roles.${profile.role}`)}</dd>
              </dl>
            ) : (
              <Alert variant="warning" className="mb-0">
                {t('pages.profile.loadError')}
              </Alert>
            )}
          </Card.Body>
        </Card>
      </Col>

      <Col lg={7}>
        <Card>
          <Card.Body>
            <Card.Title className="d-flex align-items-center gap-2">
              <i className="fa-solid fa-key text-primary" aria-hidden="true" />
              <span>{t('pages.profile.passwordHeading')}</span>
            </Card.Title>
            <Card.Text>{t('pages.profile.passwordDescription')}</Card.Text>

            {error ? <Alert variant="danger">{error}</Alert> : null}
            {success ? <Alert variant="success">{success}</Alert> : null}

            <Form onSubmit={onSubmit}>
              <Form.Group className="mb-3" controlId="profile-current-password">
                <Form.Label>{t('pages.profile.fields.currentPassword')}</Form.Label>
                <Form.Control
                  type="password"
                  value={form.current_password}
                  onChange={(event) => onFieldChange('current_password', event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="profile-new-password">
                <Form.Label>{t('pages.profile.fields.newPassword')}</Form.Label>
                <Form.Control
                  type="password"
                  value={form.new_password}
                  onChange={(event) => onFieldChange('new_password', event.target.value)}
                  autoComplete="new-password"
                  required
                />
                <Form.Text>{t('pages.profile.passwordRules.helpText')}</Form.Text>
                <ul className="password-rule-list mt-2 mb-0">
                  <li className={passwordChecks.minLength ? 'text-success' : 'text-secondary'}>
                    {t('pages.profile.passwordRules.minLength')}
                  </li>
                  <li className={passwordChecks.twoSymbols ? 'text-success' : 'text-secondary'}>
                    {t('pages.profile.passwordRules.twoSymbols')}
                  </li>
                </ul>
              </Form.Group>

              <Form.Group className="mb-4" controlId="profile-password-confirmation">
                <Form.Label>{t('pages.profile.fields.passwordConfirmation')}</Form.Label>
                <Form.Control
                  type="password"
                  value={form.password_confirmation}
                  onChange={(event) => onFieldChange('password_confirmation', event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Form.Group>

              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Spinner size="sm" className="me-2" />
                ) : (
                  <i className="fa-solid fa-floppy-disk me-2" aria-hidden="true" />
                )}
                {t('pages.profile.actions.changePassword')}
              </Button>
            </Form>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}

export default ProfilePage;
