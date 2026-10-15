import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InteractiveRebaseView } from "./InteractiveRebaseView";
import { validateRebaseTodo, moveEntry, serializeRebaseTodo } from "./rebaseUtils";
import { RebaseTodoEntry } from "@/m3/types";
import { useM3Store } from "@/m3/m3Store";
import { MockM3DataSource } from "@/m3/dataSource";

describe("Rebase Utils", () => {
  it("validates that first commit cannot be squash or fixup", () => {
    const invalidSquash: RebaseTodoEntry[] = [
      { action: "squash", sha: "1111111", subject: "commit 1" },
      { action: "pick", sha: "2222222", subject: "commit 2" },
    ];
    expect(validateRebaseTodo(invalidSquash).isValid).toBe(false);

    const invalidFixup: RebaseTodoEntry[] = [
      { action: "fixup", sha: "1111111", subject: "commit 1" },
    ];
    expect(validateRebaseTodo(invalidFixup).isValid).toBe(false);

    const valid: RebaseTodoEntry[] = [
      { action: "pick", sha: "1111111", subject: "commit 1" },
      { action: "squash", sha: "2222222", subject: "commit 2" },
    ];
    expect(validateRebaseTodo(valid).isValid).toBe(true);
  });

  it("moves entries reordering correctly", () => {
    const entries: RebaseTodoEntry[] = [
      { action: "pick", sha: "111", subject: "one" },
      { action: "pick", sha: "222", subject: "two" },
      { action: "pick", sha: "333", subject: "three" },
    ];

    const reordered = moveEntry(entries, 0, 2);
    expect(reordered.map((e) => e.sha)).toEqual(["222", "333", "111"]);
  });

  it("serializes rebase todo entries to standard git format", () => {
    const entries: RebaseTodoEntry[] = [
      { action: "pick", sha: "1a2b3c4", subject: "first" },
      { action: "squash", sha: "2b3c4d5", subject: "second" },
    ];
    const serialized = serializeRebaseTodo(entries);
    expect(serialized).toBe("pick 1a2b3c4 first\nsquash 2b3c4d5 second\n");
  });
});

describe("InteractiveRebaseView Component", () => {
  let mockDs: MockM3DataSource;

  const testEntries: RebaseTodoEntry[] = [
    { action: "pick", sha: "1111111", subject: "first commit" },
    { action: "pick", sha: "2222222", subject: "second commit" },
    { action: "pick", sha: "3333333", subject: "third commit" },
  ];

  beforeEach(() => {
    mockDs = new MockM3DataSource();
    useM3Store.getState().setDataSource(mockDs);
  });

  it("renders rebase commits and actions", () => {
    render(
      <InteractiveRebaseView
        baseSha="main"
        initialEntries={testEntries}
      />
    );

    expect(screen.getByText("Interactive Rebase")).toBeInTheDocument();
    expect(screen.getByText("onto main")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("third commit")).toBeInTheDocument();
  });

  it("displays validation error and disables Start Rebase when first action is squash", () => {
    render(
      <InteractiveRebaseView
        initialEntries={testEntries}
      />
    );

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "squash" } });

    expect(screen.getByText(/Cannot 'squash' the first commit/i)).toBeInTheDocument();
    const startBtn = screen.getByRole("button", { name: /Start Rebase/i });
    expect(startBtn).toBeDisabled();
  });

  it("moves commits up and down using row buttons", () => {
    render(
      <InteractiveRebaseView
        initialEntries={testEntries}
      />
    );

    const moveDownBtns = screen.getAllByTitle(/Move down/i);
    fireEvent.click(moveDownBtns[0]); // Move first commit down to second position

    const commitSubjects = screen
      .getAllByRole("combobox")
      .map((el) => el.closest("div")?.querySelector("span[class*='font-medium']")?.textContent);

    expect(commitSubjects[0]).toBe("second commit");
    expect(commitSubjects[1]).toBe("first commit");
  });

  it("opens edit message dialog and saves new message", async () => {
    render(
      <InteractiveRebaseView
        initialEntries={testEntries}
      />
    );

    const selects = screen.getAllByRole("combobox");
    // Changing action to reword triggers EditMessageDialog
    fireEvent.change(selects[0], { target: { value: "reword" } });

    await waitFor(() => {
      expect(screen.getByText(/Edit Commit Message/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Enter commit message.../i);
    fireEvent.change(textarea, { target: { value: "reworded first commit" } });

    const saveBtn = screen.getByRole("button", { name: /Save Message/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Edit Commit Message/i)).not.toBeInTheDocument();
      expect(screen.getByText("reworded first commit")).toBeInTheDocument();
    });
  });

  it("submits ordered rebase todo list on Start Rebase", async () => {
    const onStart = vi.fn();
    render(
      <InteractiveRebaseView
        initialEntries={testEntries}
        onStart={onStart}
      />
    );

    const startBtn = screen.getByRole("button", { name: /Start Rebase/i });
    expect(startBtn).not.toBeDisabled();

    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStart).toHaveBeenCalledWith(testEntries);
    });
  });

  it("calls onCancel on Cancel button click", () => {
    const onCancel = vi.fn();
    render(
      <InteractiveRebaseView
        initialEntries={testEntries}
        onCancel={onCancel}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
