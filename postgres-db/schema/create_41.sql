-- Step 1: Create the user_institutions table
CREATE TABLE user_institutions (
    id SERIAL PRIMARY KEY,  -- Primary key for the table
    name TEXT NOT NULL      -- Institution name, cannot be null
);

-- Step 2: Add a foreign key column to the users table
ALTER TABLE users
ADD COLUMN institution_id INTEGER,  -- Add a new column for the foreign key
ADD CONSTRAINT fk_user_institution
    FOREIGN KEY (institution_id)  -- Define the foreign key constraint
    REFERENCES user_institutions (id)  -- Link institution_id to the id column in user_institutions
    ON DELETE SET NULL;  -- If the referenced institution is deleted, set institution_id to NULL
