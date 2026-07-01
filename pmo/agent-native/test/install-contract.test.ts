import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("install contract", () => {
  it("AC-401 pins @agent-native/core exactly and requires Node >=22.22.0", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      engines?: { node?: string };
    };

    expect(pkg.dependencies?.["@agent-native/core"]).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
    expect(pkg.dependencies?.["@agent-native/core"]).not.toMatch(/[~^]/);
    expect(pkg.engines?.node).toBe(">=22.22.0");
  });
});
