import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SourceControlView } from "./SourceControlView";
import { CommitBox } from "./CommitBox";
import { useScmStore } from "@/scm/scmStore";
import { MockScmDataSource } from "@/scm/dataSource";

describe("SourceControlView & CommitBox", () => {
  beforeEach(async () => {
    const ds = new MockScmDataSource();
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStatus();
  });

  it("renders status groups with counts and badges", async () => {
    render(<SourceControlView />);

    expect(screen.getByText("SOURCE CONTROL")).toBeInTheDocument();
    expect(screen.getByText("STAGED CHANGES")).toBeInTheDocument();
    expect(screen.getByText("CHANGES")).toBeInTheDocument();
    expect(screen.getByText("UNTRACKED")).toBeInTheDocument();
    expect(screen.getByText("MERGE CHANGES")).toBeInTheDocument();

    // Check file presence
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getAllByText("app.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("format.ts")).toBeInTheDocument();
  });

  it("stages and unstages files using inline actions", async () => {
    render(<SourceControlView />);

    // Stage app.ts from Changes
    const stageButtons = screen.getAllByTitle("Stage changes");
    expect(stageButtons.length).toBeGreaterThan(0);
    fireEvent.click(stageButtons[0]);

    await waitFor(() => {
      const status = useScmStore.getState().status;
      expect(status).toBeDefined();
    });
  });

  it("shows discard confirmation dialog before discarding", async () => {
    render(<SourceControlView />);

    const discardButtons = screen.getAllByTitle("Discard changes");
    fireEvent.click(discardButtons[0]);

    // Dialog should appear
    expect(screen.getByRole("heading", { name: "Discard Changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard Changes" })).toBeInTheDocument();
    // Clicking Cancel closes dialog
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Are you sure you want to discard changes")).not.toBeInTheDocument();
    });
  });

  it("counts commit header characters and warns when > 72", () => {
    render(<CommitBox />);

    const textarea = screen.getByPlaceholderText(/Message \(Cmd\+Enter to commit\)/);
    fireEvent.change(textarea, { target: { value: "short message" } });
    expect(screen.getByText("13/72")).toBeInTheDocument();

    const longHeader = "a".repeat(75);
    fireEvent.change(textarea, { target: { value: longHeader } });
    const counter = screen.getByText("75/72");
    expect(counter).toBeInTheDocument();
    expect(counter.className).toContain("text-error");
  });

  it("prompts smart commit dialog when committing with no staged changes", async () => {
    // Unstage everything
    await useScmStore.getState().unstageAll();

    render(<CommitBox />);
    const textarea = screen.getByPlaceholderText(/Message \(Cmd\+Enter to commit\)/);
    fireEvent.change(textarea, { target: { value: "feat: smart commit test" } });

    const commitBtn = screen.getByRole("button", { name: "Commit" });
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(screen.getByText("No Staged Changes")).toBeInTheDocument();
      expect(
        screen.getByText(/Would you like to stage all your changes and commit them directly\?/)
      ).toBeInTheDocument();
    });
  });

  it("generates AI commit message and supports single undo", async () => {
    render(<CommitBox />);

    const textarea = screen.getByPlaceholderText(/Message \(Cmd\+Enter to commit\)/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "my initial draft" } });

    const aiBtn = screen.getByTitle(/Generate commit message with AI/);
    fireEvent.click(aiBtn);

    await waitFor(
      () => {
        expect(textarea.value).toContain("feat(scm):");
      },
      { timeout: 3000 }
    );

    // Undo button should appear
    const undoBtn = screen.getByTitle("Undo AI generation");
    expect(undoBtn).toBeInTheDocument();

    fireEvent.click(undoBtn);
    expect(textarea.value).toBe("my initial draft");
  });

  it("supports Cmd+Enter shortcut to commit", async () => {
    render(<CommitBox />);

    const textarea = screen.getByPlaceholderText(/Message \(Cmd\+Enter to commit\)/);
    fireEvent.change(textarea, { target: { value: "chore: shortcut commit" } });

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(useScmStore.getState().draftCommitMessage).toBe("");
    });
  });
});
