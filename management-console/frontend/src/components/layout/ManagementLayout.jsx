import PropTypes from 'prop-types';
import { useState } from 'react';
import { Button, Container, Nav } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../app/providers.jsx';

const ETHICAPP_LOGO_SRC = '/images/logos/ethicapp-logo.svg';

function ManagementLayout({ children }) {
  const { t } = useI18n();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeNavKey = location.pathname.startsWith('/users') ? '/users' : location.pathname;

  const navItems = [
    {
      to: '/users',
      icon: 'fa-users',
      label: t('nav.users')
    },
    {
      to: '/institution',
      icon: 'fa-building-columns',
      label: t('nav.institution')
    },
    {
      to: '/profile',
      icon: 'fa-user-shield',
      label: t('nav.profile')
    }
  ];

  return (
    <div className={`management-shell ${sidebarCollapsed ? 'management-shell-collapsed' : ''}`}>
      <aside className="management-sidebar">
        <div className="management-sidebar-header">
          <a
            href="https://www.ethicapp.info"
            target="_blank"
            rel="noreferrer"
            className="ethicapp-logo-topbar"
          >
            <img src={ETHICAPP_LOGO_SRC} alt="EthicApp" className="ethicapp-logo-topbar-img" />
          </a>
          <Button
            type="button"
            variant="outline-light"
            size="sm"
            className="management-sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            <i className={`fa-solid ${sidebarCollapsed ? 'fa-angles-right' : 'fa-angles-left'}`} aria-hidden="true" />
          </Button>
        </div>

        <div className="management-sidebar-title">{t('app.title')}</div>

        <Nav className="management-sidebar-nav" activeKey={activeNavKey}>
          {navItems.map((item) => (
            <Nav.Link
              as={Link}
              key={item.to}
              to={item.to}
              eventKey={item.to}
              className="management-sidebar-link"
              title={item.label}
            >
              <i className={`fa-solid ${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
            </Nav.Link>
          ))}
        </Nav>

        <Button
          variant="outline-light"
          size="sm"
          onClick={() => window.location.assign('/logout')}
          className="management-sidebar-logout"
          title={t('nav.logout')}
        >
          <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
          <span>{t('nav.logout')}</span>
        </Button>
      </aside>

      <main className="management-main">
        <Container fluid className="management-main-inner">
          <p className="text-secondary mb-4">{t('app.subtitle')}</p>
          {children}
        </Container>
      </main>
    </div>
  );
}

ManagementLayout.propTypes = {
  children: PropTypes.node.isRequired
};

export default ManagementLayout;
