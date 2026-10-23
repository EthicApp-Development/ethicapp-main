// Content types of teacher-written texts: canonical-schemas/rich-text/README.md.
const TEXT_PLAIN = 'text/plain';

/**
 * The instructions a phase shows (#766), with their content type. The design's
 * instructions win; otherwise the legacy phase question is used, which is
 * always text/plain. Missing content types are text/plain.
 * @returns {{ text: string, contentType: string }}
 */
export function phaseInstructions(phase) {
  if (typeof phase?.instructions === 'string' && phase.instructions.trim().length > 0) {
    return { text: phase.instructions, contentType: phase.instructionsContentType || TEXT_PLAIN };
  }
  return { text: typeof phase?.question === 'string' ? phase.question : '', contentType: TEXT_PLAIN };
}
