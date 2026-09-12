# 0009 — Open-source licence

**Status:** OPEN. Decide before the first external contributor — it is hard to reverse
after.

No `LICENSE` file exists in this repo yet. That is deliberate: adding one is the
decision, and it should be made rather than defaulted into.

## Context

The business is a box and a curriculum subscription, not hosted SaaS. That changes what
copyleft costs.

| Option | For | Against |
|---|---|---|
| Apache-2.0 | Maximises adoption and contributed courses; school procurement teams are comfortable with it | Nothing stops a vendor hosting the open core as SaaS without publishing changes |
| AGPL-3.0 | Prevents exactly that, and it protects rather than harms a model that is explicitly *not* SaaS | Some school and district procurement teams flinch at AGPL on sight |
| Split | AGPL for the platform, permissive for the runtime adapters and content schema, so the ecosystem pieces spread freely | Two licences to explain, and contributors must understand which applies where |

## Options considered but not open

Closed source is not on the table: the stated goals include open-sourcing, and the
adoption path runs through contributed courses.

## Decision

Not yet made.

## Consequences of deferring

Every day without a licence is a day the repo is legally unusable by anyone else, which
is fine while it is private and a problem the moment it is not. The commercial layer
(multi-tenancy, dashboards, cross-cohort analytics) does not exist yet, so nothing is
being pre-split for open-core — that carve-out happens when a customer asks, as a private
repo or an `/ee/` directory.
