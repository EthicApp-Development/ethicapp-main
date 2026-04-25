ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_image_path TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_image_topbar_path TEXT;
