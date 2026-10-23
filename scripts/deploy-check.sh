#!/bin/sh
# Pre-flight for `docker compose up -d` on ryzen.
#
# Run from the directory holding docker-compose.yml, as a user in the docker
# group:  ./scripts/deploy-check.sh
#
# It refuses to start the dashboard credential-less, which is the failure the
# design note calls out: a missing /srv/.um790-backup/secrets is silently
# created empty by Compose and the container starts with no credentials.

set -eu
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fail=1; }
ok() { printf 'ok    %s\n' "$*"; }

say "== host paths =="
for path in /srv/.um790-backup /srv/.um790-backup/state \
            /srv/reader/docker/dagu/data/repo/dags/ryzen \
            /srv/reader/docker/dagu/data/suspend; do
    if [ -e "$path" ]; then ok "$path"; else bad "$path missing"; fi
done

say "== secrets directory =="
SECRETS=/srv/.um790-backup/secrets
if [ -d "$SECRETS" ]; then
    mode=$(stat -c '%a' "$SECRETS")
    [ "$mode" = "700" ] && ok "$SECRETS mode 700" || bad "$SECRETS mode $mode, expected 700"
    for f in dashboard.env id_restic_ed25519 id_nas_ed25519; do
        if [ -f "$SECRETS/$f" ]; then
            fmode=$(stat -c '%a' "$SECRETS/$f")
            [ "$fmode" = "400" ] && ok "$f mode 400" || bad "$f mode $fmode, expected 400"
        else
            bad "$f missing"
        fi
    done
    # The repo password must not be the pipeline's dotenv.
    if [ -f "$SECRETS/dashboard.env" ] && grep -q '^RESTIC_PASSWORD=' "$SECRETS/dashboard.env"; then
        ok "dashboard.env carries RESTIC_PASSWORD"
    else
        bad "dashboard.env has no RESTIC_PASSWORD line"
    fi
else
    bad "$SECRETS missing — create it with: install -d -m 700 -o root -g root $SECRETS"
fi

say "== data directory =="
# Compose mounts /srv/docker/backup-dash/data:/data (not /var/lib): /var/lib is
# root-owned on ryzen and the deploying user has no NOPASSWD sudo.
if [ -d /srv/docker/backup-dash/data ]; then ok "/srv/docker/backup-dash/data"; else bad "/srv/docker/backup-dash/data missing"; fi

say "== suspend flag visibility =="
# The container runs as root, so root-readability is what matters.
if [ -d /srv/reader/docker/dagu/data/suspend ]; then
    ok "suspend dir exists (mode $(stat -c '%a' /srv/reader/docker/dagu/data/suspend))"
else
    bad "suspend dir missing"
fi

say "== compose config =="
docker compose config >/dev/null 2>&1 && ok "docker compose config parses" || bad "docker compose config failed"

if [ "$fail" -ne 0 ]; then
    say ""
    say "Refusing to continue. Fix the failures above before 'docker compose up -d'."
    exit 1
fi

say ""
say "Pre-flight clean. Now: docker compose up -d"
say "Then verify, inside the container:"
say "  docker exec backup-dash sh -c 'mount | grep -c \" ro,\"'   # expect >= 4"
say "  docker exec backup-dash node -e \"fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(console.log)\""
say "And from a LAN browser: http://ryzen:3010/ and the Homepage Activity card."
