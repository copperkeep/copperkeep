-- Org admin: one adult who can see and manage every account in the org. Other adults
-- (a co-parent, a tutor) still see only the learners linked to them in guardianship.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_admin_is_adult CHECK (NOT is_admin OR role = 'adult');

-- Existing installs: the first adult in each org is the one bootstrap created.
UPDATE users u SET is_admin = true
WHERE u.role = 'adult'
  AND u.created_at = (
      SELECT min(created_at) FROM users
      WHERE org_id = u.org_id AND role = 'adult'
  );
