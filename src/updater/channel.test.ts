import { describe, it, expect } from "vitest";
import { getUpdaterEndpoint, resolveUpdateChannel } from "./channel";

describe("updater channel resolution", () => {
  it("resolves stable and beta endpoints", () => {
    expect(getUpdaterEndpoint("stable")).toContain("/releases/latest/download/latest.json");
    expect(getUpdaterEndpoint("beta")).toContain("/releases/download/beta/latest.json");
  });

  it("resolves channel from settings", () => {
    expect(resolveUpdateChannel(null)).toBe("stable");
    expect(resolveUpdateChannel({})).toBe("stable");
    expect(resolveUpdateChannel({ update_channel: "beta" })).toBe("beta");
    expect(resolveUpdateChannel({ "update.channel": "beta" })).toBe("beta");
    expect(resolveUpdateChannel({ update_channel: "stable" })).toBe("stable");
  });
});
