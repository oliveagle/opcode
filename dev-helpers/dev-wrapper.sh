#!/bin/bash
# Development wrapper - ensures service is running before executing commands
# This prevents work interruption by automatically recovering the service

set -euo pipefail

PORT="${1:-8080}"
shift # Remove port from args, keep rest as command to execute

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENSURE_SERVICE="$SCRIPT_DIR/ensure-service.sh"
HEALTH_CHECK="$SCRIPT_DIR/check-service.sh"

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Start background monitor to auto-restart service if it dies
start_service_monitor() {
    log_step "Starting service monitor..."
    (
        while true; do
            sleep 5
            if ! "$HEALTH_CHECK" "$PORT" > /dev/null 2>&1; then
                log_warn "Service is down, restarting..."
                if "$ENSURE_SERVICE" "$PORT"; then
                    log_success "Service restarted successfully"
                else
                    log_error "Failed to restart service"
                fi
            fi
        done
    ) &
    MONITOR_PID=$!
    echo "$MONITOR_PID" > /tmp/opcode-monitor.pid
    log_success "Service monitor started (PID: $MONITOR_PID)"
}

# Ensure service is running
log_step "Ensuring opcode-web service is available..."
if ! "$ENSURE_SERVICE" "$PORT"; then
    echo "Failed to start service. Please check logs:"
    echo "  tail -f /tmp/opcode-web.log"
    exit 1
fi

log_success "Service is ready"

# Start background monitor
start_service_monitor

# Export service URL for commands
export OPCODE_SERVICE_URL="http://localhost:${PORT}"

# Execute remaining arguments as command, or start interactive shell
if [ $# -eq 0 ]; then
    log_step "Starting interactive development shell"
    log_step "Service running at http://localhost:${PORT}"
    log_step "Use 'exit' to quit (service will continue running)"
    log_step "Monitor will auto-restart service if it crashes"
    echo ""

    # Start bash with service info in prompt
    PS1="[opcode-dev:${PORT}] \w $ "
    export PS1
    exec bash --noprofile --norc
else
    # Execute the provided command
    exec "$@"
fi
