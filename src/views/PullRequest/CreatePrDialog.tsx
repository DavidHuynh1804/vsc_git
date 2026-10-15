import React, { useState, useEffect, useRef } from "react";
import { HostConfig } from "@/bindings";
import {
  HostingDataSource,
  AiDataSource,
  AiConsentDataSource,
  Reviewer,
  PullRequestResult,
  CiState,
} from "@/integrations/types";
import { defaultHostingDataSource } from "@/integrations/hosting";
import { defaultAiDataSource, defaultAiConsentDataSource } from "@/integrations/ai";
import { CiBadge } from "@/components/CiBadge";
import { AiConsentDialog } from "@/views/Settings/AiConsentDialog";
import {
  GitPullRequest,
  Sparkles,
  AlertTriangle,
  UploadCloud,
  Check,
  X,
  ExternalLink,
  UserPlus,
  Tag,
  Loader2,
} from "lucide-react";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentBranch?: string;
  defaultBaseBranch?: string;
  hostingDataSource?: HostingDataSource;
  aiDataSource?: AiDataSource;
  host?: HostConfig;
  aiConsentDataSource?: AiConsentDataSource;
  repoPath?: string;
  provider?: string;
}

export const CreatePrDialog: React.FC<CreatePrDialogProps> = ({
  isOpen,
  onClose,
  currentBranch = "main",
  defaultBaseBranch = "main",
  hostingDataSource = defaultHostingDataSource,
  aiDataSource = defaultAiDataSource,
  host = {
    host: "github.com",
    kind: "github",
    apiBaseUrl: "https://api.github.com",
  },
  aiConsentDataSource = defaultAiConsentDataSource,
  repoPath = "",
  provider = "claude",
}) => {
  const [base, setBase] = useState(defaultBaseBranch);
  const [head, setHead] = useState(currentBranch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");

  // Reviewers autocomplete state
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewerQuery, setReviewerQuery] = useState("");
  const [reviewerSuggestions, setReviewerSuggestions] = useState<Reviewer[]>([]);
  const [isSearchingReviewers, setIsSearchingReviewers] = useState(false);
  const reviewerSearchTimerRef = useRef<number | undefined>(undefined);

  // Unpushed status state
  const [isPushed, setIsPushed] = useState<boolean | null>(null);
  const [isPushing, setIsPushing] = useState(false);

  // AI Generation & Consent state
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  // Submit / Result state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdPr, setCreatedPr] = useState<PullRequestResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // CI status preview
  const [ciState] = useState<CiState>("none");

  // Sync branches when currentBranch changes
  useEffect(() => {
    if (currentBranch) {
      setHead(currentBranch);
    }
  }, [currentBranch]);

  // Check if head branch is pushed
  useEffect(() => {
    let active = true;
    if (head) {
      hostingDataSource.checkBranchPushed(head).then((pushed) => {
        if (active) {
          setIsPushed(pushed);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [head, hostingDataSource]);

  // Search reviewers with debounce
  useEffect(() => {
    clearTimeout(reviewerSearchTimerRef.current);

    if (!reviewerQuery.trim()) {
      setReviewerSuggestions([]);
      setIsSearchingReviewers(false);
      return;
    }

    setIsSearchingReviewers(true);
    reviewerSearchTimerRef.current = window.setTimeout(async () => {
      try {
        const found = await hostingDataSource.searchReviewers(host.host, reviewerQuery);
        // Exclude already added
        const filtered = found.filter(
          (cand) => !reviewers.some((r) => r.username.toLowerCase() === cand.username.toLowerCase())
        );
        setReviewerSuggestions(filtered);
      } catch {
        setReviewerSuggestions([]);
      } finally {
        setIsSearchingReviewers(false);
      }
    }, 300);

    return () => {
      clearTimeout(reviewerSearchTimerRef.current);
    };
  }, [reviewerQuery, host.host, hostingDataSource, reviewers]);

  if (!isOpen) {
    return null;
  }

  const handlePushFirst = async () => {
    setIsPushing(true);
    try {
      await hostingDataSource.pushBranch(head);
      setIsPushed(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to push branch");
    } finally {
      setIsPushing(false);
    }
  };

  const executeAiGenerate = async () => {
    setIsGeneratingAi(true);
    setBody("");
    try {
      const result = await aiDataSource.generatePr(base, head, (chunk) => {
        setBody((prev) => prev + chunk);
      });
      if (!title.trim() && result.title) {
        setTitle(result.title);
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleAiGenerate = () => {
    const isRemote = provider.toLowerCase() !== "ollama";
    if (isRemote && !aiConsentDataSource.hasConsent(repoPath, provider)) {
      setShowConsentDialog(true);
      return;
    }
    executeAiGenerate();
  };

  const handleAddReviewer = (rev: Reviewer) => {
    setReviewers([...reviewers, rev]);
    setReviewerQuery("");
    setReviewerSuggestions([]);
  };

  const handleRemoveReviewer = (username: string) => {
    setReviewers(reviewers.filter((r) => r.username !== username));
  };

  const handleAddLabel = () => {
    const trimmed = labelInput.trim();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
      setLabelInput("");
    }
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setSubmitError("PR title is required");
      return;
    }
    if (base === head) {
      setSubmitError("Base and head branches cannot be identical");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const pr = await hostingDataSource.createPullRequest({
        base,
        head,
        title: title.trim(),
        body: body.trim(),
        draft,
        reviewers: reviewers.map((r) => r.username),
        labels,
      });
      setCreatedPr(pr);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create pull request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pr-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 select-none backdrop-blur-[1px]"
    >
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col rounded-lg border border-vscode-border bg-vscode-sidebar shadow-2xl text-vscode-fg overflow-hidden">
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b border-vscode-border px-5 bg-vscode-bg">
          <div className="flex items-center gap-2.5">
            <GitPullRequest className="h-5 w-5 text-vscode-accent" />
            <h2 id="create-pr-title" className="text-sm font-semibold text-vscode-fg">
              Create Pull Request on {host.host}
            </h2>
            <CiBadge state={ciState} />
          </div>
          <button
            type="button"
            title="Close dialog"
            onClick={onClose}
            className="rounded p-1 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        {createdPr ? (
          /* Success Screen */
          <div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
            <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-500">
              <Check className="h-8 w-8" />
            </div>
            <h3 className="text-base font-semibold text-vscode-fg">
              Pull Request #{createdPr.number} Created!
            </h3>
            <p className="text-xs text-vscode-muted max-w-md">
              Your pull request <strong>{createdPr.title}</strong> has been successfully opened on{" "}
              {host.host}.
            </p>
            <div className="rounded border border-vscode-border bg-vscode-bg p-3 font-mono text-xs text-vscode-accent select-text break-all">
              <a
                href={createdPr.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:underline"
              >
                <span>{createdPr.url}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-vscode-accent px-4 py-1.5 text-xs text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Form Screen */
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto p-5 gap-4">
            {/* Branch selector: base <- head */}
            <div className="flex items-center gap-3 rounded bg-vscode-bg p-3 border border-vscode-border text-xs">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="pr-base-branch" className="text-vscode-muted font-medium">
                  Base (target branch)
                </label>
                <input
                  id="pr-base-branch"
                  type="text"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="e.g. main"
                  className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                />
              </div>

              <span className="text-vscode-muted mt-5">←</span>

              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="pr-head-branch" className="text-vscode-muted font-medium">
                  Head (source branch)
                </label>
                <input
                  id="pr-head-branch"
                  type="text"
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                  placeholder="e.g. feat/my-feature"
                  className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                />
              </div>
            </div>

            {/* Unpushed Warning Banner */}
            {isPushed === false && (
              <div
                data-testid="unpushed-warning"
                className="flex items-center justify-between rounded bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-400"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>
                    Branch <strong>{head}</strong> chưa được push lên remote hoặc có commit mới.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isPushing}
                  onClick={handlePushFirst}
                  className="inline-flex items-center gap-1.5 rounded bg-amber-500 text-black px-2.5 py-1 text-xs font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>{isPushing ? "Đang push..." : "Push trước"}</span>
                </button>
              </div>
            )}

            {/* Title & Magic AI Button */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="pr-title" className="text-xs font-medium text-vscode-fg">
                  Title
                </label>
                <button
                  type="button"
                  disabled={isGeneratingAi}
                  onClick={handleAiGenerate}
                  className="inline-flex items-center gap-1.5 rounded bg-vscode-hover border border-vscode-border px-2 py-0.5 text-xs text-vscode-accent hover:bg-vscode-accent hover:text-white transition-colors"
                  title="Generate PR title & description using AI"
                >
                  {isGeneratingAi ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  <span>✨ Generate with AI</span>
                </button>
              </div>
              <input
                id="pr-title"
                type="text"
                placeholder="e.g. feat(auth): add OAuth2 provider login"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
              />
            </div>

            {/* Body */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pr-body" className="text-xs font-medium text-vscode-fg">
                Description (Markdown)
              </label>
              <textarea
                id="pr-body"
                rows={6}
                placeholder="Write PR description or generate with AI..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="rounded border border-vscode-border bg-vscode-input p-2.5 font-mono text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none resize-y leading-relaxed"
              />
            </div>

            {/* Draft Checkbox */}
            <div className="flex items-center gap-2">
              <input
                id="pr-draft"
                type="checkbox"
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
                className="h-4 w-4 rounded accent-vscode-accent"
              />
              <label htmlFor="pr-draft" className="text-xs text-vscode-fg cursor-pointer">
                Create as draft pull request
              </label>
            </div>

            {/* Reviewers Autocomplete */}
            <div className="flex flex-col gap-1.5 relative">
              <label htmlFor="pr-reviewers-input" className="text-xs font-medium text-vscode-fg">
                Reviewers
              </label>
              <div className="flex flex-wrap gap-1.5 items-center mb-1">
                {reviewers.map((rev) => (
                  <span
                    key={rev.username}
                    className="inline-flex items-center gap-1.5 rounded-full bg-vscode-hover border border-vscode-border px-2.5 py-0.5 text-xs text-vscode-fg"
                  >
                    <span>@{rev.username}</span>
                    <button
                      type="button"
                      title={`Remove reviewer ${rev.username}`}
                      aria-label={`Remove reviewer ${rev.username}`}
                      onClick={() => handleRemoveReviewer(rev.username)}
                      className="rounded p-0.5 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="relative">
                <input
                  id="pr-reviewers-input"
                  type="text"
                  placeholder="Type username or name to search reviewers..."
                  value={reviewerQuery}
                  onChange={(e) => setReviewerQuery(e.target.value)}
                  className="w-full rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                />
                {isSearchingReviewers && (
                  <Loader2 className="absolute right-2.5 top-2 h-3.5 w-3.5 animate-spin text-vscode-muted" />
                )}
              </div>

              {/* Reviewer Suggestions Dropdown */}
              {reviewerSuggestions.length > 0 && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded border border-vscode-border bg-vscode-sidebar shadow-lg"
                >
                  {reviewerSuggestions.map((rev) => (
                    <button
                      key={rev.username}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => handleAddReviewer(rev)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        <UserPlus className="h-3.5 w-3.5 opacity-70" />
                        <span className="font-semibold">@{rev.username}</span>
                        {rev.name && <span className="opacity-80">({rev.name})</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Labels List */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pr-labels-input" className="text-xs font-medium text-vscode-fg">
                Labels
              </label>
              <div className="flex flex-wrap gap-1.5 items-center mb-1">
                {labels.map((lbl) => (
                  <span
                    key={lbl}
                    className="inline-flex items-center gap-1 rounded bg-vscode-hover border border-vscode-border px-2 py-0.5 text-xs text-vscode-fg font-mono"
                  >
                    <Tag className="h-3 w-3 text-vscode-muted" />
                    <span>{lbl}</span>
                    <button
                      type="button"
                      title={`Remove label ${lbl}`}
                      aria-label={`Remove label ${lbl}`}
                      onClick={() => handleRemoveLabel(lbl)}
                      className="rounded p-0.5 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  id="pr-labels-input"
                  type="text"
                  placeholder="e.g. bug, enhancement, documentation"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddLabel();
                    }
                  }}
                  className="flex-1 rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddLabel}
                  className="rounded border border-vscode-border bg-vscode-hover px-2.5 py-1 text-xs text-vscode-fg hover:bg-vscode-bg"
                >
                  Add Label
                </button>
              </div>
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-vscode-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-vscode-border bg-vscode-hover px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-bg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded bg-vscode-accent px-4 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <GitPullRequest className="h-3.5 w-3.5" />
                    <span>Create Pull Request</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      {showConsentDialog && (
        <AiConsentDialog
          isOpen={showConsentDialog}
          repoPath={repoPath}
          provider={provider}
          host={host.host}
          consentDataSource={aiConsentDataSource}
          onConfirm={() => {
            setShowConsentDialog(false);
            executeAiGenerate();
          }}
          onCancel={() => {
            setShowConsentDialog(false);
          }}
        />
      )}
    </div>
  );
};
