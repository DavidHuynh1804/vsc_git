import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CreatePrDialog, resolveAiEndpoint } from "./CreatePrDialog";
import { MockHostingDataSource } from "@/integrations/hosting";
import { MockAiDataSource, LocalStorageAiConsentDataSource } from "@/integrations/ai";

describe("CreatePrDialog", () => {
  it("renders when open and shows base and head branches", async () => {
    const hostDs = new MockHostingDataSource();
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/my-feature"
        defaultBaseBranch="main"
        hostingDataSource={hostDs}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("feat/my-feature")).toBeInTheDocument();
  });

  it("shows unpushed warning when head branch is not pushed and allows pushing first", async () => {
    const hostDs = new MockHostingDataSource();
    // Default mock has "main" pushed, but "feat/unpushed" is not pushed
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/unpushed"
        defaultBaseBranch="main"
        hostingDataSource={hostDs}
      />
    );

    const warning = await screen.findByTestId("unpushed-warning");
    expect(warning).toBeInTheDocument();
    expect(screen.getByText(/chưa được push lên remote/i)).toBeInTheDocument();

    const pushBtn = screen.getByRole("button", { name: /Push trước/i });
    fireEvent.click(pushBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("unpushed-warning")).not.toBeInTheDocument();
    });
    expect(await hostDs.checkBranchPushed("feat/unpushed")).toBe(true);
  });

  it("gates AI generation on repo consent, then streams PR body and sets title", async () => {
    const hostDs = new MockHostingDataSource();
    const aiDs = new MockAiDataSource();
    const consentDs = new LocalStorageAiConsentDataSource();
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/my-feature"
        defaultBaseBranch="main"
        hostingDataSource={hostDs}
        aiDataSource={aiDs}
        aiConsentDataSource={consentDs}
        repoPath="/projects/test-repo"
      />
    );

    const aiBtn = screen.getByRole("button", { name: /Generate with AI/i });
    fireEvent.click(aiBtn);

    // Consent dialog must appear
    expect(await screen.findByRole("dialog", { name: /AI Consent/i })).toBeInTheDocument();
    expect(screen.getByText(/Claude/i)).toBeInTheDocument();
    // Crucial check: consent dialog shows AI endpoint, NOT git host
    expect(screen.getByText(/api\.anthropic\.com/i)).toBeInTheDocument();
    // Confirm consent
    const continueBtn = screen.getByRole("button", { name: /Tiếp tục/i });
    fireEvent.click(continueBtn);

    // Consent must now be remembered for this repo
    expect(consentDs.hasConsent("/projects/test-repo", "claude")).toBe(true);

    const textarea = screen.getByPlaceholderText(/Write PR description/i);
    await waitFor(() => {
      expect(textarea).not.toHaveValue("");
    });

    expect(textarea.innerHTML || (textarea as HTMLTextAreaElement).value).toContain(
      "Summary of Changes"
    );
    const titleInput = screen.getByPlaceholderText(/feat\(auth\)/i);
    expect(titleInput).toHaveValue("feat: integrate changes from feat/my-feature into main");
  });

  it("disallows AI consent and shows error when repoPath is empty", async () => {
    const hostDs = new MockHostingDataSource();
    const aiDs = new MockAiDataSource();
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/my-feature"
        hostingDataSource={hostDs}
        aiDataSource={aiDs}
        repoPath=""
      />
    );

    const aiBtn = screen.getByRole("button", { name: /Generate with AI/i });
    fireEvent.click(aiBtn);

    expect(screen.queryByRole("dialog", { name: /AI Consent/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Cannot generate PR description with AI: no repository is currently opened/i)
    ).toBeInTheDocument();
  });

  it("resolves AI endpoints accurately based on provider and custom baseUrl", () => {
    expect(resolveAiEndpoint("claude")).toBe("api.anthropic.com");
    expect(resolveAiEndpoint("openai")).toBe("api.openai.com");
    expect(resolveAiEndpoint("ollama")).toBe("localhost:11434");
    expect(resolveAiEndpoint("openai", "https://proxy.internal.corp/v1")).toBe(
      "proxy.internal.corp"
    );
  });

  it("searches reviewers with debounce and adds reviewer chip", async () => {
    const hostDs = new MockHostingDataSource();
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/my-feature"
        hostingDataSource={hostDs}
      />
    );

    const reviewerInput = screen.getByPlaceholderText(/Type username or name/i);
    fireEvent.change(reviewerInput, { target: { value: "alice" } });

    // Reviewer suggestion should appear after debounce
    const option = await screen.findByRole("option");
    expect(option).toHaveTextContent("@alice");

    fireEvent.click(option);

    // Chip should now be displayed
    expect(screen.getByText("@alice")).toBeInTheDocument();

    // Remove reviewer chip
    const removeBtn = screen.getByRole("button", { name: /Remove reviewer alice/i });
    fireEvent.click(removeBtn);
    expect(screen.queryByText("@alice")).not.toBeInTheDocument();
  });

  it("submits PR and displays the created PR link", async () => {
    const hostDs = new MockHostingDataSource();
    render(
      <CreatePrDialog
        isOpen={true}
        onClose={vi.fn()}
        currentBranch="feat/my-feature"
        defaultBaseBranch="main"
        hostingDataSource={hostDs}
      />
    );

    const titleInput = screen.getByPlaceholderText(/feat\(auth\)/i);
    fireEvent.change(titleInput, { target: { value: "feat: implement settings view" } });

    const submitBtn = screen.getByRole("button", { name: /Create Pull Request/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Created!/i)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("pull")
    );
  });
});
