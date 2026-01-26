#!/bin/bash
# Opcode Dual-Port Manager
# 8080 + 8081 for backup during development

set -e

PORT1=8080
PORT2=8081
BIN="./src-tauri/target/debug/opcode-web"
LOG1="/tmp/opcode-web-8080.log"
LOG2="/tmp/opcode-web-8081.log"

log() { echo "[$1] $2"; }

start_port() {
    local port=$1
    local log="/tmp/opcode-web-$port.log"

    if curl -s -o /dev/null "http://localhost:$port" 2>/dev/null; then
        log "INFO" "Port $port already running"
        return 0
    fi

    log "INFO" "Starting opcode-web on port $port..."
    $BIN --port $port > "$log" 2>&1 &
    sleep 3

    if curl -s -o /dev/null "http://localhost:$port" 2>/dev/null; then
        log "OK" "Port $port started"
    else
        log "ERROR" "Failed to start port $port"
        return 1
    fi
}

stop_port() {
    local port=$1
    log "INFO" "Stopping port $port..."
    lsof -ti :$port | xargs -r kill -9 2>/dev/null || true
    sleep 1
    log "OK" "Port $port stopped"
}

status() {
    echo "=== Opcode Services ==="
    for port in $PORT1 $PORT2; do
        if curl -s -o /dev/null "http://localhost:$port" 2>/dev/null; then
            echo "  :$port - RUNNING"
        else
            echo "  :$port - DOWN"
        fi
    done
}

case "${1:-status}" in
    start)
        start_port $PORT1
        start_port $PORT2
        ;;
    start1) start_port $PORT1 ;;
    start2) start_port $PORT2 ;;
    stop)
        stop_port $PORT1
        stop_port $PORT2
        ;;
    stop1) stop_port $PORT1 ;;
    stop2) stop_port $PORT2 ;;
    restart)
        stop_port $PORT1 && start_port $PORT1
        stop_port $PORT2 && start_port $PORT2
        ;;
    status|*)
        status
        ;;
esac
