import PropTypes from 'prop-types';
import logo from '../../assets/logos/ethicapp-logo.svg';
import { Link } from 'react-router-dom';
function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-card-body">
            <header className="auth-header">
              <Link to="https://www.ethicapp.info" target="_blank" className="auth-logo-link">
                <img
                  src={logo}
                  alt="EthicApp"
                  className="auth-logo-img"
                />
              </Link>

              <h1 className="auth-title">{title}</h1>

              {subtitle ? (
                <p className="auth-subtitle">{subtitle}</p>
              ) : null}
            </header>

            {children}

            {footer ? (
              <>
                <hr className="auth-divider" />
                <div className="auth-footer">{footer}</div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

AuthLayout.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  children: PropTypes.node.isRequired,
  footer: PropTypes.node
};

AuthLayout.defaultProps = {
  subtitle: '',
  footer: null
};

export default AuthLayout;