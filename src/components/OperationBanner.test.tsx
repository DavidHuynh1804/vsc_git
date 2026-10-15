import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OperationBanner } from "./OperationBanner";
import { NormalizedOperationState } from "@/m3/types";

describe("OperationBanner", () => {
  it("renders null when state is None or inactive", () => {
    const { container } = render(
      <OperationBanner
        operationState={{ kind: "None", isActive: false }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders rebasing banner with step and branch names", () => {
    const state: NormalizedOperationState = {
      kind: "Rebasing",
      isActive: true,
      step: 3,
      total: 7,
      onto: "main",
      branch: "feat-m3",
    };

    render(<OperationBanner operationState={state} hasConflict={false} />);
    expect(
      screen.getByText(/Rebasing `feat-m3` onto `main` — bước 3\/7/i)
    ).toBeInTheDocument();
  });

  it("renders merging banner with commit sha", () => {
    const state: NormalizedOperationState = {
      kind: "Merging",
      isActive: true,
      commit_id: "abcdef1234567890",
    };

    render(<OperationBanner operationState={state} hasConflict={false} />);
    expect(screen.getByText(/Merging commit `abcdef1`/i)).toBeInTheDocument();
  });

  it("locks Continue button when conflict is present", () => {
    const state: NormalizedOperationState = {
      kind: "Rebasing",
      isActive: true,
      step: 2,
      total: 5,
      onto: "main",
      branch: "feat",
    };

    render(<OperationBanner operationState={state} hasConflict={true} />);

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
  });

  it("enables Continue button when there are no conflicts", () => {
    const state: NormalizedOperationState = {
      kind: "Rebasing",
      isActive: true,
      step: 2,
      total: 5,
      onto: "main",
      branch: "feat",
    };

    const onContinue = vi.fn();
    render(
      <OperationBanner
        operationState={state}
        hasConflict={false}
        onContinue={onContinue}
      />
    );

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).not.toBeDisabled();

    fireEvent.click(continueBtn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("triggers onSkip when Skip button is clicked", () => {
    const state: NormalizedOperationState = {
      kind: "Rebasing",
      isActive: true,
      step: 2,
      total: 5,
      onto: "main",
      branch: "feat",
    };

    const onSkip = vi.fn();
    render(
      <OperationBanner
        operationState={state}
        hasConflict={false}
        onSkip={onSkip}
      />
    );

    const skipBtn = screen.getByRole("button", { name: /skip/i });
    fireEvent.click(skipBtn);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("opens ConfirmDialog on Abort and confirms abort", () => {
    const state: NormalizedOperationState = {
      kind: "Rebasing",
      isActive: true,
      step: 2,
      total: 5,
      onto: "main",
      branch: "feat",
    };

    const onAbort = vi.fn();
    render(
      <OperationBanner
        operationState={state}
        hasConflict={false}
        onAbort={onAbort}
      />
    );

    const abortBtn = screen.getByRole("button", { name: /abort/i });
    fireEvent.click(abortBtn);

    // Dialog should be open
    expect(screen.getByText("Abort Git Operation")).toBeInTheDocument();
    // Confirm button in dialog
    const dialog = screen.getByRole("dialog");
    const confirmBtn = dialog.querySelector("button.bg-error") ?? dialog.querySelectorAll("button")[1];
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
