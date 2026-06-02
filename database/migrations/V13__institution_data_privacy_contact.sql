ALTER TABLE institutional_contacts
  DROP CONSTRAINT IF EXISTS institutional_contacts_contact_type_check;

ALTER TABLE institutional_contacts
  ADD CONSTRAINT institutional_contacts_contact_type_check
  CHECK (contact_type IN ('technical', 'academic', 'data_privacy'));

INSERT INTO institutional_contacts (institution_id, contact_type)
VALUES (1, 'data_privacy')
ON CONFLICT (institution_id, contact_type) DO NOTHING;
