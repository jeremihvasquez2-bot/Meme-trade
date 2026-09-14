#!/usr/bin/env bash
# memebot runner. Restarts the bot if it crashes, backing off so a broken
# build does not spin the CPU. Ctrl-C to stop it.
cd "$(dirname "$0")" || exit 1
wait=2
while true; do
  echo
  echo "[$(date '+%F %T')] starting memebot..."
  node src/main.js
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "[$(date '+%F %T')] memebot exited cleanly."
    exit 0
  fi
  echo "[$(date '+%F %T')] memebot exited with code $code. Restarting in ${wait}s..."
  sleep "$wait"
  wait=$(( wait * 2 ))
  [ "$wait" -gt 60 ] && wait=60
done
