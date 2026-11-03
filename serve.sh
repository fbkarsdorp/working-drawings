#!/bin/sh
# Serve the deck and open it in the browser (it also runs by double-clicking index.html).
#   ./serve.sh          port 5050, or the next free port after it
#   ./serve.sh 6060     port 6060, or the next free port after it
cd "$(dirname "$0")" || exit 1
port=${1:-5050}
case $port in *[!0-9]* | "") echo "usage: ./serve.sh [port]" >&2; exit 1 ;; esac
while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
  echo "port $port is in use, trying $((port + 1))" >&2
  port=$((port + 1))
done
echo "Working Drawings on http://localhost:$port/  (Ctrl+C to stop)"
(sleep 0.6 && open "http://localhost:$port/" 2>/dev/null) &
exec python3 -m http.server "$port" --bind 127.0.0.1
