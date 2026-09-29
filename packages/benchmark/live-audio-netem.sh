#!/usr/bin/env bash
set -euo pipefail

profile="${NETWORK_PROFILE:-wifi}"

case "$profile" in
  clean)
    netem_args=()
    ;;
  wifi)
    netem_args=(delay 15ms 5ms distribution normal loss random 0.2%)
    ;;
  mobile)
    netem_args=(delay 40ms 15ms distribution normal loss random 1%)
    ;;
  poor)
    netem_args=(delay 100ms 40ms distribution normal loss random 5% 25% rate 512kbit)
    ;;
  *)
    echo "Unknown NETWORK_PROFILE: $profile" >&2
    echo "Expected one of: clean, wifi, mobile, poor" >&2
    exit 2
    ;;
esac

tc qdisc del dev lo root 2>/dev/null || true
if ((${#netem_args[@]})); then
  tc qdisc add dev lo root netem "${netem_args[@]}"
fi

echo "Network profile: $profile"
tc qdisc show dev lo

export NETWORK_PROFILE="$profile"
exec node packages/benchmark/live-audio.js --profile clean "$@"
