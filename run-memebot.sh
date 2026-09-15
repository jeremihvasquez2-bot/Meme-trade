#!/usr/bin/env bash
cd "$(dirname "$0")"
mkdir -p data
while true; do
  echo "[$(date)] starting memebot" >> data/runner.log
  node src/main.js
  code=$?
  echo "[$(date)] memebot exited with code $code, restarting in 5s" >> data/runner.log
  sleep 5
done
