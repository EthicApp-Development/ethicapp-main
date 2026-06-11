import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { startRegistration } from '@simplewebauthn/browser';

import { useI18n } from '../app/providers.jsx';
import {
  changeOwnPassword,
  deletePasskey,
  fetchPasskeys,
  fetchProfile,
  finishPasskeyRegistration,
  startPasskeyRegistration
} from '../api/profileApi.js';
import { redirectToLogin } from '../api/sessionRedirect.js';

function getPasswordChecks(password) {
  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

  return {
    minLength: password.length >= 10,
    twoSymbols: symbolCount >= 2
  };
}

function ProfilePage() {
  const { locale, t } = useI18n();
  const [profile, setProfile] = useState(null);
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState(null);
  const [error, setError] = useState('');
  const [passkeyError, setPasskeyError] = useState('');
  const [passkeySuccess, setPasskeySuccess] = useState('');
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    password_confirmation: ''
  });
  const [passkeyForm, setPasskeyForm] = useState({
    password: '',
    name: '',
    delete_password: ''
  });

  const passwordChecks = useMemo(() => getPasswordChecks(form.new_password), [form.new_password]);
  const passkeysAvailable = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      setLoading(true);
      setError('');

      try {
        const [profileResult, passkeysResult] = await Promise.all([
          fetchProfile(),
          fetchPasskeys()
        ]);
        if (isMounted) {
          setProfile(profileResult);
          setPasskeys(passkeysResult.passkeys || []);
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

  function onPasskeyFieldChange(fieldName, value) {
    setPasskeyForm((currentForm) => ({
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

  function getRequestErrorMessage(requestError, fallback) {
    const errorsByCode = {
      MISSING_REQUIRED_FIELDS: t('pages.profile.errors.required')
    };

    return errorsByCode[requestError.message] || requestError.message || fallback;
  }

  function formatDate(value) {
    if (!value) {
      return t('pages.profile.passkeys.neverUsed');
    }

    return new Intl.DateTimeFormat(locale.replace('_', '-'), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    try {
      await changeOwnPassword(form);
      redirectToLogin({ notice: 'password_changed' });
    } catch (requestError) {
      setError(getPasswordRequestErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function onRegisterPasskey(event) {
    event.preventDefault();
    setPasskeyError('');
    setPasskeySuccess('');

    if (!passkeysAvailable) {
      setPasskeyError(t('pages.profile.passkeys.unsupported'));
      return;
    }

    if (!passkeyForm.password) {
      setPasskeyError(t('pages.profile.errors.required'));
      return;
    }

    setPasskeySaving(true);

    try {
      const options = await startPasskeyRegistration({ password: passkeyForm.password });
      const credential = await startRegistration({ optionsJSON: options });
      const result = await finishPasskeyRegistration({
        credential,
        name: passkeyForm.name
      });

      setPasskeys(result.passkeys || []);
      setPasskeySuccess(result.message || t('pages.profile.passkeys.registerSuccess'));
      setPasskeyForm({
        password: '',
        name: '',
        delete_password: ''
      });
    } catch (requestError) {
      setPasskeyError(getRequestErrorMessage(requestError, t('pages.profile.passkeys.registerError')));
    } finally {
      setPasskeySaving(false);
    }
  }

  async function onDeletePasskey(passkeyId) {
    setPasskeyError('');
    setPasskeySuccess('');

    if (!passkeyForm.delete_password) {
      setPasskeyError(t('pages.profile.errors.required'));
      return;
    }

    setDeletingPasskeyId(passkeyId);

    try {
      const result = await deletePasskey(passkeyId, { password: passkeyForm.delete_password });
      setPasskeys(result.passkeys || []);
      setPasskeySuccess(result.message || t('pages.profile.passkeys.deleteSuccess'));
      setPasskeyForm((currentForm) => ({
        ...currentForm,
        delete_password: ''
      }));
    } catch (requestError) {
      setPasskeyError(getRequestErrorMessage(requestError, t('pages.profile.passkeys.deleteError')));
    } finally {
      setDeletingPasskeyId(null);
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

      <Col lg={12}>
        <Card>
          <Card.Body>
            <Card.Title className="d-flex align-items-center gap-2">
              <i className="fa-solid fa-fingerprint text-primary" aria-hidden="true" />
              <span>{t('pages.profile.passkeys.heading')}</span>
            </Card.Title>
            <Card.Text>{t('pages.profile.passkeys.description')}</Card.Text>

            {!passkeysAvailable ? (
              <Alert variant="warning">{t('pages.profile.passkeys.unsupported')}</Alert>
            ) : null}
            {passkeyError ? <Alert variant="danger">{passkeyError}</Alert> : null}
            {passkeySuccess ? <Alert variant="success">{passkeySuccess}</Alert> : null}

            <Row className="g-4">
              <Col lg={5}>
                <Form onSubmit={onRegisterPasskey}>
                  <Form.Group className="mb-3" controlId="profile-passkey-name">
                    <Form.Label>{t('pages.profile.passkeys.fields.name')}</Form.Label>
                    <Form.Control
                      type="text"
                      value={passkeyForm.name}
                      onChange={(event) => onPasskeyFieldChange('name', event.target.value)}
                      placeholder={t('pages.profile.passkeys.fields.namePlaceholder')}
                      maxLength={120}
                    />
                  </Form.Group>

                  <Form.Group className="mb-4" controlId="profile-passkey-password">
                    <Form.Label>{t('pages.profile.fields.currentPassword')}</Form.Label>
                    <Form.Control
                      type="password"
                      value={passkeyForm.password}
                      onChange={(event) => onPasskeyFieldChange('password', event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </Form.Group>

                  <Button type="submit" disabled={passkeySaving || !passkeysAvailable}>
                    {passkeySaving ? (
                      <Spinner size="sm" className="me-2" />
                    ) : (
                      <i className="fa-solid fa-plus me-2" aria-hidden="true" />
                    )}
                    {t('pages.profile.passkeys.actions.add')}
                  </Button>
                </Form>
              </Col>

              <Col lg={7}>
                {passkeys.length > 0 ? (
                  <>
                    <Form.Group className="mb-3" controlId="profile-passkey-delete-password">
                      <Form.Label>{t('pages.profile.passkeys.fields.deletePassword')}</Form.Label>
                      <Form.Control
                        type="password"
                        value={passkeyForm.delete_password}
                        onChange={(event) => onPasskeyFieldChange('delete_password', event.target.value)}
                        autoComplete="current-password"
                      />
                    </Form.Group>

                    <div className="list-group">
                      {passkeys.map((passkey) => (
                        <div
                          className="list-group-item d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3"
                          key={passkey.id}
                        >
                          <div>
                            <div className="fw-semibold">
                              {passkey.name || t('pages.profile.passkeys.defaultName')}
                            </div>
                            <div className="small text-secondary">
                              {t('pages.profile.passkeys.createdAt', {
                                date: formatDate(passkey.created_at)
                              })}
                            </div>
                            <div className="small text-secondary">
                              {t('pages.profile.passkeys.lastUsedAt', {
                                date: formatDate(passkey.last_used_at)
                              })}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline-danger"
                            size="sm"
                            onClick={() => onDeletePasskey(passkey.id)}
                            disabled={deletingPasskeyId === passkey.id}
                          >
                            {deletingPasskeyId === passkey.id ? (
                              <Spinner size="sm" className="me-2" />
                            ) : (
                              <i className="fa-solid fa-trash me-2" aria-hidden="true" />
                            )}
                            {t('pages.profile.passkeys.actions.remove')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <Alert variant="secondary" className="mb-0">
                    {t('pages.profile.passkeys.empty')}
                  </Alert>
                )}
              </Col>
            </Row>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}

export default ProfilePage;
