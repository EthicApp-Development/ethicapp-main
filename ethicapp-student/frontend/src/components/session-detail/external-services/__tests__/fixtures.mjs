import { readFileSync } from 'node:fs';

// The student-result/v1 examples in fixtures/student-result.v1/ are verbatim
// copies of ethicapp-ai-additions shared/schemas/examples/student-result.v1/
// at commit ce32b4e (PR #234), which CI cannot read. Copy them again when the
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
