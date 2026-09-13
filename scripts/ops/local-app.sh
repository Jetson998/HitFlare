#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
STATE_DIR="$ROOT_DIR/.local"
PID_FILE="$STATE_DIR/hitflare.pid"
LOG_FILE="$STATE_DIR/hitflare.log"

if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    . "$ROOT_DIR/.env"
    set +a
fi

PORT_VALUE=${PORT:-3000}

mkdir -p "$STATE_DIR"

running_pid() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -F "server/index.mjs" >/dev/null 2>&1; then
            printf '%s\n' "$pid"
            return 0
        fi
        rm -f "$PID_FILE"
    fi
    return 1
}

case "${1:-status}" in
    start)
        if pid=$(running_pid); then
            echo "HitFlare already running: pid=$pid port=$PORT_VALUE"
            exit 0
        fi
        nohup env PORT="$PORT_VALUE" node "$ROOT_DIR/server/index.mjs" >>"$LOG_FILE" 2>&1 &
        echo $! >"$PID_FILE"
        sleep 1
        if ! running_pid >/dev/null; then
            echo "HitFlare failed to start; see $LOG_FILE" >&2
            exit 1
        fi
        echo "HitFlare started: http://localhost:$PORT_VALUE"
        ;;
    status)
        if pid=$(running_pid); then
            echo "HitFlare running: pid=$pid port=$PORT_VALUE"
            curl -fsS "http://127.0.0.1:$PORT_VALUE/api/health"
            echo
        else
            echo "HitFlare stopped"
            exit 1
        fi
        ;;
    stop)
        if pid=$(running_pid); then
            kill "$pid"
            rm -f "$PID_FILE"
            echo "HitFlare stopped: pid=$pid"
        else
            echo "HitFlare already stopped"
        fi
        ;;
    restart)
        "$0" stop
        "$0" start
        ;;
    *)
        echo "Usage: $0 {start|status|stop|restart}" >&2
        exit 2
        ;;
esac
