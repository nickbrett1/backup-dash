import { describe, expect, it } from "vitest";
import { isValidSnapshotName, parseSnapshotList } from "../src/lib/nas.js";

const OUTPUT = `There has 3 snapshots of share [restic-target]
GMT-04-2026.10.22-12.08.15
GMT-04-2026.10.23-07.00.31
GMT-04-2026.10.23-07.14.16
`;

describe("NAS snapshot list parsing", () => {
  it("skips the header line", () => {
    const snaps = parseSnapshotList(OUTPUT);
    expect(snaps).toHaveLength(3);
    expect(snaps.map((s) => s.name)).not.toContain(
      "There has 3 snapshots of share [restic-target]",
    );
  });

  it("sorts oldest first", () => {
    const snaps = parseSnapshotList(OUTPUT);
    expect(snaps[0].name).toBe("GMT-04-2026.10.22-12.08.15");
    expect(snaps.at(-1).name).toBe("GMT-04-2026.10.23-07.14.16");
  });

  it("ignores a blank or garbage line rather than inventing a snapshot", () => {
    expect(parseSnapshotList("header\n\nnot-a-snapshot\n")).toHaveLength(0);
  });

  // The embedded GMT-04 is a NAS artefact and is wrong half the year. In
  // January the true offset is -05:00.
  it("does not use the embedded offset: October is 07:14 EDT = 11:14Z", () => {
    const [snap] = parseSnapshotList("GMT-04-2026.10.23-07.14.16\n");
    expect(snap.at).toBe("2026-10-23T11:14:16.000Z");
    expect(snap.embedded_offset).toBe("-04");
  });

  it("does not use the embedded offset: January is 07:14 EST = 12:14Z", () => {
    const [snap] = parseSnapshotList("GMT-04-2027.01.15-07.14.16\n");
    expect(snap.at).toBe("2027-01-15T12:14:16.000Z");
  });

  it("validates names before they reach a shell", () => {
    expect(isValidSnapshotName("GMT-04-2026.10.23-07.14.16")).toBe(true);
    expect(isValidSnapshotName("GMT-04-2026.10.23-07.14.16; rm -rf /")).toBe(
      false,
    );
    expect(isValidSnapshotName("$(whoami)")).toBe(false);
  });
});
