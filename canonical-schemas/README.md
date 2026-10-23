# EthicApp Canonical Schemas

This directory currently contains JSON Schemas for portable EthicApp objects.

- `ethicapp-v1.schema.json`: legacy activity design schema.
- `case-document-representation-v1.schema.json`: canonical representation of an ethical case document as metadata, source-format metadata, text content, and an ordered rendered-image sequence.
- `rich-text/`: how teacher-written texts (phase instructions and semantic differential questions) are interpreted. It holds the content types, the CommonMark subset, the normalized tree renderers produce, and shared conformance fixtures. See [`rich-text/README.md`](rich-text/README.md).
- `events/`: domain-event envelope and per-event payload contracts for one-way notifications between services over the application Redis. See [`events/README.md`](events/README.md).
- `tag-taxonomy-v1.schema.json`: portable controlled taxonomy for semantic tags used by ethical cases and activity designs, including domain-specific translations outside UI locale catalogs.

## Tests

`npm run test:schemas` (repository root) validates documents against these schemas. `__tests__/ethicapp-v1.schema.node-test.mjs` checks every canonical seed design in `database/seeds/canonical-activities/manifest.json`, plus the external service `configurations` rules and the text content types. `__tests__/rich-text.node-test.mjs` checks that the rich text fixtures are well formed and normalized, and that their trees match `rich-text/rich-text-tree-v1.schema.json`. Run them whenever a schema, a seed or a fixture changes.

## Design Notes

- **External service configurations (#729).** `phases[].externalServices.configurations` maps each external service manifest id to that phase's settings: an object whose keys are capability descriptor field keys and whose values are scalars (string, number, boolean or null). A configuration for a service that is not in `enabledServiceIds` is kept but ignored, so turning a service off and on keeps the teacher's values. Designs with only `enabledServiceIds`, or without `externalServices`, stay valid.
- **Text content types (#762).** `phases[].instructionsContentType` and `phases[].questions[].q_text_content_type` are `text/plain` or `text/markdown`. A missing value means `text/plain`, so every existing design keeps rendering its text as written. See [`rich-text/README.md`](rich-text/README.md).
- **`grouping_algorithm`** is `"random"` for grouped phases and `null` where the editor does not group, such as individual phases.

## Tag Taxonomy Notes

`tag-taxonomy-v1.schema.json` is meant for curated or AI-assisted taxonomy generation before loading tags into the database. It keeps tag labels, descriptions, and localized search keywords in the taxonomy payload itself, avoiding pollution of frontend UI translation files.

The scope rule is intentional: any category or tag usable for ethical cases must also be usable for designs, because design tags are a superset of case tags. Design-only tags are allowed for pedagogical, interaction, assessment, or participation concepts that do not describe case content directly.
