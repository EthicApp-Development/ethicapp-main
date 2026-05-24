import PropTypes from 'prop-types';
import { useState } from 'react';
import { useI18n } from '../../app/i18n-context';

function PasswordField({
  id,
  name,
  label,
  showLabel,
  value,
  onChange,
  error,
  autoComplete,
  helpText,
  required,
  children
}) {
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useI18n();
  const fieldLabel = label || t('passwordField.defaultLabel');
  const visibleButtonLabel = t('passwordField.visibility.hide');
  const hiddenButtonLabel = t('passwordField.visibility.show');
  const buttonLabel = isVisible ? visibleButtonLabel : hiddenButtonLabel;
  const accessibleLabel = `${buttonLabel} ${fieldLabel.toLowerCase()}`;

  return (
    <div className="mb-3">
      {showLabel ? (
        <label htmlFor={id} className="form-label">
          {fieldLabel}
        </label>
      ) : null}

      <div className="input-group">
        <input
          id={id}
          name={name}
          type={isVisible ? 'text' : 'password'}
          className={`form-control ${error ? 'is-invalid' : ''}`}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required={required}
        />

        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={accessibleLabel}
        >
          {buttonLabel}
        </button>
      </div>

      {error ? <div className="invalid-feedback d-block">{error}</div> : null}
      {helpText ? <div className="auth-form-text mt-2">{helpText}</div> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

PasswordField.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  label: PropTypes.string,
  showLabel: PropTypes.bool,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.string,
  autoComplete: PropTypes.string,
  helpText: PropTypes.string,
  required: PropTypes.bool,
  children: PropTypes.node
};

PasswordField.defaultProps = {
  label: '',
  showLabel: true,
  error: '',
  autoComplete: 'current-password',
  helpText: '',
  required: false,
  children: null
};

export default PasswordField;
