#!/bin/sh
# backup-dash NAS key wrapper — install on the NAS as /usr/local/bin/backup-dash-nas-wrapper
#
# Why this exists: passwordless sudo is live for administrators on this box, so
# an unconstrained SSH key would be root. This wrapper is the control that makes
# the key worth only two read verbs. It must be in place BEFORE the key exists
# in authorized_keys.
#
# Referenced from ~/.ssh/authorized_keys as:
#   command="/usr/local/bin/backup-dash-nas-wrapper",restrict ssh-ed25519 AAAA... backup-dash@ryzen
#
# `restrict` disables pty, port forwarding, agent forwarding and X11; the
# command= forces every session through here regardless of what the client asks.

set -eu

deny() {
    echo "backup-dash: command not permitted" >&2
    logger -t backup-dash-nas "DENIED: ${SSH_ORIGINAL_COMMAND:-<none>}" 2>/dev/null || true
    exit 1
}

cmd="${SSH_ORIGINAL_COMMAND:-}"
[ -n "$cmd" ] || deny

# Anything containing shell metacharacters is refused outright, before pattern
# matching. Defense in depth, not the primary check.
case "$cmd" in
    *";"*|*"&"*|*"|"*|*'$'*|*'`'*|*"("*|*")"*|*"<"*|*">"*|*$'\n'*) deny ;;
esac

case "$cmd" in
    "sudo -n /usr/syno/sbin/synosharesnapshot list restic-target")
        ;;
    "sudo -n /usr/syno/sbin/synosharesnapshot snapsize restic-target GMT-"[0-9][0-9]-"[0-9][0-9][0-9][0-9]"."*)
        # e.g. GMT-04-2026.10.23-07.14.16 — enforced by shape, not by trust.
        ;;
    *)
        deny
        ;;
esac

logger -t backup-dash-nas "ALLOWED: $cmd" 2>/dev/null || true
exec $cmd
