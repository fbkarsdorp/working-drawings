#!/bin/sh
# Serve the deck on http://localhost:5050/ (it also runs by double-clicking index.html).
cd "$(dirname "$0")" && open "http://localhost:5050/" 2>/dev/null; exec python3 -m http.server 5050
