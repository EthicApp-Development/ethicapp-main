# Contracts Owned by ethicapp-ai-additions

The files in this folder are verbatim copies of contracts that
[ethicapp-ai-additions](https://github.com/EthicApp-Development/ethicapp-ai-additions)
defines. EthicApp validates against them and documents them, but never edits
them here: the copy changes only to match the source.

| Copy | Source in ethicapp-ai-additions |
| --- | --- |
| `student-result.v1.schema.json` | `shared/schemas/student-result.v1.schema.json` |
| `examples/student-result.v1/*.json` | `shared/schemas/examples/student-result.v1/*.json` |
| `argument-evaluation.v1.schema.json` | `shared/schemas/argument-evaluation.v1.schema.json` |
| `examples/argument-evaluation.v1/*.json` | `shared/schemas/examples/argument-evaluation.v1/*.json` |

Every file was compared byte for byte with commit
[`c4a573a`](https://github.com/EthicApp-Development/ethicapp-ai-additions/commit/c4a573a).
The `student-result/v1` schema comes from ethicapp-ai-additions PR #234
(issue #232), and its tutor examples were regenerated from the tutor's own
output by PR #235 (issue #233); they are unchanged since commit `3b292d1`.
The `argument-evaluation/v1` schema and its examples come from PR #280
(issue #268) and were copied for #1214. The folder keeps the layout of the
source's `shared/schemas/`, so the examples sit next to their schema as they
do there.

`student-result/v1` is the document an AI service publishes to show a result
to one student (epic #1124). Its semantics are explained in the "Student
Result Document" section of the ethicapp-ai-additions `README.md`, and
EthicApp's side of the contract in [`EXTERNAL.md`](../../EXTERNAL.md),
"Student result documents".

`argument-evaluation/v1` is the Argumentation Tutor's evaluation of an
argument with the coders' Toulmin rubric (prompt v19, epic
ethicapp-ai-additions#267): the levels Claim 0–2, Evidence 0–2, Warrant 0–2
and Qualifier 0–1, each with its scale, for one argument (`kind: analysis`)
or for an argument and its revision (`kind: comparison`). The tutor sends it
as `argumentEvaluation` in its callback payload. It is teacher-facing data:
its `AF#`, `EV#` and `EX#` ids, fragments and reasons never reach a student.
Its semantics are explained in the "Argument Evaluation Contract" section of
the ethicapp-ai-additions `README.md`, and how the tutor adapter reads it in
`ethicapp/backend/external-services/README.md`, "The tutor's rubrics".

## Changing the contract

Both copies change together, ethicapp-ai-additions first:

1. Change the schema and its examples in ethicapp-ai-additions, with its
   README, its Python package copy and its tests, and merge that change to its
   `main`.
2. In ethicapp-main, replace the files of this folder with the ones at that
   commit, as described below.
3. Update the commit in this README, the tests in
   `canonical-schemas/__tests__/` (`student-result-v1.schema.node-test.mjs`,
   `argument-evaluation-v1.schema.node-test.mjs`) when the change adds a rule, and `EXTERNAL.md` when it changes what the document
   means. The student app's renderer and EthicApp's validation follow in the
   same pull request or before any service emits the new form.
4. Record the `shasum` comparison of step 2 in the pull request, since the
   source repository is not available in CI.

A service never emits a document that the copy here rejects. Any addition
other than a new section kind is therefore released in EthicApp before the
service that uses it. A change that makes a valid v1 document invalid is a
new schema, `student-result/v2`, copied next to v1 while services still emit
v1.

## Updating the copy

From the root of ethicapp-main, with ethicapp-ai-additions cloned next to it
and `COMMIT` set to the merged commit:

```sh
AI=../ethicapp-ai-additions
COMMIT=<commit>
DEST=canonical-schemas/ai-additions

CONTRACTS="shared/schemas/student-result.v1.schema.json
  shared/schemas/examples/student-result.v1
  shared/schemas/argument-evaluation.v1.schema.json
  shared/schemas/examples/argument-evaluation.v1"

git -C "$AI" fetch origin
rm -f "$DEST"/examples/student-result.v1/*.json \
  "$DEST"/examples/argument-evaluation.v1/*.json
for f in $(git -C "$AI" ls-tree -r --name-only "$COMMIT" $CONTRACTS); do
  mkdir -p "$(dirname "$DEST/${f#shared/schemas/}")"
  git -C "$AI" show "$COMMIT:$f" > "$DEST/${f#shared/schemas/}"
done
```

Reading the files from the commit leaves out local changes in the
ethicapp-ai-additions checkout, and removing the examples first drops any
that the source deleted.

Then check that every copy matches its source and run the tests:

```sh
for f in $(git -C "$AI" ls-tree -r --name-only "$COMMIT" $CONTRACTS); do
  src=$(git -C "$AI" show "$COMMIT:$f" | shasum -a 256 | cut -d' ' -f1)
  dst=$(shasum -a 256 "$DEST/${f#shared/schemas/}" | cut -d' ' -f1)
  [ "$src" = "$dst" ] && echo "same     $dst  ${f#shared/schemas/}" \
    || echo "DIFFERS  ${f#shared/schemas/}"
done
npm run test:schemas
```

## Tests

`canonical-schemas/__tests__/student-result-v1.schema.node-test.mjs`, run by
`npm run test:schemas`, validates every example against the copy with
`@cfworker/json-schema` (draft 2020-12), checks the `$id` and the
`schemaVersion` constant, rejects malformed documents and accepts a section of
an unknown kind. The schema's two integrity rules that JSON Schema cannot
express (unique criterion keys within a section, scores within their bounds)
are outside those tests. ethicapp-ai-additions checks them with
`ethicapp_ai_capabilities.validate_student_result()`, and the EthicApp backend
with the same problem codes (`duplicate_criterion_key`, `score_out_of_range`)
in `ethicapp/backend/services/student-result-documents.js` (#1131), which
validates every document published or rebuilt for a student against this
copy.

`canonical-schemas/__tests__/argument-evaluation-v1.schema.node-test.mjs`
validates every `argument-evaluation/v1` example against its copy the same
way, checks that each level lies within the scale the document gives it, and
rejects malformed documents: an analysis without its evaluation, a comparison
without its differences, a level outside its scale, an id outside its
pattern, an undefined key. The integrity rules outside JSON Schema (the
entry rule, the evidence level from the facts, the computed differences) are
checked by ethicapp-ai-additions with
`ethicapp_ai_capabilities.validate_argument_evaluation()`. EthicApp reads the
documents leniently, criterion by criterion
(`ethicapp/backend/external-services/adapters/ats-feedback.evaluation.js`),
because a forgotten student's stored payloads have their strings redacted
(V31), and does not validate them against this copy at runtime.
