import PropTypes from 'prop-types';
import { Button, Container, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../app/providers.jsx';

const ETHICAPP_LOGO_SRC = '/images/logos/ethicapp-logo.svg';

function ManagementLayout({ children }) {
  const { t } = useI18n();
  const location = useLocation();

  return (
    <div className="min-vh-100 bg-light">
      <Navbar bg="dark" data-bs-theme="dark" expand="lg">
        <Container>
          <Navbar.Brand>
            <a
              href="https://www.ethicapp.info"
              target="_blank"
              rel="noreferrer"
              className="ethicapp-logo-topbar"
            >
              <img src={ETHICAPP_LOGO_SRC} alt="EthicApp" className="ethicapp-logo-topbar-img" />
            </a>
          </Navbar.Brand>
          <Navbar.Text className="text-muted">{t('app.title')}&nbsp;|&nbsp;</Navbar.Text>
          <Navbar.Toggle aria-controls="mng-nav" />
          <Navbar.Collapse id="mng-nav">
            <Nav className="me-auto" activeKey={location.pathname}>
              <Nav.Link as={Link} to="/users" eventKey="/users">
                <i className="fa-solid fa-users me-2" aria-hidden="true" />
                {t('nav.users')}
              </Nav.Link>
            </Nav>
            <Button
              variant="outline-light"
              size="sm"
              onClick={() => window.location.assign('/logout')}
              className="d-inline-flex align-items-center"
            >
              <i className="fa-solid fa-right-from-bracket me-2" aria-hidden="true" />
              {t('nav.logout')}
            </Button>
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
