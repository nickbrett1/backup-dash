// What is actually on disk under $BACKUP_DIR.
//
// Names and sizes only.
//
// `staging/` IS read. It is `root:root 0700` on the host, and the container runs
// as root, so the staged dumps and config snapshots the pipeline collects before
// a run are visible. An earlier revision skipped it on the assumption the mode
// made it unreadable, which was true of the host account, not of the container.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

const SKIP = new Set(["state", "secrets"]);

function walk(root, dir, depth, maxDepth, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable subtree: skip silently, the parent still renders
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (entry.isDirectory()) {
      if (depth < maxDepth) walk(root, full, depth + 1, maxDepth, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push({
      path: relative(root, full),
      name: entry.name,
      bytes: stats.size,
      mtime: stats.mtime.toISOString(),
    });
  }
}

/**
 * @param {string} root
 * @param {{maxDepth?: number}} [opts]
 */
export function readContents(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const files = [];
  walk(root, root, 1, maxDepth, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  return { ok: true, root, files, totalBytes, truncated: false };
}

/**
 * The container names the pipeline collected config for.
 *
 * `staging/config/` is FLAT on ryzen — `<container>.json` per container, plus a
 * `containers.txt` the pipeline itself writes, one name per line. That file is
 * the source of truth: it is exactly the list the config phase walked, so it
 * cannot disagree with the reported count the way filename guessing can (it has
 * 64 lines; the directory has 65 entries, because the manifest lives there too).
 *
 * Fallback is the JSON filenames, for a run that died before writing the
 * manifest. A directory layout (`<name>/...`) is still accepted, because the
 * config phase has used one before and this should not rot if it changes back.
 *
 * @param {string} root
 * @returns {{dir: string|null, source: string|null, names: string[]}}
 */
export function readContainerNames(root) {
  for (const dir of ["staging/config", "config"]) {
    const full = join(root, dir);

    try {
      const manifest = readFileSync(join(full, "containers.txt"), "utf8");
      const names = manifest
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (names.length) return { dir, source: "containers.txt", names };
    } catch {
      // No manifest: fall through to the directory itself.
    }

    let entries;
    try {
      entries = readdirSync(full, { withFileTypes: true });
    } catch {
      continue; // not there, or not readable: try the next candidate
    }
    const names = entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "containers.txt")
      .map((e) =>
        e.isDirectory() ? e.name : basename(e.name, extname(e.name)),
      )
      .sort((a, b) => a.localeCompare(b));
    if (names.length) return { dir, source: "filenames", names };
  }
  return { dir: null, source: null, names: [] };
}

/** Group the tree into the panels /contents shows. */
export function groupContents(contents) {
  const groups = { config: [], pg: [], sqlite: [], other: [] };
  for (const file of contents.files) {
    const top = file.path.split("/")[0];
    if (SKIP.has(top)) continue;
    // Staged dumps live under staging/, so classify on the path without it:
    // staging/pg/x.dump is a pg dump, not "other".
    const rel = file.path.replace(/^staging\//, "");
    if (/(^|\/)pg[-_]?dump|\.sql$|\.dump$/i.test(rel)) groups.pg.push(file);
    else if (/\.sqlite3?$|\.db$/i.test(rel)) groups.sqlite.push(file);
    else if (rel.startsWith("config/") || /\.(json|ya?ml|txt|env)$/i.test(rel))
      groups.config.push(file);
    else groups.other.push(file);
  }
  return groups;
}
