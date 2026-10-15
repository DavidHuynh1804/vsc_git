import { describe, it, expect } from "vitest";
import { filterCommands, PaletteCommand } from "./CommandPalette";

describe("filterCommands", () => {
  const mockCommands: PaletteCommand[] = [
    {
      id: "open-repo",
      category: "Git",
      title: "Open Repository...",
      action: () => {},
    },
    {
      id: "toggle-git-output",
      category: "Git",
      title: "Toggle Git Output",
      action: () => {},
    },
    {
      id: "view-changes",
      category: "View",
      title: "Show Source Control",
      action: () => {},
    },
    {
      id: "view-graph",
      category: "View",
      title: "Show Git Graph",
      action: () => {},
    },
    {
      id: "switch-theme",
      category: "Preferences",
      title: "Switch Theme",
      action: () => {},
    },
    {
      id: "view-settings",
      category: "Preferences",
      title: "Open Settings",
      action: () => {},
    },
    {
      id: "create-pull-request",
      category: "Git",
      title: "Create Pull Request",
      action: () => {},
    },
  ];

  it("returns all commands when query is empty", () => {
    const results = filterCommands(mockCommands, "");
    expect(results.length).toBe(mockCommands.length);
  });

  it("filters commands by category", () => {
    const results = filterCommands(mockCommands, "git");
    expect(results.length).toBe(4); // 3 "Git" + 1 "View: Show Git Graph"
    expect(results.some((r) => r.id === "open-repo")).toBe(true);
    expect(results.some((r) => r.id === "toggle-git-output")).toBe(true);
  });

  it("filters commands by title", () => {
    const results = filterCommands(mockCommands, "theme");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("switch-theme");
  });

  it("handles case-insensitive matching", () => {
    const resultsLower = filterCommands(mockCommands, "source control");
    const resultsUpper = filterCommands(mockCommands, "SOURCE CONTROL");
    expect(resultsLower.length).toBe(1);
    expect(resultsUpper.length).toBe(1);
    expect(resultsLower[0].id).toBe("view-changes");
  });

  it("returns empty array when no matches are found", () => {
    const results = filterCommands(mockCommands, "non-existent-command-xyz");
    expect(results.length).toBe(0);
  });

  it("finds settings and pull request commands", () => {
    const settingsResults = filterCommands(mockCommands, "settings");
    expect(settingsResults.length).toBe(1);
    expect(settingsResults[0].id).toBe("view-settings");

    const prResults = filterCommands(mockCommands, "pull request");
    expect(prResults.length).toBe(1);
    expect(prResults[0].id).toBe("create-pull-request");
  });
});
