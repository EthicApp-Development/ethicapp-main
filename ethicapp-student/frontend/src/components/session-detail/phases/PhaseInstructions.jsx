import RichText from '../../common/RichText.jsx';
import { phaseInstructions } from '../../../utils/phaseInstructions.js';

// The phase's instructions above its tasks (#766). The label sits on its own
// line, so lists and paragraphs render as blocks.
export default function PhaseInstructions({ phase, t }) {
  const { text, contentType } = phaseInstructions(phase);
  if (text.trim().length === 0) {
    return null;
  }

  return (
    <div className="alert alert-secondary mb-0 phase-instructions" role="note">
      <strong className="d-block mb-1">{t('sessionDetail.instructionsLabel')}</strong>
      <RichText text={text} contentType={contentType} />
    </div>
  );
}
