#!/bin/bash
# Stop monitor and kill all opcode processes

# Stop the monitor
if [ -f /tmp/opcode-monitor.pid ]; then
    kill -9 $(cat /tmp/opcode-monitor.pid) 2>/dev/null
    rm -f /tmp/opcode-monitor.pid
fi

# Kill all opcode-web processes
ps aux | grep opcode-web | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null

echo "All stopped"
