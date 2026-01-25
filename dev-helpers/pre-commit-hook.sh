#!/bin/bash
# Git pre-commit hook to save development context
# This hook runs before each commit to capture work state

# Skip if committing merge
if git rev-parse -q --verify MERGE_HEAD > /dev/null; then
    exit 0
fi

# Save context quietly
dev-helpers/save-context.sh > /dev/null 2>&1 || true

exit 0
