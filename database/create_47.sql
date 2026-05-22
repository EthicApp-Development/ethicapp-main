CREATE TABLE IF NOT EXISTS licenses (
    code varchar(30) PRIMARY KEY,
    name text NOT NULL,
    url text,
    allows_derivatives boolean DEFAULT true,
    requires_attribution boolean DEFAULT true,
    share_alike boolean DEFAULT false,
    non_commercial boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS languages (
    code varchar(10) PRIMARY KEY,
    name text NOT NULL,
    native_name text NOT NULL,
    sort_order integer DEFAULT 0
);

INSERT INTO languages (code, name, native_name, sort_order)
VALUES
    ('es_AR', 'Spanish (Argentina)', 'Español (Argentina)', 10),
    ('es_BO', 'Spanish (Bolivia)', 'Español (Bolivia)', 20),
    ('es_CL', 'Spanish (Chile)', 'Español (Chile)', 30),
    ('es_CO', 'Spanish (Colombia)', 'Español (Colombia)', 40),
    ('es_CR', 'Spanish (Costa Rica)', 'Español (Costa Rica)', 50),
    ('es_CU', 'Spanish (Cuba)', 'Español (Cuba)', 60),
    ('es_DO', 'Spanish (Dominican Republic)', 'Español (República Dominicana)', 70),
    ('es_EC', 'Spanish (Ecuador)', 'Español (Ecuador)', 80),
    ('es_SV', 'Spanish (El Salvador)', 'Español (El Salvador)', 90),
    ('es_GT', 'Spanish (Guatemala)', 'Español (Guatemala)', 100),
    ('es_HN', 'Spanish (Honduras)', 'Español (Honduras)', 110),
    ('es_MX', 'Spanish (Mexico)', 'Español (México)', 120),
    ('es_NI', 'Spanish (Nicaragua)', 'Español (Nicaragua)', 130),
    ('es_PA', 'Spanish (Panama)', 'Español (Panamá)', 140),
    ('es_PY', 'Spanish (Paraguay)', 'Español (Paraguay)', 150),
    ('es_PE', 'Spanish (Peru)', 'Español (Perú)', 160),
    ('es_PR', 'Spanish (Puerto Rico)', 'Español (Puerto Rico)', 170),
    ('es_ES', 'Spanish (Spain)', 'Español (España)', 180),
    ('es_UY', 'Spanish (Uruguay)', 'Español (Uruguay)', 190),
    ('es_VE', 'Spanish (Venezuela)', 'Español (Venezuela)', 200),
    ('en_US', 'English (United States)', 'English (United States)', 300),
    ('en_GB', 'English (United Kingdom)', 'English (United Kingdom)', 310),
    ('en_AU', 'English (Australia)', 'English (Australia)', 320),
    ('en_NZ', 'English (New Zealand)', 'English (New Zealand)', 330)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    native_name = EXCLUDED.native_name,
    sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS ethical_case_author (
    id serial PRIMARY KEY,
    author_firstname text NOT NULL,
    author_lastname text NOT NULL,
    author_email text NOT NULL,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ethical_case_author_email_unique
    ON ethical_case_author (LOWER(author_email));

CREATE TABLE IF NOT EXISTS ethical_cases_authors (
    case_id integer NOT NULL REFERENCES ethical_cases(id) ON DELETE CASCADE,
    author_id integer NOT NULL REFERENCES ethical_case_author(id) ON DELETE CASCADE,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    author_order integer NOT NULL DEFAULT 1,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    PRIMARY KEY (case_id, author_id)
);

INSERT INTO licenses (code, name, url, allows_derivatives, requires_attribution, share_alike, non_commercial)
VALUES
    ('CC-BY-4.0', 'Creative Commons Attribution 4.0 International', 'https://creativecommons.org/licenses/by/4.0/', true, true, false, false),
    ('CC-BY-SA-4.0', 'Creative Commons Attribution-ShareAlike 4.0 International', 'https://creativecommons.org/licenses/by-sa/4.0/', true, true, true, false),
    ('CC-BY-NC-SA-4.0', 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International', 'https://creativecommons.org/licenses/by-nc-sa/4.0/', true, true, true, true),
    ('ALL_RIGHTS_RESERVED', 'All rights reserved', NULL, false, true, false, false),
    ('COMMERCIAL_LICENSE', 'Commercial license', NULL, false, true, false, false),
    ('USED_WITH_PERMISSION', 'Used with permission', NULL, false, true, false, false),
    ('CUSTOM', 'Custom license or rights statement', NULL, true, true, false, false)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    url = EXCLUDED.url,
    allows_derivatives = EXCLUDED.allows_derivatives,
    requires_attribution = EXCLUDED.requires_attribution,
    share_alike = EXCLUDED.share_alike,
    non_commercial = EXCLUDED.non_commercial;

ALTER TABLE ethical_cases
ADD COLUMN IF NOT EXISTS visibility varchar(20) DEFAULT 'private',
ADD COLUMN IF NOT EXISTS license_code varchar(30) DEFAULT 'CC-BY-NC-SA-4.0',
ADD COLUMN IF NOT EXISTS attribution_text text,
ADD COLUMN IF NOT EXISTS original_case_id integer REFERENCES ethical_cases(id),
ADD COLUMN IF NOT EXISTS imported_from_case_id integer REFERENCES ethical_cases(id),
ADD COLUMN IF NOT EXISTS source_case_title text,
ADD COLUMN IF NOT EXISTS source_case_author text,
ADD COLUMN IF NOT EXISTS source_case_license_code varchar(30),
ADD COLUMN IF NOT EXISTS is_editable_copy boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS rights_status varchar(30) DEFAULT 'own_work',
ADD COLUMN IF NOT EXISTS license_notes text,
ADD COLUMN IF NOT EXISTS permission_statement text,
ADD COLUMN IF NOT EXISTS commercial_source text,
ADD COLUMN IF NOT EXISTS can_be_shared_publicly boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS can_be_copied_by_others boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS language_code varchar(10) DEFAULT 'es_CL';

ALTER TABLE ethical_cases
ALTER COLUMN author_firstname DROP NOT NULL,
ALTER COLUMN author_lastname DROP NOT NULL,
ALTER COLUMN author_email DROP NOT NULL;

ALTER TABLE designs
ADD COLUMN IF NOT EXISTS visibility varchar(20) DEFAULT 'private',
ADD COLUMN IF NOT EXISTS license_code varchar(30) DEFAULT 'CC-BY-SA-4.0',
ADD COLUMN IF NOT EXISTS attribution_text text,
ADD COLUMN IF NOT EXISTS original_design_id integer REFERENCES designs(id),
ADD COLUMN IF NOT EXISTS imported_from_design_id integer REFERENCES designs(id),
ADD COLUMN IF NOT EXISTS source_design_title text,
ADD COLUMN IF NOT EXISTS source_design_author text,
ADD COLUMN IF NOT EXISTS source_design_license_code varchar(30),
ADD COLUMN IF NOT EXISTS is_editable_copy boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS language_code varchar(10) DEFAULT 'es_CL';

UPDATE designs
SET visibility = CASE WHEN public = true THEN 'public' ELSE 'private' END
WHERE visibility IS NULL
   OR visibility NOT IN ('private', 'public');

UPDATE ethical_cases
SET visibility = 'private'
WHERE visibility IS NULL
   OR visibility NOT IN ('private', 'public');

UPDATE ethical_cases
SET license_code = 'CC-BY-NC-SA-4.0'
WHERE license_code IS NULL;

UPDATE ethical_cases
SET rights_status = CASE
    WHEN license_code IN ('CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-SA-4.0') THEN 'open_license'
    ELSE COALESCE(rights_status, 'own_work')
END
WHERE rights_status IS NULL
   OR rights_status NOT IN ('own_work', 'open_license', 'used_with_permission', 'commercial_license', 'public_domain', 'unknown');

UPDATE ethical_cases
SET can_be_shared_publicly = true,
    can_be_copied_by_others = true
WHERE license_code IN ('CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-SA-4.0')
  AND rights_status = 'open_license';

UPDATE designs
SET license_code = 'CC-BY-SA-4.0'
WHERE license_code IS NULL;

UPDATE ethical_cases
SET language_code = 'es_CL'
WHERE language_code IS NULL;

UPDATE designs
SET language_code = 'es_CL'
WHERE language_code IS NULL;

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_visibility_check,
ADD CONSTRAINT ethical_cases_visibility_check CHECK (visibility IN ('private', 'public'));

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_visibility_check,
ADD CONSTRAINT designs_visibility_check CHECK (visibility IN ('private', 'public'));

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_rights_status_check,
ADD CONSTRAINT ethical_cases_rights_status_check CHECK (
    rights_status IN (
        'own_work',
        'open_license',
        'used_with_permission',
        'commercial_license',
        'public_domain',
        'unknown'
    )
);

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_public_visibility_shareable_check,
ADD CONSTRAINT ethical_cases_public_visibility_shareable_check CHECK (
    visibility <> 'public' OR can_be_shared_publicly = true
);

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_license_code_fkey,
ADD CONSTRAINT ethical_cases_license_code_fkey
FOREIGN KEY (license_code) REFERENCES licenses(code);

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_language_code_fkey,
ADD CONSTRAINT ethical_cases_language_code_fkey
FOREIGN KEY (language_code) REFERENCES languages(code);

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_source_case_license_code_fkey,
ADD CONSTRAINT ethical_cases_source_case_license_code_fkey
FOREIGN KEY (source_case_license_code) REFERENCES licenses(code);

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_license_code_fkey,
ADD CONSTRAINT designs_license_code_fkey
FOREIGN KEY (license_code) REFERENCES licenses(code);

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_language_code_fkey,
ADD CONSTRAINT designs_language_code_fkey
FOREIGN KEY (language_code) REFERENCES languages(code);

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_source_design_license_code_fkey,
ADD CONSTRAINT designs_source_design_license_code_fkey
FOREIGN KEY (source_design_license_code) REFERENCES licenses(code);

CREATE INDEX IF NOT EXISTS idx_ethical_cases_visibility ON ethical_cases (visibility);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_language_code ON ethical_cases (language_code);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_rights_status ON ethical_cases (rights_status);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_share_copy ON ethical_cases (can_be_shared_publicly, can_be_copied_by_others);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_original_case_id ON ethical_cases (original_case_id);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_imported_from_case_id ON ethical_cases (imported_from_case_id);
CREATE INDEX IF NOT EXISTS idx_designs_visibility ON designs (visibility);
CREATE INDEX IF NOT EXISTS idx_designs_language_code ON designs (language_code);
CREATE INDEX IF NOT EXISTS idx_designs_original_design_id ON designs (original_design_id);
CREATE INDEX IF NOT EXISTS idx_designs_imported_from_design_id ON designs (imported_from_design_id);

INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email)
SELECT DISTINCT ON (LOWER(author_email))
    author_firstname,
    author_lastname,
    author_email
FROM ethical_cases
WHERE author_email IS NOT NULL
  AND TRIM(author_email) <> ''
ON CONFLICT ((LOWER(author_email))) DO UPDATE
SET author_firstname = EXCLUDED.author_firstname,
    author_lastname = EXCLUDED.author_lastname,
    updated_at = NOW();

INSERT INTO ethical_cases_authors (case_id, author_id, user_id, author_order, is_primary)
SELECT c.id,
       a.id,
       u.id,
       1,
       true
FROM ethical_cases c
INNER JOIN ethical_case_author a
    ON LOWER(a.author_email) = LOWER(c.author_email)
LEFT JOIN users u
    ON LOWER(u.mail) = LOWER(a.author_email)
ON CONFLICT (case_id, author_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    author_order = EXCLUDED.author_order,
    is_primary = EXCLUDED.is_primary,
    updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_ethical_cases_authors_primary
    ON ethical_cases_authors (case_id)
    WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_ethical_cases_authors_author_id ON ethical_cases_authors (author_id);
CREATE INDEX IF NOT EXISTS idx_ethical_cases_authors_user_id ON ethical_cases_authors (user_id);
