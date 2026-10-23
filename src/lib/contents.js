// What is actually on disk under $BACKUP_DIR.
//
// Names and sizes only.
//
// `staging/` IS read. It is `root:root 0700` on the host, and the container runs
// as root, so the staged dumps the pipeline collects before a run are visible —
// this is what the tile's "staged:" line counts. An earlier revision skipped it
// on the assumption the mode made it unreadable, which was true of the host
// account, not of the container.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
