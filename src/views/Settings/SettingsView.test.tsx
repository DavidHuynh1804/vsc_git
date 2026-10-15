import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SettingsView } from "./SettingsView";
import { MockSettingsDataSource } from "@/settings/types";
import { MockAiDataSource } from "@/integrations/ai";
import { MockHostingDataSource } from "@/integrations/hosting";

describe("SettingsView", () => {
  it("renders settings sections and loads values from data source", async () => {
    const ds = new MockSettingsDataSource();
    render(<SettingsView dataSource={ds} />);

    expect(await screen.findByText("Git Configuration")).toBeInTheDocument();
    expect(screen.getByText("Auto Fetch")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Auto Fetch" })).toBeChecked();
  });

  it("filters settings based on search query", async () => {
    const ds = new MockSettingsDataSource();
    render(<SettingsView dataSource={ds} />);

    const searchInput = await screen.findByPlaceholderText(/Search settings/i);
    fireEvent.change(searchInput, { target: { value: "autoFetchPeriodSec" } });

    expect(screen.getByText("Auto Fetch Interval (Seconds)")).toBeInTheDocument();
    expect(screen.queryByText("Side By Side Diff")).not.toBeInTheDocument();
  });

  it("shows modified badge and allows resetting a setting", async () => {
    const ds = new MockSettingsDataSource({ "git.autoFetch": false });
    render(<SettingsView dataSource={ds} />);

    // Since git.autoFetch default is true, false will show "Modified"
    const modifiedBadges = await screen.findAllByText("Modified");
    expect(modifiedBadges.length).toBeGreaterThan(0);

    const resetBtn = screen.getByTitle("Reset to default");
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    });
  });

  it("validates positive integers and shows error", async () => {
    const ds = new MockSettingsDataSource();
    render(<SettingsView dataSource={ds} />);

    const searchInput = await screen.findByPlaceholderText(/Search settings/i);
    fireEvent.change(searchInput, { target: { value: "autoFetchPeriodSec" } });

    const numberInput = screen.getByRole("spinbutton", {
      name: "Auto Fetch Interval (Seconds)",
    });
    fireEvent.change(numberInput, { target: { value: "-5" } });

    expect(await screen.findByText("Must be a positive integer")).toBeInTheDocument();
  });

  it("switches to raw JSON editor and applies valid edits", async () => {
    const ds = new MockSettingsDataSource();
    render(<SettingsView dataSource={ds} />);

    const openJsonBtn = await screen.findByRole("button", { name: /Open JSON/i });
    fireEvent.click(openJsonBtn);

    const textarea = screen.getByRole("textbox", { name: /Raw settings JSON editor/i });
    expect(textarea).toBeInTheDocument();

    // Valid edit
    const current = await ds.get();
    const updated = { ...current, "git.autoFetch": false };
    fireEvent.change(textarea, { target: { value: JSON.stringify(updated) } });

    const applyBtn = screen.getByRole("button", { name: /Apply JSON Changes/i });
    fireEvent.click(applyBtn);

    await waitFor(async () => {
      const saved = await ds.get();
      expect(saved["git.autoFetch"]).toBe(false);
    });
  });

  it("displays validation error on invalid raw JSON", async () => {
    const ds = new MockSettingsDataSource();
    render(<SettingsView dataSource={ds} />);

    const openJsonBtn = await screen.findByRole("button", { name: /Open JSON/i });
    fireEvent.click(openJsonBtn);

    const textarea = screen.getByRole("textbox", { name: /Raw settings JSON editor/i });
    fireEvent.change(textarea, { target: { value: "{ invalid json" } });

    const applyBtn = screen.getByRole("button", { name: /Apply JSON Changes/i });
    fireEvent.click(applyBtn);

    expect(
      await screen.findByText(/Expected property name/i)
    ).toBeInTheDocument();
  });

  it("verifies AI API key is cleared from input and never exposed in settings store", async () => {
    const ds = new MockSettingsDataSource();
    const aiDs = new MockAiDataSource();
    render(<SettingsView dataSource={ds} aiDataSource={aiDs} />);

    // Switch to AI section
    const aiNav = await screen.findByRole("button", { name: /AI Assistance/i });
    fireEvent.click(aiNav);

    const apiKeyInput = screen.getByPlaceholderText(/Enter claude API key/i);
    fireEvent.change(apiKeyInput, { target: { value: "sk-ant-test-secret-12345" } });

    const saveKeyBtn = screen.getByRole("button", { name: /Save Key/i });
    fireEvent.click(saveKeyBtn);

    expect(await screen.findByText(/securely stored in system keyring/i)).toBeInTheDocument();
    // Input must be cleared
    expect(apiKeyInput).toHaveValue("");

    // Crucial check: settings in store must NOT contain the secret API key anywhere
    const storedSettings = await ds.get();
    const serialized = JSON.stringify(storedSettings);
    expect(serialized).not.toContain("sk-ant-test-secret-12345");
  });

  it("tests host connection and displays missing scope warnings per Spec 9.2", async () => {
    const ds = new MockSettingsDataSource();
    const hostDs = new MockHostingDataSource();
    // Simulate user having only read:user, missing "repo"
    hostDs.setUserScopes("github.com", ["read:user"]);

    render(<SettingsView dataSource={ds} hostingDataSource={hostDs} />);

    // Switch to Hosts section
    const hostsNav = await screen.findByRole("button", { name: /Hosting & Remotes/i });
    fireEvent.click(hostsNav);

    const testConnButtons = screen.getAllByRole("button", { name: /Test Connection/i });
    fireEvent.click(testConnButtons[0]);

    expect(await screen.findByText(/Authenticated as: octocat/i)).toBeInTheDocument();
    expect(screen.getByText(/Warning: Missing required permissions!/i)).toBeInTheDocument();
    expect(screen.getByText(/repo/i)).toBeInTheDocument();
  });
});
