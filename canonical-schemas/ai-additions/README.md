# Contracts Owned by ethicapp-ai-additions

The files in this folder are verbatim copies of contracts that
[ethicapp-ai-additions](https://github.com/EthicApp-Development/ethicapp-ai-additions)
defines. EthicApp validates against them and documents them, but never edits
them here: the copy changes only to match the source.

| Copy | Source in ethicapp-ai-additions |
| --- | --- |
| `student-result.v1.schema.json` | `shared/schemas/student-result.v1.schema.json` |
| `examples/student-result.v1/*.json` | `shared/schemas/examples/student-result.v1/*.json` |

Copied from commit
[`3b292d1`](https://github.com/EthicApp-Development/ethicapp-ai-additions/commit/3b292d1)
byte for byte. The schema comes from ethicapp-ai-additions PR #234 (issue
#232); the tutor examples were regenerated from the tutor's own output by PR
#235 (issue #233). The folder keeps
the layout of the source's `shared/schemas/`, so the examples sit next to the
schema as they do there.

The schema defines `student-result/v1`, the document an AI service publishes
to show a result to one student (epic #1124). Its semantics are explained in
the "Student Result Document" section of the ethicapp-ai-additions
`README.md`, and EthicApp's side of the contract in [`EXTERNAL.md`](../../EXTERNAL.md),
"Student result documents".

## Changing the contract

Both copies change together, ethicapp-ai-additions first:

1. Change the schema and its examples in ethicapp-ai-additions, with its
   README, its Python package copy and its tests, and merge that change to its
   `main`.
2. In ethicapp-main, replace the files of this folder with the ones at that
   commit, as described below.
3. Update the commit in this README, the tests in
   `canonical-schemas/__tests__/student-result-v1.schema.node-test.mjs` when
   the change adds a rule, and `EXTERNAL.md` when it changes what the document
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

git -C "$AI" fetch origin
rm -f "$DEST"/examples/student-result.v1/*.json
for f in $(git -C "$AI" ls-tree -r --name-only "$COMMIT" \
    shared/schemas/student-result.v1.schema.json \
    shared/schemas/examples/student-result.v1); do
  git -C "$AI" show "$COMMIT:$f" > "$DEST/${f#shared/schemas/}"
done
```

Reading the files from the commit leaves out local changes in the
ethicapp-ai-additions checkout, and removing the examples first drops any
that the source deleted.

Then check that every copy matches its source and run the tests:

```sh
for f in $(git -C "$AI" ls-tree -r --name-only "$COMMIT" \
    shared/schemas/student-result.v1.schema.json \
    shared/schemas/examples/student-result.v1); do
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
