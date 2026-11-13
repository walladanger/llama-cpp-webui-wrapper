#!/bin/bash
exec 9>"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/$1.keepalive"
flock -n 9
lock=$?
[ "$lock" -eq 1 ] && exit 0
[ "$lock" -eq 0 ] || exit "$lock"
while state=$(systemctl --user show --property=ActiveState --value "$1"); do
    case "$state" in active|activating|reloading|deactivating) sleep 5;; *) exit;; esac
done
