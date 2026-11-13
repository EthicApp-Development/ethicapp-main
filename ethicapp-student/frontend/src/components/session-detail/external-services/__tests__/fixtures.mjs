import { readFileSync } from 'node:fs';

// The student-result/v1 examples in fixtures/student-result.v1/ are verbatim
// copies of ethicapp-ai-additions shared/schemas/examples/student-result.v1/
// at commit 3b292d1 (PR #235), which CI cannot read. Copy them again when the
// contract's examples change.
export function studentResultExample(name) {
  const url = new URL(`./fixtures/student-result.v1/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

export const EXAMPLE_NAMES = [
  'minimal.en_US',
  'tutor-analysis.en_US',
  'tutor-analysis.es_CL',
  'tutor-comparison.en_US',
  'tutor-comparison.es_CL',
  'unknown-section-kind.en_US'
];

// The argument-evaluation/v1 examples in fixtures/argument-evaluation.v1/ are
// verbatim copies of ethicapp-ai-additions
// shared/schemas/examples/argument-evaluation.v1/ at commit c4a573a (PR #280),
// as canonical-schemas/ai-additions/ holds them (#1214).
export function argumentEvaluationExample(name) {
  const url = new URL(`./fixtures/argument-evaluation.v1/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}
