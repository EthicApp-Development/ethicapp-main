-- Public Google documents attached to a case (#792, epic #789), as complementary
-- material next to its videos.
--
-- A row holds only the case, the document's place in the case's list and the
-- parts EthicApp rebuilds its opening URL from (#790): how it is shared (kind),
-- the Google product, the file or published id and, for some older Drive
-- links, a resource key. No Google metadata is stored: EthicApp checks the
-- name and availability lazily and caches them in the cache Redis with a TTL.
--
-- kind is drive_file (a link-shared Drive file) or published (a document
-- published to the web). product is document, spreadsheets, presentation or
-- file (any other Drive file). A published document has a Docs, Sheets or
-- Slides product, which is part of its URL, and never a resource key.
--
-- position starts at 1 and is unique per case, so the list has one order. A
-- document appears once per case. Rows go with their case.

CREATE TABLE IF NOT EXISTS ethical_case_documents (
    id bigserial PRIMARY KEY,
    case_id integer NOT NULL REFERENCES ethical_cases (id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    kind text NOT NULL CHECK (kind IN ('drive_file', 'published')),
    product text NOT NULL CHECK (
        product IN ('document', 'spreadsheets', 'presentation', 'file')
    ),
    external_id text NOT NULL,
    resource_key text CHECK (resource_key ~ '^[A-Za-z0-9_-]{1,128}$'),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT ethical_case_documents_external_id_check CHECK (
        (kind = 'drive_file' AND external_id ~ '^[A-Za-z0-9_-]{20,128}$')
        OR (kind = 'published' AND external_id ~ '^2PACX-[A-Za-z0-9_-]{20,200}$')
    ),
    CONSTRAINT ethical_case_documents_published_check CHECK (
        kind <> 'published' OR (resource_key IS NULL AND product <> 'file')
    ),
    CONSTRAINT ethical_case_documents_case_document_key UNIQUE (case_id, kind, external_id),
    CONSTRAINT ethical_case_documents_case_position_key UNIQUE (case_id, position)
);
