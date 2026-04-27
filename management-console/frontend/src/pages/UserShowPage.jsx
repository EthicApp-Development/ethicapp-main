import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useI18n } from '../app/providers.jsx';
import {
  fetchUserById,
  impersonateProfessor,
  triggerPasswordReset,
  updateUser
} from '../api/usersApi.js';
import RecaptchaField from '../components/common/RecaptchaField.jsx';
import { recaptchaSiteKey } from '../config/env.js';

function UserShowPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaResetCounter, setRecaptchaResetCounter] = useState(0);

  const [form, setForm] = useState({
    firstname: '',
    lastname: '',
    sex: 'O',
    email: '',
    email_confirmation: '',
    role: 'A',
    admin_password: ''
  });

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      setLoading(true);
      setError('');

      try {
        const user = await fetchUserById(id);

        if (!isMounted) {
          return;
        }

        setForm({
          firstname: user.firstname || '',
          lastname: user.lastname || '',
          sex: user.sex || 'O',
          email: user.email || '',
          email_confirmation: user.email || '',
          role: user.role || 'A',
          admin_password: ''
        });
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || 'Unable to load user');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [id]);

  function onFieldChange(fieldName, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      await updateUser(id, {
        ...form,
        recaptcha_token: recaptchaToken
      });

      setSuccess(t('pages.userShow.saveSuccess'));
      setForm((currentForm) => ({
        ...currentForm,
        admin_password: ''
      }));
      setRecaptchaToken('');
      setRecaptchaResetCounter((counter) => counter + 1);
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.saveError'));
    }
  }

  async function onTriggerPasswordReset() {
    setError('');
    setResetMessage('');

    try {
      const response = await triggerPasswordReset(id, {
        admin_password: form.admin_password,
        recaptcha_token: recaptchaToken
      });

      setResetMessage(response.message || t('pages.userShow.passwordResetSuccess'));
      setRecaptchaToken('');
      setRecaptchaResetCounter((counter) => counter + 1);
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.passwordResetError'));
    }
  }

  async function onImpersonateProfessor() {
    setError('');

    try {
      const response = await impersonateProfessor(id, {
        admin_password: form.admin_password,
        recaptcha_token: recaptchaToken
      });

      const redirectTo = response.redirectTo || '/home';
      window.location.assign(redirectTo);
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.impersonationError'));
    }
  }

  if (loading) {
    return <Spinner />;
  }

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <Card.Title className="d-flex align-items-center gap-2 mb-0">
            <i className="fa-solid fa-id-card text-primary" aria-hidden="true" />
            <span>{t('pages.userShow.heading')}</span>
          </Card.Title>
          <Button variant="outline-secondary" as={Link} to="/users">
            <i className="fa-solid fa-arrow-left me-2" aria-hidden="true" />
            {t('pages.userShow.back')}
          </Button>
        </div>

        {error ? <Alert variant="danger">{error}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}
        {resetMessage ? <Alert variant="info">{resetMessage}</Alert> : null}

        <Form onSubmit={onSubmit}>
          <Row className="g-3">
            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.firstname')}</Form.Label>
              <Form.Control
                value={form.firstname}
                onChange={(event) => onFieldChange('firstname', event.target.value)}
                required
              />
            </Col>
            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.lastname')}</Form.Label>
              <Form.Control
                value={form.lastname}
                onChange={(event) => onFieldChange('lastname', event.target.value)}
                required
              />
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.gender')}</Form.Label>
              <Form.Select value={form.sex} onChange={(event) => onFieldChange('sex', event.target.value)}>
                <option value="F">{t('genders.F')}</option>
                <option value="M">{t('genders.M')}</option>
                <option value="O">{t('genders.O')}</option>
              </Form.Select>
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.role')}</Form.Label>
              <Form.Select value={form.role} onChange={(event) => onFieldChange('role', event.target.value)}>
                <option value="A">{t('roles.A')}</option>
                <option value="P">{t('roles.P')}</option>
                {form.role === 'S' ? <option value="S">{t('roles.S')}</option> : null}
              </Form.Select>
              <Form.Text>{t('pages.userShow.roleHelp')}</Form.Text>
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.email')}</Form.Label>
              <Form.Control
                type="email"
                value={form.email}
                onChange={(event) => onFieldChange('email', event.target.value)}
                required
              />
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.emailConfirmation')}</Form.Label>
              <Form.Control
                type="email"
                value={form.email_confirmation}
                onChange={(event) => onFieldChange('email_confirmation', event.target.value)}
                required
              />
            </Col>

            <Col md={12}>
              <Form.Label>{t('pages.userShow.fields.adminPassword')}</Form.Label>
              <Form.Control
                type="password"
                value={form.admin_password}
                onChange={(event) => onFieldChange('admin_password', event.target.value)}
                required
              />
              <Form.Text>{t('pages.userShow.adminPasswordHelp')}</Form.Text>
            </Col>

            <Col md={12} className="d-flex justify-content-center">
              <RecaptchaField
                siteKey={recaptchaSiteKey}
                resetCounter={recaptchaResetCounter}
                onChange={setRecaptchaToken}
              />
            </Col>
          </Row>

          <div className="d-flex gap-2 mt-4">
            <Button type="submit">
              <i className="fa-solid fa-floppy-disk me-2" aria-hidden="true" />
              {t('pages.userShow.actions.save')}
            </Button>
            <Button type="button" variant="outline-primary" onClick={() => navigate('/users')}>
              <i className="fa-solid fa-xmark me-2" aria-hidden="true" />
              {t('pages.userShow.actions.cancel')}
            </Button>
            <Button type="button" variant="warning" onClick={onTriggerPasswordReset}>
              <i className="fa-solid fa-key me-2" aria-hidden="true" />
              {t('pages.userShow.actions.triggerPasswordReset')}
            </Button>
            {form.role === 'P' ? (
              <Button type="button" variant="dark" onClick={onImpersonateProfessor}>
                <i className="fa-solid fa-user-secret me-2" aria-hidden="true" />
                {t('pages.userShow.actions.impersonateProfessor')}
              </Button>
            ) : null}
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
}

export default UserShowPage;
