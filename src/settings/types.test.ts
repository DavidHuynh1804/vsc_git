import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  MockSettingsDataSource,
  validateSetting,
  validateRawSettingsJson,
  isSettingModified,
} from "./types";

describe("Settings Types and Data Source", () => {
  it("provides default settings matching spec", () => {
    expect(DEFAULT_SETTINGS["git.autoFetch"]).toBe(true);
    expect(DEFAULT_SETTINGS["git.autoFetchPeriodSec"]).toBe(180);
    expect(DEFAULT_SETTINGS["ai.provider"]).toBe("claude");
    expect(DEFAULT_SETTINGS["ai.maxDiffTokens"]).toBe(20000);
    expect(DEFAULT_SETTINGS.hosts.length).toBe(2);
  });

  it("validates positive integers, URLs, and globs correctly", () => {
    expect(validateSetting("git.autoFetchPeriodSec", 10).valid).toBe(true);
    expect(validateSetting("git.autoFetchPeriodSec", -5).valid).toBe(false);
    expect(validateSetting("git.autoFetchPeriodSec", 0).valid).toBe(false);

    expect(validateSetting("graph.pageSize", 200).valid).toBe(true);
    expect(validateSetting("graph.pageSize", -1).valid).toBe(false);

    expect(validateSetting("ai.baseUrl", "https://api.openai.com/v1").valid).toBe(true);
    expect(validateSetting("ai.baseUrl", "ftp://example.com").valid).toBe(false);
    expect(validateSetting("ai.baseUrl", "not-a-url").valid).toBe(false);
    expect(validateSetting("ai.baseUrl", null).valid).toBe(true);

    expect(validateSetting("ai.excludeGlobs", ["**/*.lock", "*.min.js"]).valid).toBe(true);
    expect(validateSetting("ai.excludeGlobs", [""]).valid).toBe(false);
    expect(validateSetting("ai.excludeGlobs", ["["]).valid).toBe(false);
    expect(validateSetting("ai.excludeGlobs", ["{unmatched"]).valid).toBe(false);
  });

  it("validates raw JSON string and returns parsed data", () => {
    const validJson = JSON.stringify({
      "git.autoFetch": false,
      "ai.maxDiffTokens": 10000,
    });
    const result = validateRawSettingsJson(validJson);
    expect(result.valid).toBe(true);
    expect(result.data?.["git.autoFetch"]).toBe(false);
    expect(result.data?.["ai.maxDiffTokens"]).toBe(10000);

    const invalidJson = '{"git.autoFetchPeriodSec": -1}';
    const invalidRes = validateRawSettingsJson(invalidJson);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.error).toContain("Must be a positive integer");
    const unknownKeyJson = '{"unknown.key": 123}';
    const unknownRes = validateRawSettingsJson(unknownKeyJson);
    expect(unknownRes.valid).toBe(false);
    expect(unknownRes.error).toContain("Unknown setting key");

    const invalidEnumJson = '{"scm.viewMode": "invalid-mode"}';
    const enumRes = validateRawSettingsJson(invalidEnumJson);
    expect(enumRes.valid).toBe(false);
    expect(enumRes.error).toContain("Must be one of");

    const malformedJson = "{bad_json";
    expect(validateRawSettingsJson(malformedJson).valid).toBe(false);
  });

  it("handles get, patch, reset, and listener notifications in MockSettingsDataSource", async () => {
    const ds = new MockSettingsDataSource();
    const initial = await ds.get();
    expect(initial["git.autoFetch"]).toBe(true);
    expect(isSettingModified("git.autoFetch", initial)).toBe(false);

    let notifiedVal: boolean | undefined;
    const unsub = ds.onChanged((s) => {
      notifiedVal = s["git.autoFetch"];
    });

    const patched = await ds.patch({ "git.autoFetch": false });
    expect(patched["git.autoFetch"]).toBe(false);
    expect(notifiedVal).toBe(false);
    expect(isSettingModified("git.autoFetch", patched)).toBe(true);

    const resetOne = await ds.reset("git.autoFetch");
    expect(resetOne["git.autoFetch"]).toBe(true);
    expect(isSettingModified("git.autoFetch", resetOne)).toBe(false);

    await ds.patch({ "scm.viewMode": "tree" });
    const resetAll = await ds.resetAll();
    expect(resetAll["scm.viewMode"]).toBe("list");

    unsub();
  });
});
