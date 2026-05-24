# EthicApp Canonical Schemas

This directory currently contains JSON Schemas for portable EthicApp objects.

- `ethicapp-v1.schema.json`: legacy activity design schema.
- `case-document-representation-v1.schema.json`: canonical representation of an ethical case document as metadata, source-format metadata, text content, and an ordered rendered-image sequence.
- `tag-taxonomy-v1.schema.json`: portable controlled taxonomy for semantic tags used by ethical cases and activity designs, including domain-specific translations outside UI locale catalogs.

## Tag Taxonomy Notes

`tag-taxonomy-v1.schema.json` is meant for curated or AI-assisted taxonomy generation before loading tags into the database. It keeps tag labels, descriptions, and localized search keywords in the taxonomy payload itself, avoiding pollution of frontend UI translation files.

The scope rule is intentional: any category or tag usable for ethical cases must also be usable for designs, because design tags are a superset of case tags. Design-only tags are allowed for pedagogical, interaction, assessment, or participation concepts that do not describe case content directly.
