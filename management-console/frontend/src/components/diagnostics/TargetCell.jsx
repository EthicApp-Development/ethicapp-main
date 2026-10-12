import PropTypes from 'prop-types';

function TargetCell({ target }) {
  return (
    <>
      <div className="fw-semibold">{target.label}</div>
      <div className="small text-body-secondary text-break">{`${target.host}:${target.port}`}</div>
    </>
  );
}

TargetCell.propTypes = {
  target: PropTypes.shape({
    label: PropTypes.string.isRequired,
    host: PropTypes.string.isRequired,
    port: PropTypes.number.isRequired
  }).isRequired
};

export default TargetCell;
