# Tag Taxonomy Seeds

Place controlled tag taxonomy JSON files in this directory to load them during
EthicApp startup.

Seed files must follow `canonical-schemas/tag-taxonomy-v1.schema.json`. The
loader accepts any `*.json` file directly inside this directory. When the
directory is empty, startup continues without loading tag content.

Example layout:

```text
database/seeds/tag-taxonomies/
  ethicapp-default.json
```

The loader is idempotent: rerunning it updates existing taxonomies, categories,
tags, translations, and aliases instead of creating duplicates.
