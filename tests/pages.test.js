import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Contents from "../src/routes/contents/+page.svelte";
import Snapshots from "../src/routes/snapshots/+page.svelte";
import Repo from "../src/routes/repo/+page.svelte";

const status = {
  state: {
    containers: null,
    pg_dumps: null,
    sqlite_dumps: null,
    snapshot_retention_days: 90,
  },
};

describe("contents page", () => {
  it("renders groups and never turns an absent count into zero", () => {
    const contents = {
      degraded: false,
      asOf: "2026-10-23T12:00:00.000Z",
      error: null,
      value: {
        root: "/backup",
        totalBytes: 2048,
        files: [
          {
            path: "pg/app.dump",
            name: "app.dump",
            bytes: 2048,
            mtime: "2026-10-23T11:00:00.000Z",
          },
        ],
        groups: {
          config: [],
          pg: [
            {
              path: "pg/app.dump",
              name: "app.dump",
              bytes: 2048,
              mtime: "2026-10-23T11:00:00.000Z",
            },
          ],
          sqlite: [],
          other: [],
        },
      },
    };
    render(Contents, { data: { status, contents } });
    expect(screen.getByText("pg/app.dump")).toBeInTheDocument();
    expect(
      screen.getByText("not reported by the pipeline yet"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("says degraded rather than showing a blank panel", () => {
    render(Contents, {
      data: {
        status: null,
        contents: {
          degraded: true,
          asOf: null,
          error: "backup tree unreadable",
          value: null,
        },
      },
    });
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText(/backup tree unreadable/)).toBeInTheDocument();
  });
});

describe("snapshots page", () => {
  it("renders names, sizes and the 512 cap", () => {
    const nas = {
      degraded: false,
      asOf: "2026-10-23T12:00:00.000Z",
      error: null,
      value: [
        {
          name: "GMT-04-2026.10.22-12.08.15",
          at: "2026-10-22T16:08:15.000Z",
          embedded_offset: "-04",
          size: { bytes: 1024, raw: "1 KiB" },
        },
        {
          name: "GMT-04-2026.10.23-07.14.16",
          at: "2026-10-23T11:14:16.000Z",
          embedded_offset: "-04",
          size: null,
        },
      ],
    };
    render(Snapshots, {
      data: { status, nas, maxSnapshots: 512, share: "restic-target" },
    });
    expect(screen.getByText(/2 \/ 512/)).toBeInTheDocument();
    expect(
      screen.getAllByText("GMT-04-2026.10.23-07.14.16").length,
    ).toBeGreaterThan(0);
  });

  it("renders an unreachable NAS as a degraded panel", () => {
    render(Snapshots, {
      data: {
        status,
        nas: {
          degraded: true,
          asOf: null,
          error: "ssh: connect timed out",
          value: undefined,
        },
        maxSnapshots: 512,
        share: "restic-target",
      },
    });
    expect(screen.getByText(/NAS unreachable/)).toBeInTheDocument();
    expect(screen.getByText(/connect timed out/)).toBeInTheDocument();
  });
});

describe("repo page", () => {
  it("shows the cross-check drift between stats and the state file", () => {
    const restic = {
      degraded: false,
      asOf: "2026-10-23T12:00:00.000Z",
      error: null,
      value: {
        snapshots: [
          {
            id: "abcdef123456",
            short_id: "abcdef12",
            time: "2026-10-23T11:14:16Z",
            hostname: "ryzen",
            tags: ["auto"],
            paths: ["/backup"],
          },
        ],
        stats: { total_size: 2048 },
        version: "restic 0.18.1",
      },
    };
    render(Repo, {
      data: {
        status: { state: { repo: "sftp:restic@nas:/repo", repo_bytes: 1024 } },
        restic,
      },
    });
    expect(screen.getByText(/drift \+1 KB/)).toBeInTheDocument(); // stats − state
    expect(screen.getAllByText(/0\.18\.1/).length).toBeGreaterThan(0);
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("renders degraded with the error text", () => {
    render(Repo, {
      data: {
        status: null,
        restic: {
          degraded: true,
          asOf: null,
          error: "restic failed (1)",
          value: undefined,
        },
      },
    });
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText(/restic failed/)).toBeInTheDocument();
  });
});
