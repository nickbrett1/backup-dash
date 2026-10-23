#!/bin/sh
# backup-dash NAS key wrapper — install on the NAS as /usr/local/bin/backup-dash-nas-wrapper
#
# Why this exists: passwordless sudo is live for administrators on this box, so
# an unconstrained SSH key would be root. This wrapper is the control that makes
# the key worth exactly two read verbs. It must be in place — and verified —
# BEFORE the key is authorized.
#
# Referenced from the NAS's ~/.ssh/authorized_keys as:
#   command="/usr/local/bin/backup-dash-nas-wrapper",restrict ssh-ed25519 AAAA... backup-dash@ryzen
#
# `restrict` disables pty, port forwarding, agent forwarding and X11; the
# command= forces every session through here regardless of what the client asks.
#
# Implementation note: the allow-list patterns escape their spaces rather than
# quoting parts of the string. An earlier revision mixed quoting and character
# classes and had an odd number of double quotes, which bash reported as
# "unexpected EOF while looking for matching \"" — it failed closed, but the
# allowed verbs did not work at all. Keep the patterns quote-free, and verify
# with `bash -n` plus the test matrix in deploy/nas/README.md before installing.

set -eu

deny() {
    echo "backup-dash: command not permitted" >&2
    logger -t backup-dash-nas "DENIED: ${SSH_ORIGINAL_COMMAND:-<none>}" 2>/dev/null || true
    exit 1
}

cmd="${SSH_ORIGINAL_COMMAND:-}"
[ -n "$cmd" ] || deny

# Anything containing shell metacharacters or glob characters is refused before
# pattern matching. Defense in depth: `*` and `?` would let a client smuggle a
# pattern that the shell expands against the NAS filesystem, so they are banned
# even though the allow-list below requires a literal snapshot name.
case "$cmd" in
    *";"*|*"&"*|*"|"*|*'$'*|*'`'*|*"("*|*")"*|*"<"*|*">"*|*"*"*|*"?"*|*"'"*|*$'\n'*) deny ;;
esac

case "$cmd" in
    "sudo -n /usr/syno/sbin/synosharesnapshot list restic-target")
        ;;
    sudo\ -n\ /usr/syno/sbin/synosharesnapshot\ snapsize\ restic-target\ GMT-[0-9][0-9]-[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]-[0-9][0-9].[0-9][0-9].[0-9][0-9])
        # e.g. GMT-04-2026.10.23-07.14.16 — the full name shape, no trailing
        # wildcard, so there is exactly one possible argument.
        ;;
    *)
        deny
        ;;
esac

# No globbing on the way to exec, even though the patterns above admit no globs.
set -f

logger -t backup-dash-nas "ALLOWED: $cmd" 2>/dev/null || true
exec $cmd
