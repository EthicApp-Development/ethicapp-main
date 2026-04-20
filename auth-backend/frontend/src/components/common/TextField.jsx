import PropTypes from 'prop-types';

function TextField({
  id,
  name,
  label,
  type,
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
  autoFocus,
  required
}) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="form-label">
        {label}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        className={`form-control ${error ? 'is-invalid' : ''}`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
      />

      {error ? <div className="invalid-feedback">{error}</div> : null}
    </div>
  );
}

TextField.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  type: PropTypes.string,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.string,
  placeholder: PropTypes.string,
  autoComplete: PropTypes.string,
  autoFocus: PropTypes.bool,
  required: PropTypes.bool
};

TextField.defaultProps = {
  type: 'text',
  error: '',
  placeholder: '',
  autoComplete: 'off',
  autoFocus: false,
  required: false
};

export default TextField;