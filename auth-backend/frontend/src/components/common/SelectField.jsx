import PropTypes from 'prop-types';

function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  options,
  placeholder,
  required
}) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="form-label">
        {label}
      </label>

      <select
        id={id}
        name={name}
        className={`form-select ${error ? 'is-invalid' : ''}`}
        value={value}
        onChange={onChange}
        required={required}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error ? <div className="invalid-feedback">{error}</div> : null}
    </div>
  );
}

SelectField.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.string,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired
    })
  ).isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool
};

SelectField.defaultProps = {
  error: '',
  placeholder: 'Selecciona una opción',
  required: false
};

export default SelectField;