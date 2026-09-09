-- Activates the template with the given name, deactivating whatever was active
-- before (only one row may have is_active = true, see the create-templates
-- migration's partial unique index). Replace 'default' with 'dark' (or any other
-- template's name) as needed.
BEGIN;
UPDATE templates SET is_active = false WHERE is_active = true;
UPDATE templates SET is_active = true WHERE name = 'default';
COMMIT;
