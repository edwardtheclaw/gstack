---
name: migrate
version: 1.0.0
description: |
  Database migration safety reviewer. Analyzes migration files for reversibility,
  data loss risk, zero-downtime compatibility, missing indexes, constraint timing,
  and backfill safety. Produces a go/no-go verdict with required rollback steps.
  Positioned before /review in the development lifecycle — catch migration issues
  before they become production incidents.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# /migrate — Database Migration Reviewer

You are reviewing a database migration before it runs in production. Your job is to catch safety issues that cause data loss, downtime, or irreversible schema damage. Be specific — cite filename and line numbers.

## User-invocable
When the user types `/migrate`, run this skill.

## Arguments

- `/migrate` — review all migration files in the current diff
- `/migrate <file>` — review a specific migration file
- `/migrate --all` — review all migrations in the repo (not just the diff)

---

## Step 1: Find migration files

**If a file argument was given:** Read that file directly.

**If no argument given (`/migrate`)**, find migrations in the current diff:

```bash
git diff origin/main --name-only | grep -iE "(db/migrate|migrations|migrate)" | grep -vE "^Binary"
```

**If `--all` was given:**
```bash
# Rails
ls -t db/migrate/*.rb 2>/dev/null | head -20
# Django / Alembic
find . -path "*/migrations/*.py" -not -path "*/node_modules/*" 2>/dev/null | head -20
# Generic SQL
find . -name "*.sql" -path "*/migrations/*" -not -path "*/node_modules/*" 2>/dev/null | head -20
```

**If no migrations found in diff or repo:** Output:
```
No migration files found. Specify a file: /migrate db/migrate/20260327_add_users_index.rb
```
Then stop.

---

## Step 2: Read each migration file

Use the Read tool to read every migration file found in Step 1.

Also check for a schema file to understand table sizes (heuristic for lock risk):
```bash
# Rails
wc -l db/schema.rb 2>/dev/null
# Shows table count — used to flag large-table operations
grep -c "create_table" db/schema.rb 2>/dev/null
```

---

## Step 3: Apply the safety checklist

For each migration, evaluate all of the following. Only report issues that are actually present — do not flag things that are fine.

---

### CRITICAL — Blocks deployment

#### Irreversibility
- `change` method contains `remove_column`, `drop_table`, or `change_column` without an explicit `down` or `reversible` block → these are **not auto-reversible**
- `execute("DROP TABLE ...")` or `execute("DELETE FROM ...")` without a matching rollback strategy
- `rename_column` / `rename_table` without a `down` block

#### Data Loss
- `remove_column` on a column that has data (check schema.rb/models for usage)
- `NOT NULL` constraint added to an existing column **without a default value and without a prior backfill** — will fail on rows with NULL
- Column type narrowing: `string → integer`, `text → varchar(50)`, `decimal(12,4) → decimal(6,2)` — values that don't fit are silently truncated or rejected
- `truncate` / `DELETE FROM` without WHERE clause inside a migration

#### Zero-Downtime Incompatibility
- Adding a `NOT NULL` column with no default to a large table → table lock during backfill (PostgreSQL rewrites the table)
- Renaming a table/column while the deployed app still references the old name → runtime errors between deploy and migration
- Dropping a column before the app code is deployed that **ignores** it (use `ignored_columns` or deploy ignore first)
- Adding a foreign key with `validate: true` (default) on a large table → full-table scan locks both tables; use `validate: false` then `validate_constraint` in a separate migration

---

### HIGH — Conditions for deployment

#### Missing Indexes
- Foreign key columns added without a corresponding index (`add_reference` without `index: true`, or `add_column :user_id` without a following `add_index`)
- Columns referenced in the same file's comments/model for `where`, `order`, or `join` without indexes
- Unique constraints added with `algorithm: :default` on large tables — use `algorithm: :concurrently` (PostgreSQL) to avoid locking

#### Constraint Timing
- `add_not_null_constraint` / `add_check_constraint` with `validate: true` (default) on populated tables → full table scan
- For large tables: prefer `NOT VALID` → validate in a background job:
  ```sql
  ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0) NOT VALID;
  -- later: ALTER TABLE t VALIDATE CONSTRAINT c;
  ```

#### Backfill Safety
- `execute("UPDATE ...")` or `Model.update_all(...)` inside a migration without a LIMIT/batching pattern → runs in a single transaction, locks the entire table for the duration
- Calling `Model.all.each { |r| r.update!(...) }` → N+1 updates in a transaction, locks rows for minutes on large tables
- The safe pattern: do the structural migration now, run the backfill as a background job, then add the NOT NULL constraint in a follow-up migration

---

### INFORMATIONAL

#### Migration Hygiene
- Migration filename doesn't describe the actual change (e.g., `20260101000000_migration.rb`)
- Migration timestamp is out of order with surrounding files (suggests cherry-pick or rebase issue)
- Commented-out code left in the migration
- `say` / `say_with_time` missing for long-running operations (helpful for deployment logs)

#### Rollback Completeness
- No `down` method for destructive operations — document what manual rollback looks like
- `disable_ddl_transaction!` used without a comment explaining why

---

## Step 4: Output the report

```
Migration Safety Review: <filename>
Verdict: GO ✓ / CONDITIONAL ⚠ / NO-GO ✗

CRITICAL (NO-GO):
- [file:line] <problem>
  Fix: <specific fix>

HIGH (conditions for GO):
- [file:line] <problem>
  Fix: <specific fix>

INFORMATIONAL:
- [file:line] <note>

Rollback plan:
  <step-by-step instructions for reverting this migration if needed>
  Standard: rails db:rollback STEP=1  (only if migration is reversible)
  Manual:   <steps if rollback isn't automatic>
```

**Verdict rules:**
- **NO-GO ✗** — any CRITICAL issue present
- **CONDITIONAL ⚠** — no CRITICAL, but HIGH issues require action before deploy
- **GO ✓** — no CRITICAL or HIGH issues (informational items don't block)

If all clear: `Migration Safety Review: <filename> — GO ✓ No blocking issues.`

---

## Important Rules

- Focus on the migration file(s) only — do not read application code unless needed to check column usage
- Be terse: one line per issue, one line for the fix
- Do not flag issues that are already addressed in the migration (read the full file before commenting)
- Do not suggest adding comments explaining constants — that guidance rots
- Always output a rollback plan, even if it's just "Standard: rails db:rollback"
- Do NOT read CLAUDE.md or other docs — this skill is self-contained
