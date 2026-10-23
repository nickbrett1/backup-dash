import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Page from "../src/routes/+page.svelte";
import Tile from "../src/routes/tile/+page.svelte";
import { GET } from "../src/routes/health/+server.js";

const status = {
  as_of: "2026-10-23T12:00:00.000Z",
  verdict: "ok",
  unknown_reason: null,
  state: {
    ok: true,
    last_success: "2026-10-23T11:14:00Z",
    last_success_epoch: 1792754040,
    run_id: "01JRUN0000",
    repo: "sftp:restic@192.168.1.2:/restic-target/um790",
    snapshots: 12,
    containers: null,
    pg_dumps: null,
    sqlite_dumps: null,
    repo_bytes: 24696070144,
    duration_sec: 817,
    snapshot_retention_days: 90,
  },
  age_seconds: 2760,
  age: "46m",
  next_run: {
    iso: "2026-10-24T07:30:00.000Z",
    display: "Oct 24, 2026, 3:30 AM",
    in_seconds: 70200,
  },
  schedule: { cron: "30 3 * * *", source: "dag", fallback: false },
  suspend: { suspended: false, readable: true, note: null },
  history: { entries: 1, trend: [], growth: null },
  degraded: {
    state: false,
    state_error: null,
    schedule: false,
    history: false,
    history_error: null,
  },
};

describe("app smoke test", () => {
  it("renders the overview with a healthy verdict", () => {
    render(Page, { data: { status, loadError: null } });
    expect(screen.getByText("Backup healthy")).toBeInTheDocument();
    expect(screen.getByText(/23(\.0)? GB/)).toBeInTheDocument();
    expect(screen.getByText("Oct 24, 2026, 3:30 AM")).toBeInTheDocument();
  });

  it("renders absent optional counts as a dash, never as zero", () => {
    render(Page, { data: { status, loadError: null } });
    expect(
      screen.getByText(/contents not reported by the pipeline yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText("0 containers")).not.toBeInTheDocument();
  });

  it("describes the duration as the whole run, not a container count", () => {
    const run = {
      ...status,
      history: {
        entries: 2,
        trend: [
          { run_id: "prev-run", repo_bytes: 1, duration_sec: 600 },
          { run_id: status.state.run_id, repo_bytes: 2, duration_sec: 817 },
        ],
        growth: null,
      },
    };
    render(Page, { data: { status: run, loadError: null } });
    expect(
      screen.getByText(/the whole run, preflight → status/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/containers walked/)).not.toBeInTheDocument();
  });

  it("gives the container count its own contents card", () => {
    const walked = {
      ...status,
      state: {
        ...status.state,
        containers: 64,
        pg_dumps: 4,
        sqlite_dumps: 9,
      },
    };
    render(Page, { data: { status: walked, loadError: null } });
    expect(screen.getByText("Contents")).toBeInTheDocument();
    expect(screen.getByText(/containers walked/)).toBeInTheDocument();
    expect(screen.getByText(/4 pg \/ 9 sqlite dumps/)).toBeInTheDocument();
  });

  it("renders the tile without a meter", () => {
    const { container } = render(Tile, { data: { status } });
    expect(screen.getByText("Backed up")).toBeInTheDocument();
    expect(screen.getByText(/last 46m ago/)).toBeInTheDocument();
    expect(container.querySelector(".meter")).toBeNull();
    expect(screen.getByText(/recovery window unknown/)).toBeInTheDocument();
  });

  it("health endpoint returns JSON, which Homepage's customapi widget can parse", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
