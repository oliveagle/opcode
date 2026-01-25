#!/bin/bash
# Health check script for opcode-web service
# Returns 0 if service is healthy, 1 if unhealthy

set -euo pipefail

PORT="${1:-8080}"
MAX_RETRIES=3
RETRY_DELAY=2

check_health() {
    local attempt=1

    while [ $attempt -le $MAX_RETRIES ]; do
        if curl -s "http://localhost:${PORT}/api/process_stats" > /dev/null 2>&1; then
            echo "✓ Service is healthy on port ${PORT}"
            return 0
        fi

        if [ $attempt -lt $MAX_RETRIES ]; then
            echo "Attempt $attempt/$MAX_RETRIES failed, retrying in ${RETRY_DELAY}s..."
            sleep $RETRY_DELAY
        fi

        ((attempt++))
    done

    echo "✗ Service is unhealthy or not responding on port ${PORT}"
    return 1
}

check_health
