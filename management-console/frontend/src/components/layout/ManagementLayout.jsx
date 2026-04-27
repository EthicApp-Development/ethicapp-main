import PropTypes from 'prop-types';
import { Container, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../app/providers.jsx';

function ManagementLayout({ children }) {
  const { t } = useI18n();
  const location = useLocation();

  return (
    <div className="min-vh-100 bg-light">
      <Navbar bg="dark" data-bs-theme="dark" expand="lg">
        <Container>
          <Navbar.Brand as={Link} to="/users">
            {t('app.title')}
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="mng-nav" />
          <Navbar.Collapse id="mng-nav">
            <Nav className="me-auto" activeKey={location.pathname}>
              <Nav.Link as={Link} to="/users" eventKey="/users">
                {t('nav.users')}
              </Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container className="py-4">
        <p className="text-secondary mb-4">{t('app.subtitle')}</p>
        {children}
      </Container>
    </div>
  );
}

ManagementLayout.propTypes = {
  children: PropTypes.node.isRequired
};

export default ManagementLayout;
