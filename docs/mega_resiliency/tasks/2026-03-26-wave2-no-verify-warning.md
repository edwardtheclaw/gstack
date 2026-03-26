# Wave 2.5 — Add --no-verify Warning to README (S3, QW5)

**Date:** 2026-03-26
**Status:** ✅ Done
**Risk items:** S3, QW5

## Problem

The pre-commit hook scans for accidentally committed secrets. A developer in a hurry could
bypass it with `git commit --no-verify`, negating the protection without any documented
guidance discouraging this practice.

## Fix

Added a one-sentence note in the README Development section:

> A pre-commit hook scans for accidental secrets before every commit. Do not bypass it with
> `git commit --no-verify` — if a hook fails, fix the underlying issue rather than skipping
> the check.

## Files Changed

- `README.md`
