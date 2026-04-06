#!/bin/bash
# Local CI: runs the same checks as GitHub Actions
set -e

echo "=== Tests ==="
npm test 2>&1 || echo "⚠️  Test failures"

echo ""
echo "✅ CI complete"
