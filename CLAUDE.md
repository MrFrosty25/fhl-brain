# CLAUDE.md — fhl-brain

The Brain is Frosty's Holiday Lighting's one source of truth: branding,
pricing, money terms, what we offer (including the lease), promises, service
area, season, sales process, AI rules, costs, definitions and lessons. Tools
plug into it instead of carrying their own copies.

This repo is the **source of truth for the Brain's pure logic**: the registry
of what the Brain holds (`src/registry.ts`) and the functions that resolve,
read, draft, publish, discard, revert, export and import it (`src/core.ts`).
frosty-saas runs a synced copy in `src/lib/brain-core/`. Never edit that copy
by hand: change it here, then `npm run sync -- /path/to/frosty-saas` and open
a PR there. The platform's test fails if the copy differs from this source.

## Owner's hard rules (Omar)

1. Every tool gets its own GitHub repo under MrFrosty25 (2026-11-14). This is
   that repo for the Brain.
2. Nothing critical may depend on Claude. `readBrain` never throws: if the
   Brain cannot be read, every tool falls back to today's reviewed values.
3. Every mistake is written down in `docs/LESSONS.md`.

## The Brain's rules

- **The registry is closed.** A new entry is a code change here, with a label
  in plain English, one line of help, an audience and a validator.
- **Audience.** `customer` entries are safe for customer-facing tools: no feet,
  no per-foot rates, no costs, no staff names, no internal rules. A customer
  read drops every `staff` entry and every draft.
- **Edits are drafts.** Nothing reaches a tool until somebody publishes it —
  all at once ("change the whole operating system") or picked one by one.
  Revert and import create drafts too.
- **Every publish appends history.** Nothing is ever overwritten silently.
- **Pure.** `src/` has no dependencies and imports nothing outside itself. The
  only I/O is through the injected `db` (`from(table)`).
- Never mention HVAC. FHL and HVAC are separate companies.

## Layout

- `src/registry.ts` — sections, entries, validators.
- `src/core.ts` — resolve, `readBrain` (the connector), the plans, export/import.
- `tests/` — `npm test` (node --test, no dependencies). Must pass.
- `scripts/sync-to-platform.mjs` — copy `src/` into frosty-saas, stamped.
