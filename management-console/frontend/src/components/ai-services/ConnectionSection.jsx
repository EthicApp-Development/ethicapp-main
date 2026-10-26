import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { formatDateTime } from '../diagnostics/formatters.js';
import ConnectionTestResult from './ConnectionTestResult.jsx';

function formValuesFrom(connection) {
  return {
    baseUrl: connection?.baseUrl || '',
    keycloakPublicUrl: connection?.keycloakPublicUrl || ''
  };
}

function NoConnectionNotice() {
  const { t } = useI18n();

  return (
    <Alert variant="secondary" data-testid="ai-no-connection">
      <Alert.Heading as="h6" className="d-flex align-items-center gap-2">
        <i className="fa-solid fa-plug-circle-xmark" aria-hidden="true" />
        {t('pages.aiServices.noConnection.title')}
      </Alert.Heading>
      <p className="mb-0">{t('pages.aiServices.noConnection.body')}</p>
    </Alert>
  );
}

// Connection form: test unsaved URLs, save them, or remove the connection.
// The handlers come from the page and return promises; errors carry `code`.
// onSave and onRemove ask for the administrator's confirmation first and
// resolve to a falsy value when it is cancelled.
function ConnectionSection({ connection, onTest, onSave, onRemove }) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState(() => formValuesFrom(connection));
  const [busyAction, setBusyAction] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [feedback, setFeedback] = useState(null);

  function updateField(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  async function run(action, callback) {
    setBusyAction(action);
    setFeedback(null);
    try {
      await callback();
    } catch (error) {
      const key = `pages.aiServices.connection.errors.${error.code}`;
      const message = t(key);
      setFeedback({ variant: 'danger', text: message === key ? t(`pages.aiServices.connection.${action}Error`) : message });
    } finally {
      setBusyAction('');
    }
  }

  const handleTest = () => run('test', async () => {
    setTestResult(null);
    setTestResult(await onTest(values));
  });

  const handleSave = (event) => {
    event.preventDefault();
    return run('save', async () => {
      const saved = await onSave(values);
      if (!saved) {
        return;
      }
      setValues(formValuesFrom(saved));
      setFeedback({ variant: 'success', text: t('pages.aiServices.connection.saveSuccess') });
    });
  };

  const handleRemove = () => run('remove', async () => {
    if (!(await onRemove())) {
      return;
    }
    setValues(formValuesFrom(null));
    setTestResult(null);
    setFeedback({ variant: 'success', text: t('pages.aiServices.connection.removeSuccess') });
  });

  const busy = busyAction !== '';
  const author = connection?.updatedBy?.name;

  return (
    <Card className="mb-4" as="section" aria-labelledby="ai-connection-heading">
      <Card.Body>
        <Card.Title id="ai-connection-heading" className="d-flex align-items-center gap-2">
          <i className="fa-solid fa-plug text-primary" aria-hidden="true" />
          {t('pages.aiServices.connection.heading')}
        </Card.Title>
        <Card.Text className="text-body-secondary">{t('pages.aiServices.connection.description')}</Card.Text>

        {connection ? (
          <p className="small text-body-secondary">
            {t(author ? 'pages.aiServices.connection.lastUpdated' : 'pages.aiServices.connection.lastUpdatedNoAuthor', {
              date: formatDateTime(connection.updatedAt, locale),
              author
            })}
          </p>
        ) : <NoConnectionNotice />}

        {feedback ? <Alert variant={feedback.variant}>{feedback.text}</Alert> : null}

        <Form onSubmit={handleSave} noValidate>
          <Form.Group className="mb-3" controlId="ai-connection-base-url">
            <Form.Label>{t('pages.aiServices.connection.fields.baseUrl')}</Form.Label>
            <Form.Control type="url" value={values.baseUrl} onChange={updateField('baseUrl')} placeholder="https://ai.example.org" required />
            <Form.Text>{t('pages.aiServices.connection.fields.baseUrlHelp')}</Form.Text>
          </Form.Group>
          <Form.Group className="mb-3" controlId="ai-connection-keycloak-url">
            <Form.Label>{t('pages.aiServices.connection.fields.keycloakPublicUrl')}</Form.Label>
            <Form.Control type="url" value={values.keycloakPublicUrl} onChange={updateField('keycloakPublicUrl')} />
            <Form.Text>{t('pages.aiServices.connection.fields.keycloakPublicUrlHelp')}</Form.Text>
          </Form.Group>

          <div className="d-flex flex-wrap gap-2">
            <Button variant="outline-primary" onClick={handleTest} disabled={busy || !values.baseUrl.trim()}>
              {busyAction === 'test' ? <Spinner size="sm" className="me-2" /> : <i className="fa-solid fa-vial me-2" aria-hidden="true" />}
              {t('pages.aiServices.connection.actions.test')}
            </Button>
            <Button type="submit" disabled={busy || !values.baseUrl.trim()}>
              {busyAction === 'save' ? <Spinner size="sm" className="me-2" /> : null}
              {t('pages.aiServices.connection.actions.save')}
            </Button>
            {connection ? (
              <Button variant="outline-danger" onClick={handleRemove} disabled={busy}>
                {busyAction === 'remove' ? <Spinner size="sm" className="me-2" /> : null}
                {t('pages.aiServices.connection.actions.remove')}
              </Button>
            ) : null}
          </div>
        </Form>

        {testResult ? <ConnectionTestResult result={testResult} /> : null}
      </Card.Body>
    </Card>
  );
}

ConnectionSection.propTypes = {
  connection: PropTypes.shape({
    baseUrl: PropTypes.string.isRequired,
    keycloakPublicUrl: PropTypes.string,
    updatedAt: PropTypes.string,
    updatedBy: PropTypes.shape({ id: PropTypes.number, name: PropTypes.string })
  }),
  onTest: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired
};

export default ConnectionSection;
