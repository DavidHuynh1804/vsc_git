import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AiConsentDialog } from "./AiConsentDialog";
import { LocalStorageAiConsentDataSource } from "@/integrations/ai";

describe("AiConsentDialog", () => {
  it("renders prompt with provider and host when open", () => {
    const consentDs = new LocalStorageAiConsentDataSource();
    render(
      <AiConsentDialog
        isOpen={true}
        repoPath="/projects/vsc_git"
        provider="Claude"
        host="api.anthropic.com"
        consentDataSource={consentDs}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Claude/i)).toBeInTheDocument();
    expect(screen.getByText(/api.anthropic.com/i)).toBeInTheDocument();
    expect(screen.getByText(/\/projects\/vsc_git/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tiếp tục/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Huỷ/i })).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    const consentDs = new LocalStorageAiConsentDataSource();
    render(
      <AiConsentDialog
        isOpen={false}
        repoPath="/projects/vsc_git"
        provider="Claude"
        host="api.anthropic.com"
        consentDataSource={consentDs}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onCancel when Huỷ is clicked without granting consent", () => {
    const consentDs = new LocalStorageAiConsentDataSource();
    const handleCancel = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <AiConsentDialog
        isOpen={true}
        repoPath="/projects/repo-a"
        provider="Claude"
        host="api.anthropic.com"
        consentDataSource={consentDs}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Huỷ/i }));

    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
    expect(consentDs.hasConsent("/projects/repo-a", "Claude")).toBe(false);
  });

  it("records consent per repo when Tiếp tục is clicked with remember checked", () => {
    const consentDs = new LocalStorageAiConsentDataSource();
    const handleConfirm = vi.fn();

    const { rerender } = render(
      <AiConsentDialog
        isOpen={true}
        repoPath="/projects/repo-a"
        provider="Claude"
        host="api.anthropic.com"
        consentDataSource={consentDs}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Tiếp tục/i }));

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(consentDs.hasConsent("/projects/repo-a", "Claude")).toBe(true);
    // Other repos must not have consent
    expect(consentDs.hasConsent("/projects/repo-b", "Claude")).toBe(false);

    // Verify unchecking remember does not persist to data source
    const handleConfirm2 = vi.fn();
    rerender(
      <AiConsentDialog
        isOpen={true}
        repoPath="/projects/repo-b"
        provider="Claude"
        host="api.anthropic.com"
        consentDataSource={consentDs}
        onConfirm={handleConfirm2}
        onCancel={vi.fn()}
      />
    );

    const rememberCheckbox = screen.getByLabelText(/Nhớ lựa chọn/i);
    fireEvent.click(rememberCheckbox); // uncheck
    fireEvent.click(screen.getByRole("button", { name: /Tiếp tục/i }));

    expect(handleConfirm2).toHaveBeenCalledTimes(1);
    expect(consentDs.hasConsent("/projects/repo-b", "Claude")).toBe(false);
  });
});
