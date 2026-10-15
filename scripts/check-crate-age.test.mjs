import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCargoLock,
  diffPackages,
  parseAllowlist,
  evaluateVersionAge,
  findSafeVersion,
  mapConcurrent,
} from "./check-crate-age.mjs";

test("parseCargoLock: empty or invalid input", () => {
  assert.deepEqual(parseCargoLock(""), []);
  assert.deepEqual(parseCargoLock(null), []);
  assert.deepEqual(parseCargoLock(undefined), []);
  assert.deepEqual(parseCargoLock("# Just comments\nversion = 4"), []);
});

test("parseCargoLock: parses standard packages with sources", () => {
  const toml = `
version = 4

[[package]]
name = "Inflector"
version = "0.11.4"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "fe438c63458706e03479442743baae6c88256498e6431708f6dfc520a26515d3"

[[package]]
name = "local-crate"
version = "0.1.0"
dependencies = [
 "Inflector",
]

[[package]]
name = "git-pkg"
version = "0.2.0"
source = "git+https://github.com/foo/bar#commit"
`;

  const pkgs = parseCargoLock(toml);
  assert.equal(pkgs.length, 3);

  assert.deepEqual(pkgs[0], {
    name: "Inflector",
    version: "0.11.4",
    source: "registry+https://github.com/rust-lang/crates.io-index",
  });

  assert.deepEqual(pkgs[1], {
    name: "local-crate",
    version: "0.1.0",
    source: null,
  });

  assert.deepEqual(pkgs[2], {
    name: "git-pkg",
    version: "0.2.0",
    source: "git+https://github.com/foo/bar#commit",
  });
});

test("parseCargoLock: parses multiple versions of same package name", () => {
  const toml = `
[[package]]
name = "base64"
version = "0.21.7"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "base64"
version = "0.22.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;

  const pkgs = parseCargoLock(toml);
  assert.equal(pkgs.length, 2);
  assert.equal(pkgs[0].name, "base64");
  assert.equal(pkgs[0].version, "0.21.7");
  assert.equal(pkgs[1].name, "base64");
  assert.equal(pkgs[1].version, "0.22.1");
});

test("diffPackages: identical packages produce empty diff", () => {
  const base = [
    {
      name: "serde",
      version: "1.0.200",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "tokio",
      version: "1.40.0",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
  ];
  const current = [...base];

  const diff = diffPackages(current, base);
  assert.equal(diff.length, 0);
});

test("diffPackages: detects new crates.io packages and version bumps", () => {
  const base = [
    {
      name: "serde",
      version: "1.0.200",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "tokio",
      version: "1.39.0",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
  ];

  const current = [
    {
      name: "serde",
      version: "1.0.200",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "tokio",
      version: "1.40.0", // bumped
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "keyring-core", // brand new
      version: "1.0.1",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "workspace-member", // non-crates.io ignored
      version: "0.1.0",
      source: null,
    },
  ];

  const diff = diffPackages(current, base);
  assert.equal(diff.length, 2);
  assert.deepEqual(
    diff.map((p) => `${p.name}@${p.version}`).sort(),
    ["keyring-core@1.0.1", "tokio@1.40.0"]
  );
});

test("diffPackages: without base returns all crates.io packages", () => {
  const current = [
    {
      name: "serde",
      version: "1.0.200",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
    {
      name: "local-lib",
      version: "0.1.0",
      source: null,
    },
  ];

  const diff = diffPackages(current, null);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].name, "serde");
});

test("parseAllowlist: parses entries and ignores comments / empty lines", () => {
  const content = `
# Header comment
keyring-core@1.0.1 # Critical CVE fix
tokio@1.48.0#No space before hash
some-crate@0.2.0

# Another comment
`;

  const allowed = parseAllowlist(content);
  assert.equal(allowed.size, 3);
  assert.equal(allowed.get("keyring-core@1.0.1"), "Critical CVE fix");
  assert.equal(allowed.get("tokio@1.48.0"), "No space before hash");
  assert.equal(allowed.get("some-crate@0.2.0"), "Allowlisted");
  assert.equal(allowed.has("nonexistent@1.0.0"), false);
});

test("evaluateVersionAge: correctly flags young releases and yanked crates", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();

  // 10 days old -> passes 7 day policy
  const tenDaysOld = {
    created_at: "2026-10-06T12:00:00Z",
    yanked: false,
  };
  const res1 = evaluateVersionAge(tenDaysOld, 7, now);
  assert.equal(res1.ok, true);
  assert.equal(Math.round(res1.ageDays), 10);

  // 3 days old -> fails 7 day policy
  const threeDaysOld = {
    created_at: "2026-10-13T12:00:00Z",
    yanked: false,
  };
  const res2 = evaluateVersionAge(threeDaysOld, 7, now);
  assert.equal(res2.ok, false);
  assert.match(res2.reason, /Released 3\.0d ago \(< 7d\)/);

  // 20 days old but yanked -> fails
  const yankedOld = {
    created_at: "2026-09-20T12:00:00Z",
    yanked: true,
  };
  const res3 = evaluateVersionAge(yankedOld, 7, now);
  assert.equal(res3.ok, false);
  assert.match(res3.reason, /yanked/);

  // Missing or malformed created_at
  const malformed = { created_at: "invalid-date", yanked: false };
  const res4 = evaluateVersionAge(malformed, 7, now);
  assert.equal(res4.ok, false);
});

test("findSafeVersion: selects newest non-yanked eligible version", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();

  const versions = [
    { num: "1.0.1", created_at: "2026-10-13T00:00:00Z", yanked: false }, // 3.5d old (violator)
    { num: "1.0.0", created_at: "2026-04-21T00:00:00Z", yanked: false }, // safe!
    { num: "0.7.4", created_at: "2026-02-27T00:00:00Z", yanked: false }, // safe but older
  ];

  const safe = findSafeVersion(versions, "1.0.1", 7, now);
  assert.equal(safe, "1.0.0");
});

test("findSafeVersion: skips yanked safe-age versions", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();

  const versions = [
    { num: "2.0.0", created_at: "2026-10-14T00:00:00Z", yanked: false }, // 2d old
    { num: "1.9.9", created_at: "2026-05-01T00:00:00Z", yanked: true },  // old but yanked
    { num: "1.9.8", created_at: "2026-04-01T00:00:00Z", yanked: false }, // safe!
  ];

  const safe = findSafeVersion(versions, "2.0.0", 7, now);
  assert.equal(safe, "1.9.8");
});

test("findSafeVersion: returns null if no eligible version exists", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();

  const versions = [
    { num: "0.1.0", created_at: "2026-10-15T00:00:00Z", yanked: false }, // only version, 1d old
  ];

  const safe = findSafeVersion(versions, "0.1.0", 7, now);
  assert.equal(safe, null);
});

test("mapConcurrent: limits concurrency and preserves results order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;

  const items = [10, 20, 30, 40, 50, 60];
  const results = await mapConcurrent(items, 3, async (ms, idx) => {
    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    return idx * 2;
  });

  assert.equal(maxInFlight <= 3, true);
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
});
