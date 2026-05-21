import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Pagination,
  Row,
  Spinner,
  Table
} from 'react-bootstrap';
import { Link } from 'react-router-dom';

import { useI18n } from '../app/providers.jsx';
import { fetchUsers } from '../api/usersApi.js';

const roleOptions = ['', 'P', 'A', 'S'];

function UsersPage() {
  const { t } = useI18n();
  const roleLabel = (roleCode) => {
    const translationKey = `roles.${roleCode}`;
    const translation = t(translationKey);
    return translation === translationKey ? roleCode : translation;
  };

  const [keywordsInput, setKeywordsInput] = useState('');
  const [roleInput, setRoleInput] = useState('');

  const [keywordsFilter, setKeywordsFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);

  const [usersResponse, setUsersResponse] = useState({
    items: [],
    page: 1,
    totalPages: 1,
    total: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      setLoading(true);
      setError('');

      try {
        const result = await fetchUsers({
          keywords: keywordsFilter,
          role: roleFilter,
          page
        });

        if (isMounted) {
          setUsersResponse(result);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || 'Unexpected error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      isMounted = false;
    };
  }, [keywordsFilter, roleFilter, page]);

  const paginationItems = useMemo(() => {
    const items = [];

    for (let currentPage = 1; currentPage <= usersResponse.totalPages; currentPage += 1) {
      items.push(
        <Pagination.Item
          key={currentPage}
          active={currentPage === usersResponse.page}
          onClick={() => setPage(currentPage)}
        >
          {currentPage}
        </Pagination.Item>
      );
    }

    return items;
  }, [usersResponse.page, usersResponse.totalPages]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setKeywordsFilter(keywordsInput.trim());
    setRoleFilter(roleInput);
    setPage(1);
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title className="d-flex align-items-center gap-2">
          <i className="fa-solid fa-user-gear text-primary" aria-hidden="true" />
          <span>{t('pages.users.heading')}</span>
        </Card.Title>
        <Card.Text>{t('pages.users.description')}</Card.Text>

        <Form onSubmit={handleSubmit} className="mb-3">
          <Row className="g-2 align-items-end">
            <Col md={7}>
              <Form.Group controlId="users-keywords">
                <Form.Label>{t('filters.search')}</Form.Label>
                <Form.Control
                  value={keywordsInput}
                  onChange={(event) => setKeywordsInput(event.target.value)}
                  placeholder={t('filters.keywords')}
                />
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group controlId="users-role">
                <Form.Label>{t('filters.role')}</Form.Label>
                <Form.Select value={roleInput} onChange={(event) => setRoleInput(event.target.value)}>
                  <option value="">{t('filters.allRoles')}</option>
                  {roleOptions
                    .filter((roleCode) => roleCode)
                    .map((roleCode) => (
                      <option key={roleCode} value={roleCode}>
                        {t(`roles.${roleCode}`)}
                      </option>
                    ))}
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={2}>
              <Button type="submit" className="w-100 d-inline-flex align-items-center justify-content-center">
                <i className="fa-solid fa-magnifying-glass me-2" aria-hidden="true" />
                {t('filters.search')}
              </Button>
            </Col>
          </Row>
        </Form>

        {error && <Alert variant="danger">{error}</Alert>}

        {loading ? (
          <div className="d-flex align-items-center gap-2">
            <Spinner size="sm" />
            <span>{t('filters.search')}...</span>
          </div>
        ) : (
          <>
            <Table striped hover responsive>
              <thead>
                <tr>
                  <th>{t('pages.users.columns.firstname')}</th>
                  <th>{t('pages.users.columns.lastname')}</th>
                  <th>{t('pages.users.columns.email')}</th>
                  <th>{t('pages.users.columns.role')}</th>
                  <th>{t('pages.users.columns.status')}</th>
                  <th>{t('pages.users.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {usersResponse.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-secondary">
                      {t('pages.users.empty')}
                    </td>
                  </tr>
                ) : (
                  usersResponse.items.map((user) => (
                    <tr key={user.id}>
                      <td>{user.firstname}</td>
                      <td>{user.lastname}</td>
                      <td>{user.email}</td>
                      <td>{roleLabel(user.role)}</td>
                      <td>
                        {!user.emailConfirmed ? (
                          <span className="badge text-bg-warning">{t('pages.users.status.pending')}</span>
                        ) : user.active ? (
                          <span className="badge text-bg-success">{t('pages.users.status.active')}</span>
                        ) : (
                          <span className="badge text-bg-secondary">{t('pages.users.status.inactive')}</span>
                        )}
                      </td>
                      <td>
                        <Button as={Link} to={`/users/${user.id}`} size="sm" variant="outline-secondary">
                          <i className="fa-solid fa-eye me-2" aria-hidden="true" />
                          {t('pages.users.actions.view')}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <small className="text-secondary">
                {t('pages.users.pagination', {
                  page: usersResponse.page,
                  totalPages: usersResponse.totalPages,
                  total: usersResponse.total
                })}
              </small>

              <Pagination className="mb-0">
                <Pagination.Prev
                  disabled={usersResponse.page <= 1}
                  onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
                />
                {paginationItems}
                <Pagination.Next
                  disabled={usersResponse.page >= usersResponse.totalPages}
                  onClick={() =>
                    setPage((currentPage) => Math.min(currentPage + 1, usersResponse.totalPages))
                  }
                />
              </Pagination>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

export default UsersPage;
