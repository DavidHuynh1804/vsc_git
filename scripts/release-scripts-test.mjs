import test from "node:test";
import assert from "node:assert/strict";
import { parseCommit } from "./changelog.mjs";
import { bumpSemver } from "./bump-version.mjs";
import { generateLatestJson } from "./generate-latest-json.mjs";

test("parseCommit parses conventional commit correctly", () => {
  const line = "a1b2c3d4e5|feat(release): support auto-updater|John Doe|2026-10-16";
  const parsed = parseCommit(line);

  assert.equal(parsed.sha, "a1b2c3d");
  assert.equal(parsed.type, "feat");
  assert.equal(parsed.scope, "release");
  assert.equal(parsed.breaking, false);
  assert.equal(parsed.description, "support auto-updater");
});

test("parseCommit parses breaking change commit", () => {
  const line = "1234567890|fix(api)!: remove deprecated endpoints|Jane Doe|2026-10-16";
  const parsed = parseCommit(line);

  assert.equal(parsed.breaking, true);
  assert.equal(parsed.type, "fix");
  assert.equal(parsed.scope, "api");
});

test("parseCommit ignores merge commits", () => {
  const line = "1234567890|Merge pull request #18 from repo/branch|Admin|2026-10-16";
  const parsed = parseCommit(line);

  assert.equal(parsed, null);
});

test("bumpSemver bumps patch, minor, major correctly", () => {
  assert.equal(bumpSemver("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpSemver("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpSemver("0.1.0", "major"), "1.0.0");
  assert.equal(bumpSemver("0.1.0", "1.2.3"), "1.2.3");
});

test("bumpSemver rejects invalid versions", () => {
  assert.throws(() => bumpSemver("0.1.0", "invalid-version"));
});

test("generateLatestJson generates manifest with correct structure", () => {
  const manifest = generateLatestJson({
    version: "0.1.0",
    notes: "Initial release",
    pubDate: "2026-10-16T00:00:00.000Z",
    artifactsDir: "non-existent-dir",
  });

  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.notes, "Initial release");
  assert.deepEqual(manifest.platforms, {});
});
