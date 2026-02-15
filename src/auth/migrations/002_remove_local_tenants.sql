-- Tenants are managed by the main isolated platform database.
-- Auth DB only keeps tenant references on oauth_clients/records.
DROP TABLE IF EXISTS tenants;
