# NAS key wrapper — install before generating the key

Order matters. Passwordless sudo is live on the NAS, so a key in
`~/.ssh/authorized_keys` without a `command=` wrapper is root-equivalent. Install
the wrapper, verify it, and only then create the key.

## 1. Install the wrapper (as `nick` on the NAS)

```sh
scp -P 2222 deploy/nas/backup-dash-nas-wrapper.sh nick@192.168.1.2:/tmp/
ssh -p 2222 nick@192.168.1.2 '
  sudo install -o root -g root -m 0755 /tmp/backup-dash-nas-wrapper.sh /usr/local/bin/backup-dash-nas-wrapper &&
  sudo /usr/local/bin/backup-dash-nas-wrapper </dev/null || true'
```

It must be owned by root and not writable by `nick` — otherwise the key holder
can rewrite its own cage.

## 2. Verify the wrapper refuses things

Run these **before** any key exists, using a plain ssh session:

```sh
SSH_ORIGINAL_COMMAND='sudo -n /usr/syno/sbin/synosharesnapshot list restic-target' \
  /usr/local/bin/backup-dash-nas-wrapper        # must print the header + 3 names
SSH_ORIGINAL_COMMAND='id' /usr/local/bin/backup-dash-nas-wrapper   # must exit 1
SSH_ORIGINAL_COMMAND='sudo -n /usr/syno/sbin/synosharesnapshot list other-share' \
  /usr/local/bin/backup-dash-nas-wrapper        # must exit 1
```

## 3. Only now generate the key

On ryzen, in `/srv/.um790-backup/secrets` (mode 0700, files 0400):

```sh
ssh-keygen -t ed25519 -N '' -C 'backup-dash@ryzen' -f /srv/.um790-backup/secrets/id_nas_ed25519
cat /srv/.um790-backup/secrets/id_nas_ed25519.pub
```

Append to the NAS's `~/.ssh/authorized_keys`, **with the wrapper**, on one line:

```
command="/usr/local/bin/backup-dash-nas-wrapper",restrict ssh-ed25519 AAAA... backup-dash@ryzen
```

Then, from inside the running container, verify the whole path:

```sh
docker exec backup-dash ssh -p 2222 -i /secrets/id_nas_ed25519 \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/app/known_hosts nick@192.168.1.2 \
  'sudo -n /usr/syno/sbin/synosharesnapshot list restic-target'
```

If `known_hosts` fails, the NAS was rebuilt: re-pin deliberately with
`ssh-keyscan -p 2222 192.168.1.2 > deploy/known_hosts` and rebuild the image.
That failure is the feature.

## 4. Restore path

Revocation is one line: remove the key from `authorized_keys`. The dashboard
then reports the NAS panel as `degraded`, and nothing else is affected.
