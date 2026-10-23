import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROUTES = join(process.cwd(), "src", "routes");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const serverFiles = walk(ROUTES).filter(
  (file) => file.endsWith("+server.js") || file.endsWith("+page.server.js"),
);

const FORBIDDEN = ["POST", "PUT", "PATCH", "DELETE"];

describe("no write path", () => {
  it("finds the route modules", () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it("exports no mutating HTTP handler anywhere", async () => {
    for (const file of serverFiles) {
      const mod = await import(pathToFileURL(file).href);
      for (const method of FORBIDDEN) {
        expect(Object.keys(mod), `${file} exports ${method}`).not.toContain(
          method,
        );
      }
    }
  });

  it("every +server.js exposes GET and nothing else that writes", async () => {
    const endpointFiles = serverFiles.filter((f) => f.endsWith("+server.js"));
    for (const file of endpointFiles) {
      const mod = await import(pathToFileURL(file).href);
      expect(Object.keys(mod)).toContain("GET");
      const handlers = Object.keys(mod).filter((key) => /^[A-Z]+$/.test(key));
      expect(handlers).toEqual(["GET"]);
    }
  });

  it("page server loads only export load", async () => {
    const pageFiles = serverFiles.filter((f) => f.endsWith("+page.server.js"));
    for (const file of pageFiles) {
      const mod = await import(pathToFileURL(file).href);
      const actions = Object.keys(mod).filter((key) => key === "actions");
      expect(actions).toEqual([]);
    }
  });
});
