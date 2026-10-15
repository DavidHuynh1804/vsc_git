import React, { useState, useEffect, useRef } from "react";
import { Sparkles, ChevronDown, Undo2, Check } from "lucide-react";
import { useScmStore } from "@/scm/scmStore";
import { CommitOptions } from "@/scm/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const CONVENTIONAL_TYPES = [
  { type: "feat", desc: "A new feature" },
  { type: "fix", desc: "A bug fix" },
  { type: "docs", desc: "Documentation only" },
  { type: "style", desc: "Code formatting / white-space" },
  { type: "refactor", desc: "Code change without bug fix or feature" },
  { type: "perf", desc: "A code change that improves performance" },
  { type: "test", desc: "Adding or correcting tests" },
  { type: "build", desc: "Changes to build system or dependencies" },
  { type: "ci", desc: "CI configuration files and scripts" },
  { type: "chore", desc: "Other changes that do not modify src or test" },
  { type: "revert", desc: "Reverting a previous commit" },
];

export const CommitBox: React.FC = () => {
  const {
    status,
    commit,
    stageAll,
    dataSource,
    draftCommitMessage,
    setDraftCommitMessage,
    smartCommitSetting,
    setSmartCommitSetting,
    push,
    sync,
  } = useScmStore();

  const [message, setMessage] = useState(draftCommitMessage);
  const [previousMessage, setPreviousMessage] = useState<string | null>(null);
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAmend, setIsAmend] = useState(false);
  const [isSignoff, setIsSignoff] = useState(false);
  const [isNoVerify, setIsNoVerify] = useState(false);
  const [showSmartCommitDialog, setShowSmartCommitDialog] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load draft on mount
  useEffect(() => {
    if (!message) {
      dataSource.getDraftMessage().then((saved) => {
        if (saved) {
          setMessage(saved);
          setDraftCommitMessage(saved);
        }
      });
    }
  }, [dataSource, message, setDraftCommitMessage]);

  // Sync draft on change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessage(val);
    setDraftCommitMessage(val);
    void dataSource.setDraftMessage(val);

    // Show suggestions when typing at beginning of line 1
    if (val.length <= 10 && !val.includes("\n") && !val.includes(":")) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  // Close commit menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const headerLine = message.split("\n")[0] ?? "";
  const headerLength = headerLine.length;
  const isHeaderTooLong = headerLength > 72;

  const countStaged =
    status?.entries.filter(
      (e) =>
        (e.kind.type === "Ordinary" || e.kind.type === "RenamedOrCopied") &&
        e.kind.staged !== "Unmodified"
    ).length ?? 0;

  const countUnstagedOrUntracked =
    status?.entries.filter(
      (e) =>
        e.kind.type === "Untracked" ||
        ((e.kind.type === "Ordinary" || e.kind.type === "RenamedOrCopied") &&
          e.kind.unstaged !== "Unmodified")
    ).length ?? 0;

  const executeCommit = async (opts: Partial<CommitOptions> = {}, postAction?: "push" | "sync") => {
    if (!message.trim() && !isAmend) return;

    const commitOptions: CommitOptions = {
      message: message.trim(),
      amend: isAmend || opts.amend,
      signoff: isSignoff || opts.signoff,
      no_verify: isNoVerify || opts.no_verify,
      all: opts.all,
    };

    await commit(commitOptions);
    setMessage("");
    setDraftCommitMessage("");
    setIsAmend(false);

    if (postAction === "push") {
      await push();
    } else if (postAction === "sync") {
      await sync();
    }
  };

  const handleCommitAction = async (postAction?: "push" | "sync") => {
    if (countStaged === 0) {
      if (countUnstagedOrUntracked > 0) {
        if (smartCommitSetting === "always") {
          await stageAll();
          await executeCommit({}, postAction);
        } else if (smartCommitSetting === "ask") {
          setShowSmartCommitDialog(true);
        }
        return;
      }
      return;
    }
    await executeCommit({}, postAction);
  };

  const handleAiGenerate = async () => {
    if (isAiStreaming) return;
    setPreviousMessage(message);
    setIsAiStreaming(true);

    try {
      await dataSource.aiGenerateCommit((chunk) => {
        setMessage(chunk);
        setDraftCommitMessage(chunk);
      });
    } finally {
      setIsAiStreaming(false);
    }
  };

  const handleUndoAi = () => {
    if (previousMessage !== null) {
      setMessage(previousMessage);
      setDraftCommitMessage(previousMessage);
      setPreviousMessage(null);
    }
  };

  const handleSelectSuggestion = (type: string) => {
    const newMsg = `${type}: `;
    setMessage(newMsg);
    setDraftCommitMessage(newMsg);
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleCommitAction();
    }
  };

  return (
    <div className="flex flex-col border-b border-vscode-border p-3 gap-2">
      {/* Textarea container with AI button */}
      <div className="relative flex flex-col">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Message (Cmd+Enter to commit)"
          rows={3}
          className="w-full resize-y rounded border border-vscode-border bg-vscode-input p-2 pr-14 text-xs font-mono text-vscode-fg placeholder-vscode-muted focus:border-vscode-accent focus:outline-none"
        />

        {/* AI & Undo buttons overlay */}
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {previousMessage !== null && (
            <button
              type="button"
              title="Undo AI generation"
              onClick={handleUndoAi}
              className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            title="Generate commit message with AI (Spec 8.5)"
            disabled={isAiStreaming}
            onClick={handleAiGenerate}
            className={`rounded p-1 text-vscode-accent hover:bg-vscode-hover ${
              isAiStreaming ? "animate-pulse opacity-60" : "hover:text-vscode-fg"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Autocomplete suggestions dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 z-40 mt-1 max-h-48 w-full overflow-y-auto rounded border border-vscode-border bg-vscode-sidebar shadow-lg">
            <div className="p-1 text-[10px] font-semibold text-vscode-muted border-b border-vscode-border">
              Conventional Commit Type
            </div>
            {CONVENTIONAL_TYPES.map(({ type, desc }) => (
              <div
                key={type}
                onClick={() => handleSelectSuggestion(type)}
                className="flex items-center justify-between px-2 py-1 text-xs cursor-pointer hover:bg-vscode-hover text-vscode-fg"
              >
                <span className="font-mono font-semibold text-vscode-accent">{type}</span>
                <span className="text-[10px] text-vscode-muted">{desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Header character counter */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5">
          {isAmend && (
            <span className="rounded bg-vscode-badge px-1 py-0.5 text-[10px] text-white">
              Amend
            </span>
          )}
          {isSignoff && (
            <span className="rounded bg-vscode-input px-1 py-0.5 text-[10px] text-vscode-muted">
              Signed-off
            </span>
          )}
          {isNoVerify && (
            <span className="rounded bg-error/20 px-1 py-0.5 text-[10px] text-error">
              No Verify
            </span>
          )}
        </div>

        {headerLength > 0 && (
          <span
            className={`font-mono text-[10px] ${
              isHeaderTooLong ? "font-bold text-error" : "text-vscode-muted"
            }`}
            title={isHeaderTooLong ? "Header line exceeds 72 characters" : "Header length"}
          >
            {headerLength}/72
          </span>
        )}
      </div>

      {/* Commit button & Split menu */}
      <div ref={menuRef} className="relative flex w-full">
        <button
          type="button"
          onClick={() => handleCommitAction()}
          disabled={!message.trim() && !isAmend}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-l bg-vscode-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          <span>{isAmend ? "Commit (Amend)" : "Commit"}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="flex items-center rounded-r border-l border-white/20 bg-vscode-accent px-2 text-white hover:opacity-90"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div className="absolute top-full right-0 z-30 mt-1 min-w-[180px] rounded border border-vscode-border bg-vscode-sidebar py-1 shadow-lg text-xs">
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                void handleCommitAction();
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              Commit
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                void handleCommitAction("push");
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              Commit & Push
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                void handleCommitAction("sync");
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              Commit & Sync
            </button>

            <div className="my-1 border-t border-vscode-border" />

            <button
              type="button"
              onClick={() => {
                setIsAmend(!isAmend);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              <span>Amend Last Commit</span>
              {isAmend && <Check className="h-3 w-3 text-vscode-accent" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignoff(!isSignoff);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              <span>Signoff (-s)</span>
              {isSignoff && <Check className="h-3 w-3 text-vscode-accent" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsNoVerify(!isNoVerify);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              <span>No Verify (--no-verify)</span>
              {isNoVerify && <Check className="h-3 w-3 text-vscode-accent" />}
            </button>
          </div>
        )}
      </div>

      {/* Smart Commit Confirm Dialog */}
      <ConfirmDialog
        isOpen={showSmartCommitDialog}
        title="No Staged Changes"
        message="There are no staged changes to commit. Would you like to stage all your changes and commit them directly?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          setShowSmartCommitDialog(false);
          await stageAll();
          await executeCommit();
        }}
        onCancel={() => setShowSmartCommitDialog(false)}
      />

      {showSmartCommitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto flex gap-2 pt-24">
            <button
              type="button"
              onClick={async () => {
                setSmartCommitSetting("always");
                setShowSmartCommitDialog(false);
                await stageAll();
                await executeCommit();
              }}
              className="rounded bg-vscode-input border border-vscode-border px-3 py-1 text-xs text-vscode-fg hover:bg-vscode-hover"
            >
              Always Stage & Commit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
