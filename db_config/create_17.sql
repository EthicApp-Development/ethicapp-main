-- Uncomment Legacy Fix code below if J option was used inverted (legacy code)

-- Legacy Fix
-- UPDATE sessions set options = 'T' where options is null;
-- UPDATE sessions set options = null where options = 'J';
-- UPDATE sessions set options = 'J' where options = 'T';
-- UPDATE sessions set options = trim(both 'J' from options) where char_length(options) > 1;
-- End of Legacy Fix

ALTER TABLE sessions ALTER COLUMN options SET DEFAULT 'J';