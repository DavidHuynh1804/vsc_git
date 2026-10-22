import React, { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, GitBranch, GitCommitHorizontal, Plus, Tag } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import type { AppError, RefItem } from "@/scm/types";

/**
 * VS Code style branch quick pick: checkout a branch/remote/tag, create a new
 * branch (from HEAD or from a chosen ref) or checkout a ref detached.
 */

type Step =
  | { kind: "main" }
  | { kind: "from" }
  | { kind: "detached" }
  | { kind: "name"; startPoint?: string };

interface PickerItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Right-aligned section label (shown on the first item of a section). */
  section?: string;
  badge?: string;
  time?: string;
  detail?: string;
  run: () => void;
}

function isAppError(err: unknown): err is AppError {
  return !!err && typeof err === "object" && "kind" in err;
}

const UNITS: [number, string][] = [
  [31536000, "year"],
  [2592000, "month"],
  [604800, "week"],
  [86400, "day"],
  [3600, "hour"],
  [60, "minute"],
];

export function timeAgo(unixSeconds: number, nowMs = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  for (const [secs, unit] of UNITS) {
    if (diff >= secs) {
      const n = Math.floor(diff / secs);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Creates `name` (at HEAD or `startPoint`) and switches to it. */
async function createAndCheckout(name: string, startPoint?: string): Promise<void> {
  const scm = useScmStore.getState();
  try {
    await scm.dataSource.createBranch(name, startPoint);
  } catch (err: unknown) {
    if (isAppError(err)) scm.setError(err);
    return;
  }
  // checkout() refreshes status/refs and reports its own errors.
  await scm.checkout(name).catch(() => {});
}

function checkoutRef(ref: RefItem, detached: boolean): Promise<void> {
  const scm = useScmStore.getState();
  let target = ref.name;
  if (detached || ref.kind === "tag") {
    // A full sha makes the backend run `git switch --detach`.
    target = ref.targetOid ?? ref.name;
  } else if (ref.kind === "remote" && ref.remote) {
    // `git switch <name>` creates a tracking branch for a unique remote branch.
    target = ref.name.slice(ref.remote.length + 1);
  }
  return scm.checkout(target).catch(() => {});
}

function byRecency(a: RefItem, b: RefItem): number {
  return (b.date ?? 0) - (a.date ?? 0);
}

function refDetail(ref: RefItem): string {
  return [ref.author, ref.targetOid?.slice(0, 8), ref.subject].filter(Boolean).join(" • ");
}

export const BranchPicker: React.FC = () => {
  const { isBranchPickerOpen, setBranchPickerOpen } = useUIStore();
  const { refs, refreshRefs } = useScmStore();
  const [step, setStep] = useState<Step>({ kind: "main" });
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isBranchPickerOpen) {
      setStep({ kind: "main" });
      setQuery("");
      setSelectedIndex(0);
      void refreshRefs();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isBranchPickerOpen, refreshRefs]);

  const close = () => setBranchPickerOpen(false);

  const goTo = (next: Step) => {
    setStep(next);
    setQuery("");
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  const items = useMemo<PickerItem[]>(() => {
    if (step.kind === "name") return [];
    const typed = query.trim();
    const q = typed.toLowerCase();
    const matches = (r: RefItem) => r.name.toLowerCase().includes(q);

    const locals = (refs?.branches ?? []).filter(matches).sort(byRecency);
    // `origin/HEAD` shows up as the bare remote name; it is not a branch.
    const remotes = (refs?.remotes ?? []).filter((r) => r.name.includes("/") && matches(r)).sort(byRecency);
    const tags = (refs?.tags ?? []).filter(matches).sort(byRecency);
    const detached = step.kind === "detached";

    const toItems = (list: RefItem[], section: string, icon: PickerItem["icon"]): PickerItem[] =>
      list.map((ref, i) => {
        const track =
          ref.kind === "local" && (ref.ahead || ref.behind)
            ? `${ref.behind ?? 0}↓ ${ref.ahead ?? 0}↑`
            : undefined;
        return {
          id: ref.fullName,
          label: ref.name,
          icon,
          section: i === 0 ? section : undefined,
          badge: track,
          time: ref.date ? timeAgo(ref.date) : undefined,
          detail: refDetail(ref),
          run:
            step.kind === "from"
              ? () => goTo({ kind: "name", startPoint: ref.name })
              : () => {
                  close();
                  if (step.kind === "main" && ref.isHead) return;
                  void checkoutRef(ref, detached);
                },
        };
      });

    const refItems = [
      ...toItems(locals, "branches", GitBranch),
      ...toItems(remotes, "remote branches", Cloud),
      ...toItems(tags, "tags", Tag),
    ];
    if (step.kind !== "main") return refItems;

    const exact = locals.some((b) => b.name === typed);
    const actions: PickerItem[] = typed
      ? exact
        ? []
        : [
            {
              id: "create",
              label: `Create new branch "${typed}"`,
              icon: Plus,
              run: () => {
                close();
                void createAndCheckout(typed);
              },
            },
          ]
      : [
          {
            id: "create",
            label: "Create new branch...",
            icon: Plus,
            run: () => goTo({ kind: "name" }),
          },
          {
            id: "create-from",
            label: "Create new branch from...",
            icon: Plus,
            run: () => goTo({ kind: "from" }),
          },
          {
            id: "detached",
            label: "Checkout detached...",
            icon: GitCommitHorizontal,
            run: () => goTo({ kind: "detached" }),
          },
        ];
    return [...actions, ...refItems];
  }, [query, refs, step]);

  if (!isBranchPickerOpen) return null;

  const placeholder =
    step.kind === "name"
      ? step.startPoint
        ? `Please provide a new branch name (from ${step.startPoint})`
        : "Please provide a new branch name"
      : step.kind === "from"
        ? "Select a ref to create the branch from"
        : step.kind === "detached"
          ? "Select a ref to checkout in detached mode"
          : "Select a branch or tag to checkout";

  const submit = () => {
    if (step.kind === "name") {
      const name = query.trim();
      if (!name) return;
      close();
      void createAndCheckout(name, step.startPoint);
      return;
    }
    items[selectedIndex]?.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (step.kind === "main") close();
      else goTo({ kind: "main" });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch Branch"
      style={{ overscrollBehavior: "contain" }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-2 select-none"
      onClick={close}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-md border border-vscode-border bg-vscode-sidebar p-1.5 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          name="branchQuery"
          aria-label="Branch name"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded border border-vscode-accent bg-vscode-input px-2 py-1 text-[13px] text-vscode-fg outline-none placeholder:text-vscode-muted"
        />

        {step.kind !== "name" && (
          <div role="listbox" aria-label="Branches" className="mt-1.5 max-h-96 overflow-y-auto flex flex-col">
            {items.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-vscode-muted">No matching refs</div>
            ) : (
              items.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === selectedIndex;
                const muted = isSelected ? "text-white/80" : "text-vscode-muted";
                return (
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelectedIndex(idx);
                      item.run();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex flex-col rounded px-2 py-0.5 text-[13px] cursor-pointer ${
                      isSelected ? "bg-vscode-accent text-white" : "text-vscode-fg"
                    } ${item.section && idx > 0 ? "mt-1 border-t border-vscode-border/60 pt-1" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-80" />
                      <span className="truncate">{item.label}</span>
                      {item.badge && <span className={`shrink-0 text-xs ${muted}`}>{item.badge}</span>}
                      {item.time && <span className={`shrink-0 text-xs ${muted}`}>{item.time}</span>}
                      {item.section && (
                        <>
                          <span className="flex-1" />
                          <span className={`shrink-0 text-xs ${muted}`}>{item.section}</span>
                        </>
                      )}
                    </div>
                    {item.detail && <div className={`truncate pl-5 text-xs ${muted}`}>{item.detail}</div>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
