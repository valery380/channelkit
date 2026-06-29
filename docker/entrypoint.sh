#!/bin/sh
set -e

CHANNELKIT_HOME="/root/.channelkit"
mkdir -p "$CHANNELKIT_HOME"

# If no config exists yet (first run), copy the baked-in default
if [ ! -f "$CHANNELKIT_HOME/config.yaml" ]; then
  echo "[channelkit] No config found — starting with defaults"
fi

# Disable auto-update and tunnel in containers (manage externally)
if [ -f "$CHANNELKIT_HOME/config.yaml" ]; then
  sed -i 's/auto_update: true/auto_update: false/' "$CHANNELKIT_HOME/config.yaml"
  sed -i 's/auto_start:.*/auto_start: false/' "$CHANNELKIT_HOME/config.yaml"
fi

# Restart loop — if ChannelKit exits (dashboard restart, crash, etc.),
# restart it inside the container instead of letting the container die.
while true; do
  echo "[channelkit] Starting ChannelKit..."
  env CI=true node dist/cli.js start || true
  echo "[channelkit] Process exited, restarting in 5s..."
  sleep 5
done
