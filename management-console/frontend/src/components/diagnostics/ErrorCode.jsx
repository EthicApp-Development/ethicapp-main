import PropTypes from 'prop-types';

import { useI18n } from '../../app/providers.jsx';

// Shows a backend error code together with a short operator hint when the
// code is one of the documented ones.
function ErrorCode({ code }) {
  const { t } = useI18n();

  if (!code) {
    return null;
  }

  const hintKey = `pages.diagnostics.errorHints.${code}`;
  const hint = t(hintKey);

  return (
    <div className="small">
      <code>{code}</code>
      {hint !== hintKey ? <div className="text-body-secondary">{hint}</div> : null}
    </div>
  );
}

ErrorCode.propTypes = {
  code: PropTypes.string
};

export default ErrorCode;
