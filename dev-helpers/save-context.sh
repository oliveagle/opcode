#!/bin/bash
# Save current development context for recovery
# Captures git state, todo items, and work context

set -euo pipefail

CONTEXT_DIR="/tmp/opcode-context"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CONTEXT_FILE="$CONTEXT_DIR/context-$TIMESTAMP.txt"

mkdir -p "$CONTEXT_DIR"

{
    echo "# Opcode Development Context Snapshot"
    echo "# Saved: $(date)"
    echo "# ========================================"
    echo ""

    echo "## Git Status"
    echo '```'
    git status --short
    echo '```'
    echo ""

    echo "## Current Branch"
    git branch --show-current
    echo ""

    echo "## Recent Commits"
    echo '```'
    git log --oneline -5
    echo '```'
    echo ""

    echo "## Active Todo List (if any)"
    if [ -f ".claude-todos.md" ]; then
        cat .claude-todos.md
    else
        echo "No active todo file found"
    fi
    echo ""

    echo "## Recent Changes"
    echo '```'
    git diff --stat HEAD~5..HEAD 2>/dev/null || echo "No recent changes"
    echo '```'
    echo ""

    echo "## Cargo Build Status (if applicable)"
    if [ -f "src-tauri/Cargo.toml" ]; then
        cd src-tauri
        if cargo check --quiet 2>/dev/null; then
            echo "✅ Cargo check: PASS"
        else
            echo "❌ Cargo check: FAIL"
        fi
        cd ..
    fi
    echo ""

} > "$CONTEXT_FILE"

echo "✅ Context saved to: $CONTEXT_FILE"
echo "📋 To restore context, ask Claude to read this file"

# Create symlink to latest context
ln -sf "$CONTEXT_FILE" "$CONTEXT_DIR/context-latest.txt"
echo "🔗 Latest context: $CONTEXT_DIR/context-latest.txt"
