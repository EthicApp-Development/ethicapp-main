import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Image, Row, Spinner } from 'react-bootstrap';

import { useI18n } from '../app/providers.jsx';
import { fetchInstitution, updateInstitution } from '../api/institutionApi.js';

const CONTACT_TYPES = ['technical', 'academic'];
const EMPTY_CONTACT = {
  firstname: '',
  lastname: '',
  email: '',
  phoneCountryCode: '',
  phoneNumber: ''
};

function emptyContacts() {
  return CONTACT_TYPES.reduce((contacts, contactType) => ({
    ...contacts,
    [contactType]: { ...EMPTY_CONTACT }
  }), {});
}

function contactsFromResponse(contacts = []) {
  const nextContacts = emptyContacts();

  contacts.forEach((contact) => {
    if (CONTACT_TYPES.includes(contact.type)) {
      nextContacts[contact.type] = {
        firstname: contact.firstname || '',
        lastname: contact.lastname || '',
        email: contact.email || '',
        phoneCountryCode: contact.phoneCountryCode || '',
        phoneNumber: contact.phoneNumber || ''
      };
    }
  });

  return nextContacts;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}

function InstitutionPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [selectedLogo, setSelectedLogo] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [form, setForm] = useState({
    name: '',
    logo: null,
    contacts: emptyContacts()
  });

  useEffect(() => () => {
    if (logoPreviewUrl) {
      URL.revokeObjectURL(logoPreviewUrl);
    }
  }, [logoPreviewUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadInstitution() {
      setLoading(true);
      setError('');

      try {
        const institution = await fetchInstitution();
        if (!isMounted) {
          return;
        }

        setForm({
          name: institution.name || '',
          logo: institution.logo || null,
          contacts: contactsFromResponse(institution.contacts)
        });
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || t('pages.institution.loadError'));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadInstitution();

    return () => {
      isMounted = false;
    };
  }, [t]);

  function setInstitutionField(fieldName, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value
    }));
  }

  function setContactField(contactType, fieldName, value) {
    setForm((currentForm) => ({
      ...currentForm,
      contacts: {
        ...currentForm.contacts,
        [contactType]: {
          ...currentForm.contacts[contactType],
          [fieldName]: value
        }
      }
    }));
  }

  function onLogoSelected(file) {
    setError('');
    setSelectedLogo(file || null);
    setRemoveLogo(false);

    if (logoPreviewUrl) {
      URL.revokeObjectURL(logoPreviewUrl);
    }

    setLogoPreviewUrl(file ? URL.createObjectURL(file) : '');
  }

  function onRemoveLogo() {
    setSelectedLogo(null);
    setRemoveLogo(true);

    if (logoPreviewUrl) {
      URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl('');
    }
  }

  function validateForm() {
    if (!form.name.trim()) {
      return t('pages.institution.errors.nameRequired');
    }

    if (selectedLogo && !['image/png', 'image/jpeg'].includes(selectedLogo.type)) {
      return t('pages.institution.errors.invalidLogoType');
    }

    if (selectedLogo && selectedLogo.size > 1024 * 1024) {
      return t('pages.institution.errors.logoTooLarge');
    }

    return '';
  }

  function getRequestErrorMessage(requestError) {
    const errorsByCode = {
      MISSING_INSTITUTION_NAME: t('pages.institution.errors.nameRequired'),
      INVALID_LOGO_TYPE: t('pages.institution.errors.invalidLogoType'),
      INVALID_LOGO_DATA: t('pages.institution.errors.invalidLogoData'),
      LOGO_SIZE_LIMIT_EXCEEDED: t('pages.institution.errors.logoTooLarge')
    };

    return errorsByCode[requestError.message] || requestError.message || t('pages.institution.saveError');
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
      const logoPayload = selectedLogo
        ? {
            filename: selectedLogo.name,
            mimeType: selectedLogo.type,
            data: await readFileAsBase64(selectedLogo)
          }
        : null;

      const result = await updateInstitution({
        name: form.name,
        contacts: form.contacts,
        logo: logoPayload,
        removeLogo
      });

      setForm({
        name: result.name || '',
        logo: result.logo || null,
        contacts: contactsFromResponse(result.contacts)
      });
      setSelectedLogo(null);
      setRemoveLogo(false);
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
        setLogoPreviewUrl('');
      }
      setSuccess(t('pages.institution.saveSuccess'));
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2">
        <Spinner size="sm" />
        <span>{t('pages.institution.loading')}</span>
      </div>
    );
  }

  const displayedLogoUrl = logoPreviewUrl || (!removeLogo ? form.logo?.url : '');

  return (
    <Card>
      <Card.Body>
        <Card.Title className="d-flex align-items-center gap-2">
          <i className="fa-solid fa-building-columns text-primary" aria-hidden="true" />
          <span>{t('pages.institution.heading')}</span>
        </Card.Title>
        <Card.Text>{t('pages.institution.description')}</Card.Text>

        {error ? <Alert variant="danger">{error}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}

        <Form onSubmit={onSubmit}>
          <Row className="g-4">
            <Col lg={7}>
              <Form.Group className="mb-3" controlId="institution-name">
                <Form.Label>{t('pages.institution.fields.name')}</Form.Label>
                <Form.Control
                  value={form.name}
                  onChange={(event) => setInstitutionField('name', event.target.value)}
                  required
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="institution-logo">
                <Form.Label>{t('pages.institution.fields.logo')}</Form.Label>
                <Form.Control
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => onLogoSelected(event.target.files?.[0] || null)}
                />
                <Form.Text>{t('pages.institution.logoHelp')}</Form.Text>
              </Form.Group>

              {displayedLogoUrl ? (
                <div className="institution-logo-preview mb-3">
                  <Image src={displayedLogoUrl} alt={t('pages.institution.fields.logo')} fluid />
                </div>
              ) : null}

              {form.logo || selectedLogo ? (
                <Button type="button" variant="outline-danger" size="sm" onClick={onRemoveLogo}>
                  <i className="fa-solid fa-trash me-2" aria-hidden="true" />
                  {t('pages.institution.actions.removeLogo')}
                </Button>
              ) : null}
            </Col>

            <Col lg={5}>
              {CONTACT_TYPES.map((contactType) => (
                <Card key={contactType} className="mb-3">
                  <Card.Body>
                    <Card.Title className="h6">{t(`pages.institution.contacts.${contactType}`)}</Card.Title>
                    <Row className="g-2">
                      <Col md={6}>
                        <Form.Label>{t('pages.institution.fields.firstname')}</Form.Label>
                        <Form.Control
                          value={form.contacts[contactType].firstname}
                          onChange={(event) => setContactField(contactType, 'firstname', event.target.value)}
                        />
                      </Col>
                      <Col md={6}>
                        <Form.Label>{t('pages.institution.fields.lastname')}</Form.Label>
                        <Form.Control
                          value={form.contacts[contactType].lastname}
                          onChange={(event) => setContactField(contactType, 'lastname', event.target.value)}
                        />
                      </Col>
                      <Col md={12}>
                        <Form.Label>{t('pages.institution.fields.email')}</Form.Label>
                        <Form.Control
                          type="email"
                          value={form.contacts[contactType].email}
                          onChange={(event) => setContactField(contactType, 'email', event.target.value)}
                        />
                      </Col>
                      <Col md={4}>
                        <Form.Label>{t('pages.institution.fields.phoneCountryCode')}</Form.Label>
                        <Form.Control
                          value={form.contacts[contactType].phoneCountryCode}
                          onChange={(event) => setContactField(contactType, 'phoneCountryCode', event.target.value)}
                          placeholder="+56"
                        />
                      </Col>
                      <Col md={8}>
                        <Form.Label>{t('pages.institution.fields.phoneNumber')}</Form.Label>
                        <Form.Control
                          value={form.contacts[contactType].phoneNumber}
                          onChange={(event) => setContactField(contactType, 'phoneNumber', event.target.value)}
                          placeholder="912345678"
                        />
                      </Col>
                    </Row>
                  </Card.Body>
                </Card>
              ))}
            </Col>
          </Row>

          <div className="mt-3">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Spinner size="sm" className="me-2" />
              ) : (
                <i className="fa-solid fa-floppy-disk me-2" aria-hidden="true" />
              )}
              {t('pages.institution.actions.save')}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
}

export default InstitutionPage;
