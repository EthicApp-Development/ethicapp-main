CREATE TABLE IF NOT EXISTS tag_taxonomies (
    code varchar(80) PRIMARY KEY,
    schema_version varchar(40) NOT NULL DEFAULT 'tag-taxonomy/v1',
    version varchar(40) NOT NULL,
    name text,
    description text,
    source text,
    generated_with text,
    reviewed_by text,
    reviewed_at timestamp without time zone,
    curation_notes text,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    CONSTRAINT tag_taxonomies_schema_version_check
        CHECK (schema_version = 'tag-taxonomy/v1')
);

CREATE TABLE IF NOT EXISTS tag_categories (
    id serial PRIMARY KEY,
    taxonomy_code varchar(80) NOT NULL REFERENCES tag_taxonomies(code) ON DELETE CASCADE,
    code varchar(120) NOT NULL,
    usable_for_cases boolean NOT NULL DEFAULT false,
    usable_for_designs boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    UNIQUE (taxonomy_code, code),
    CONSTRAINT tag_categories_scope_check
        CHECK (
            (usable_for_cases = true OR usable_for_designs = true)
            AND (usable_for_cases = false OR usable_for_designs = true)
        )
);

CREATE TABLE IF NOT EXISTS tag_category_translations (
    category_id integer NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
    locale varchar(10) NOT NULL REFERENCES languages(code),
    label text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (category_id, locale)
);

CREATE TABLE IF NOT EXISTS tags (
    id serial PRIMARY KEY,
    category_id integer NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
    code varchar(120) NOT NULL,
    usable_for_cases boolean NOT NULL DEFAULT false,
    usable_for_designs boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    UNIQUE (category_id, code),
    UNIQUE (code),
    CONSTRAINT tags_scope_check
        CHECK (
            (usable_for_cases = true OR usable_for_designs = true)
            AND (usable_for_cases = false OR usable_for_designs = true)
        )
);

CREATE TABLE IF NOT EXISTS tag_translations (
    tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    locale varchar(10) NOT NULL REFERENCES languages(code),
    label text NOT NULL,
    description text,
    search_keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (tag_id, locale)
);

CREATE TABLE IF NOT EXISTS tag_aliases (
    tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    alias_code varchar(120) NOT NULL,
    created_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (tag_id, alias_code)
);

CREATE TABLE IF NOT EXISTS ethical_cases_tags (
    case_id integer NOT NULL REFERENCES ethical_cases(id) ON DELETE CASCADE,
    tag_id integer NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
    assigned_by integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (case_id, tag_id)
);

CREATE TABLE IF NOT EXISTS designs_tags (
    design_id integer NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    tag_id integer NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
    assigned_by integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (design_id, tag_id)
);

CREATE OR REPLACE FUNCTION enforce_tag_category_scope()
RETURNS trigger AS $$
DECLARE
    category_scope record;
BEGIN
    SELECT usable_for_cases, usable_for_designs
    INTO category_scope
    FROM tag_categories
    WHERE id = NEW.category_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tag category % does not exist.', NEW.category_id;
    END IF;

    IF NEW.usable_for_cases = true AND category_scope.usable_for_cases <> true THEN
        RAISE EXCEPTION 'Tag % cannot be usable for cases when its category is not.', NEW.code;
    END IF;

    IF NEW.usable_for_designs = true AND category_scope.usable_for_designs <> true THEN
        RAISE EXCEPTION 'Tag % cannot be usable for designs when its category is not.', NEW.code;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_category_scope_narrowing()
RETURNS trigger AS $$
BEGIN
    IF NEW.usable_for_cases = false AND EXISTS (
        SELECT 1 FROM tags
        WHERE category_id = NEW.id
          AND usable_for_cases = true
    ) THEN
        RAISE EXCEPTION 'Category % cannot stop being usable for cases while it has case tags.', NEW.code;
    END IF;

    IF NEW.usable_for_designs = false AND EXISTS (
        SELECT 1 FROM tags
        WHERE category_id = NEW.id
          AND usable_for_designs = true
    ) THEN
        RAISE EXCEPTION 'Category % cannot stop being usable for designs while it has design tags.', NEW.code;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_case_tag_scope()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM tags
        WHERE id = NEW.tag_id
          AND usable_for_cases = true
          AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Tag % is not active or usable for ethical cases.', NEW.tag_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_design_tag_scope()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM tags
        WHERE id = NEW.tag_id
          AND usable_for_designs = true
          AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Tag % is not active or usable for designs.', NEW.tag_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tags_enforce_category_scope ON tags;
CREATE TRIGGER tags_enforce_category_scope
BEFORE INSERT OR UPDATE OF category_id, usable_for_cases, usable_for_designs
ON tags
FOR EACH ROW
EXECUTE FUNCTION enforce_tag_category_scope();

DROP TRIGGER IF EXISTS tag_categories_prevent_scope_narrowing ON tag_categories;
CREATE TRIGGER tag_categories_prevent_scope_narrowing
BEFORE UPDATE OF usable_for_cases, usable_for_designs
ON tag_categories
FOR EACH ROW
EXECUTE FUNCTION prevent_category_scope_narrowing();

DROP TRIGGER IF EXISTS ethical_cases_tags_enforce_scope ON ethical_cases_tags;
CREATE TRIGGER ethical_cases_tags_enforce_scope
BEFORE INSERT OR UPDATE OF tag_id
ON ethical_cases_tags
FOR EACH ROW
EXECUTE FUNCTION enforce_case_tag_scope();

DROP TRIGGER IF EXISTS designs_tags_enforce_scope ON designs_tags;
CREATE TRIGGER designs_tags_enforce_scope
BEFORE INSERT OR UPDATE OF tag_id
ON designs_tags
FOR EACH ROW
EXECUTE FUNCTION enforce_design_tag_scope();

CREATE INDEX IF NOT EXISTS idx_tag_categories_taxonomy_code
    ON tag_categories (taxonomy_code);

CREATE INDEX IF NOT EXISTS idx_tag_categories_scope
    ON tag_categories (usable_for_cases, usable_for_designs, is_active);

CREATE INDEX IF NOT EXISTS idx_tag_category_translations_locale
    ON tag_category_translations (locale);

CREATE INDEX IF NOT EXISTS idx_tags_category_id
    ON tags (category_id);

CREATE INDEX IF NOT EXISTS idx_tags_scope
    ON tags (usable_for_cases, usable_for_designs, is_active);

CREATE INDEX IF NOT EXISTS idx_tag_translations_locale
    ON tag_translations (locale);

CREATE INDEX IF NOT EXISTS idx_tag_translations_search_keywords
    ON tag_translations USING gin (search_keywords);

CREATE INDEX IF NOT EXISTS idx_ethical_cases_tags_tag_id
    ON ethical_cases_tags (tag_id);

CREATE INDEX IF NOT EXISTS idx_designs_tags_tag_id
    ON designs_tags (tag_id);
