#!/bin/bash
# Ensure opcode-web service is running, start if needed
# This script provides resilient service management for development

set -euo pipefail

PORT="${1:-8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HEALTH_CHECK="$SCRIPT_DIR/check-service.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if service is already running
check_service_status() {
    if "$HEALTH_CHECK" "$PORT" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

# Kill any process occupying the port
clear_port() {
    log_info "Checking for processes on port ${PORT}..."

    local pid=$(lsof -ti :"$PORT" 2>/dev/null || true)

    if [ -n "$pid" ]; then
        log_warn "Port ${PORT} occupied by PID $pid, terminating..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1

        # Verify port is clear
        if lsof -ti :"$PORT" > /dev/null 2>&1; then
            log_error "Failed to clear port ${PORT}"
            return 1
        fi
        log_info "Port ${PORT} cleared"
    else
        log_info "Port ${PORT} is available"
    fi

    return 0
}

# Start the service
start_service() {
    log_info "Starting opcode-web service on port ${PORT}..."

    cd "$PROJECT_ROOT"

    # Start service in background with logging
    if [ -n "${OPCODE_LOG_FILE:-}" ]; then
        just web-port "$PORT" > "$OPCODE_LOG_FILE" 2>&1 &
    else
        just web-port "$PORT" > /tmp/opcode-web.log 2>&1 &
    fi

    local service_pid=$!
    echo "$service_pid" > /tmp/opcode-web.pid

    log_info "Service started with PID $service_pid"

    # Wait for service to be healthy
    local max_wait=30
    local waited=0

    while [ $waited -lt $max_wait ]; do
        if "$HEALTH_CHECK" "$PORT" > /dev/null 2>&1; then
            log_info "Service is healthy and ready"
            return 0
        fi

        sleep 1
        ((waited++))
    done

    log_error "Service failed to become healthy within ${max_wait}s"
    return 1
}

# Main execution
main() {
    log_info "Ensuring opcode-web service is running..."

    if check_service_status; then
        log_info "Service is already running and healthy"
        exit 0
    fi

    log_warn "Service is not running, attempting to start..."

    if ! clear_port; then
        log_error "Failed to clear port ${PORT}"
        exit 1
    fi

    if ! start_service; then
        log_error "Failed to start service"
        exit 1
    fi

    log_info "✓ Service successfully started and verified"
}

main "$@"
