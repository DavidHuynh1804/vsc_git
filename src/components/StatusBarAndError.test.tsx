import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { ErrorToast, getHintForErrorKind } from "./ErrorToast";
import { useScmStore } from "@/scm/scmStore";
import { MockScmDataSource } from "@/scm/dataSource";
import { AppError } from "@/scm/types";

describe("StatusBar jobs & sync", () => {
  beforeEach(async () => {
    const ds = new MockScmDataSource();
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStatus();
  });

  it("renders branch and sync buttons", () => {
    render(<StatusBar />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText(/↓0 ↑1/)).toBeInTheDocument();
  });

  it("renders running background job with title, percentage and cancel button", () => {
    useScmStore.setState({
      activeJobs: new Map([
        [
          "job-1",
          {
            jobId: "job-1",
            title: "Fetching origin",
            percent: 45,
            cancelable: true,
          },
        ],
      ]),
    });

    render(<StatusBar />);
    expect(screen.getByText(/Fetching origin \(45%\)/)).toBeInTheDocument();

    const cancelBtn = screen.getByTitle("Cancel job");
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
  });
});

describe("ErrorToast with Spec 12 hints", () => {
  it("provides hint suggestions for error kinds", () => {
    const dirtyHint = getHintForErrorKind("DirtyWorktree");
    expect(dirtyHint?.actionLabel).toBe("Stash & Continue");

    const hookHint = getHintForErrorKind("HookFailed");
    expect(hookHint?.actionLabel).toBe("Commit with --no-verify");

    const lockHint = getHintForErrorKind("IndexLocked");
    expect(lockHint?.actionLabel).toBe("Retry");
  });

  it("renders ErrorToast with hint action button and expands stderr details", async () => {
    const onClose = vi.fn();
    const error: AppError = {
      kind: "DirtyWorktree",
      message: "Cannot checkout because working tree has modifications",
      git_stderr: "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\nPlease commit your changes or stash them before you switch branches.",
    };

    render(<ErrorToast error={error} onClose={onClose} />);

    // Verify error kind and message
    expect(
      screen.getByText(/DirtyWorktree: Cannot checkout because working tree has modifications/)
    ).toBeInTheDocument();

    // Verify action button
    expect(screen.getByRole("button", { name: "Stash & Continue" })).toBeInTheDocument();

    // Verify Chi tiết button expands stderr
    const detailsBtn = screen.getByText("Chi tiết");
    fireEvent.click(detailsBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Your local changes to the following files would be overwritten/)
      ).toBeInTheDocument();
    });

    // Clicking Stash & Continue triggers action and closes
    const actionBtn = screen.getByRole("button", { name: "Stash & Continue" });
    fireEvent.click(actionBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
