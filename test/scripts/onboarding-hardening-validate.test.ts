// Onboarding hardening validation tests cover secret-safe evidence output.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = "scripts/operations/onboarding-hardening-validate.sh";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-onboarding-hardening-"));
  tempDirs.push(dir);
  return dir;
}

describe("onboarding hardening validation helper", () => {
  it("reports artifact leak locations without echoing secret-shaped content", () => {
    const dir = makeTempDir();
    const artifactPath = join(dir, "proof.txt");
    const secretValue = "sk-test-secret-value-1234567890";
    writeFileSync(
      artifactPath,
      ["safe line", `client_secret = "${secretValue}"`, "another safe line", ""].join("\n"),
    );

    const result = spawnSync("bash", [SCRIPT_PATH, "--artifact", artifactPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("artifact.leak_scan=review-required");
    expect(result.stdout).toContain(`artifact.leak_match=${artifactPath}:2`);
    expect(result.stdout).not.toContain(secretValue);
    expect(result.stdout).not.toContain("client_secret");
  });
});
