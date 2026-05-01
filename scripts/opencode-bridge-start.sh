#!/usr/bin/env sh
set -eu

PORT="${BRIDGE_PORT:-8787}"
MODE="${OPENCODE_MODE:-run}"
ATTACH_URL="${OPENCODE_ATTACH_URL:-http://localhost:4096}"

while [ $# -gt 0 ]; do
  case "$1" in
    --port=*) PORT="${1#*=}" ;;
    --mode=*) MODE="${1#*=}" ;;
    --attach-url=*) ATTACH_URL="${1#*=}" ;;
  esac
  shift
done

export BRIDGE_PORT="$PORT"
export OPENCODE_MODE="$MODE"
export OPENCODE_ATTACH_URL="$ATTACH_URL"

node bridge/opencode-bridge.mjs

