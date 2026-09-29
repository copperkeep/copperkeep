# 0011 — One org admin flag; every other adult sees only linked learners

**Status:** Accepted (0.1.11)

## Context

Until 0.1.11 every adult was equal and could act only on learners linked to them in
`guardianship`. That was enough while one parent created every account, but it left no
one able to see an account someone else created, list the org, add a second adult, or
remove anyone. It also meant a co-parent or a tutor would either see nothing or — if
the rule were simply relaxed — see every child on the box.

The two ways that fail are different in kind. Seeing too little is an inconvenience.
Seeing too much is a privacy breach the moment a second family or a tutoring center
shares the box (§7.6), and cannot be walked back.

## Decision

- **`users.is_admin`**, a boolean on adult accounts (`CHECK (NOT is_admin OR role =
  'adult')`). The org admin sees and manages every account in the org.
- **Every other adult sees only the learners linked to them** in `guardianship`, plus
  their own account. That is the existing rule, unchanged.
- One access check, `deps.can_manage(principal, user_id)`: the user themself, the org
  admin, or a linked adult. It replaced the guardianship-only check everywhere, so no
  endpoint has its own idea of who may see whom. A user in another org is a 404, not a
  403 — an id from elsewhere reveals nothing.
- Admin-only: adding adults, granting admin, linking and unlinking guardianship,
  removing accounts, and resetting another adult's password.
- The org can never be left without an admin: nobody removes their own account, and
  the last admin can be neither removed nor demoted.
- Existing installs: migration `0002_org_admin.sql` makes the earliest adult in each
  org the admin. Fresh installs: the bootstrap adult is created with it.

## Why a flag rather than a third role

`role` answers *what kind of account is this* — it picks the credential (PIN or
password), the landing view and the prose tier. Admin is a *permission* an adult holds,
and more than one adult may hold it. Folding it into `role` would make every
`role = 'adult'` check across the API and the SPA also need to say `or 'admin'`, and
the first one forgotten becomes a bug where an admin cannot do what any adult can.

## Consequences

- A second family or a tutor can share a box without seeing each other's children,
  provided nobody grants them admin.
- Cohort-based visibility (a tutor sees their cohort) is **not** part of this; see
  #36. When it lands it should extend `can_manage`, not bypass it.
- Removing an account cascades its whole progress history. That is the one
  irreversible admin action, so the UI demands the username typed out, and every
  admin action is logged by actor and target. A permanent audit table is #40.
- A lost admin password has no recovery path until recovery codes exist (#39).
