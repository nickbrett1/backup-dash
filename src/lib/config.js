// Runtime configuration, read lazily from the environment.
//
// Deliberately lazy: tests and the dev container override these between
// imports, and adapter-node passes process.env through untouched at runtime.

const DEFAULTS = {
  STATE_FILE: "/backup/state/last_success.json",
  BACKUP_DIR: "/backup",
   
  RESTIC_REPO: "sftp:restic@192.168.1.2:/restic-target/um790",
  RESTIC_SSH_KEY: "/secrets/id_restic_ed25519",
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- see RESTIC_REPO above
  NAS_HOST: "192.168.1.2",
  NAS_PORT: "2222",
  NAS_SSH_KEY: "/secrets/id_nas_ed25519",
  NAS_USER: "nick",
  NAS_SHARE: "restic-target",
  DAG_FILE: "/dagu/dags/um790-backup.yaml",
  SUSPEND_FILE: "/dagu/suspend/um790-backup",
  NEXT_RUN_CRON: "30 3 * * *",
  HISTORY_PATH: "/data/history.jsonl",
  KNOWN_HOSTS: "/app/known_hosts",
  TZ: "America/New_York",
  CACHE_TTL_MS: "60000",
  RESTIC_TIMEOUT_MS: "20000",
  NAS_TIMEOUT_MS: "20000",
  // How long after the next scheduled run we tolerate silence before calling
  // the backup stale. The 03:30 job takes ~13 minutes, so three hours is
  // generous without hiding a missed night.
  GRACE_MINUTES: "180",
};

function read(key) {
  const value = process.env[key];
  return value === undefined || value === "" ? DEFAULTS[key] : value;
}

function readInt(key) {
  const parsed = Number.parseInt(read(key), 10);
  return Number.isFinite(parsed) ? parsed : Number.parseInt(DEFAULTS[key], 10);
}

export function config() {
  return {
    stateFile: read("STATE_FILE"),
    backupDir: read("BACKUP_DIR"),
    resticRepo: read("RESTIC_REPO"),
    resticSshKey: read("RESTIC_SSH_KEY"),
    resticPassword: process.env.RESTIC_PASSWORD || "",
    nasHost: read("NAS_HOST"),
    nasPort: readInt("NAS_PORT"),
    nasSshKey: read("NAS_SSH_KEY"),
    nasUser: read("NAS_USER"),
    nasShare: read("NAS_SHARE"),
    dagFile: read("DAG_FILE"),
    suspendFile: read("SUSPEND_FILE"),
    nextRunCron: read("NEXT_RUN_CRON"),
    historyPath: read("HISTORY_PATH"),
    knownHosts: read("KNOWN_HOSTS"),
    timeZone: read("TZ"),
    cacheTtlMs: readInt("CACHE_TTL_MS"),
    resticTimeoutMs: readInt("RESTIC_TIMEOUT_MS"),
    nasTimeoutMs: readInt("NAS_TIMEOUT_MS"),
    graceMinutes: readInt("GRACE_MINUTES"),
  };
}
