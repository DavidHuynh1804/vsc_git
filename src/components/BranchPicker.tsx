import React, { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Plus, Search } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import type { AppError } from "@/scm/types";

interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => Promise<void>;
}

function isAppError(err: unknown): err is AppError {
  return !!err && typeof err === "object" && "kind" in err;
}

/** Creates `name` at HEAD and switches to it, like VS Code's "Create new branch...". */
async function createAndCheckout(name: string): Promise<void> {
  const scm = useScmStore.getState();
  try {
    await scm.dataSource.createBranch(name);
  } catch (err: unknown) {
    if (isAppError(err)) scm.setError(err);
    return;
  }
  // checkout() refreshes status/refs and reports its own errors.
  await scm.checkout(name).catch(() => {});
}

/** Quick pick for switching to a local branch or creating a new one. */
export const BranchPicker: React.FC = () => {
  const { isBranchPickerOpen, setBranchPickerOpen } = useUIStore();
  const { refs, refreshRefs, checkout } = useScmStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isBranchPickerOpen) {
      setQuery("");
      setSelectedIndex(0);
      void refreshRefs();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isBranchPickerOpen, refreshRefs]);

  const items = useMemo<PickerItem[]>(() => {
    const name = query.trim();
    const q = name.toLowerCase();
    const branches = (refs?.branches ?? []).filter((b) => b.name.toLowerCase().includes(q));
    const exact = branches.some((b) => b.name === name);
    const create: PickerItem[] =
      name && !exact
        ? [
            {
              id: "create",
              label: `Create new branch "${name}"`,
              detail: "from HEAD",
              icon: Plus,
              run: () => createAndCheckout(name),
            },
          ]
        : [];
    return [
      ...create,
      ...branches.map((b) => ({
        id: b.fullName,
        label: b.name,
        detail: b.isHead ? "current" : undefined,
        icon: GitBranch,
        run: async () => {
          if (!b.isHead) await checkout(b.name).catch(() => {});
        },
      })),
    ];
  }, [query, refs, checkout]);

  if (!isBranchPickerOpen) return null;

  const close = () => setBranchPickerOpen(false);
  const runItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    close();
    void item.run();
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
      runItem(selectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch Branch"
      style={{ overscrollBehavior: "contain" }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 select-none bg-black/50"
      onClick={close}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-lg border border-vscode-border bg-vscode-sidebar shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-vscode-border bg-vscode-input px-3 py-2 text-vscode-fg">
          <Search className="h-4 w-4 text-vscode-muted flex-shrink-0" />
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
            placeholder="Select a branch to checkout, or type a name to create one"
            className="flex-1 bg-transparent text-xs text-vscode-fg outline-none placeholder:text-vscode-muted font-sans"
          />
        </div>

        <div role="listbox" aria-label="Branches" className="max-h-72 overflow-y-auto p-1 flex flex-col gap-0.5">
          {items.length === 0 ? (
            <div className="p-3 text-center text-xs text-vscode-muted">Type a name to create a new branch</div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => runItem(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between rounded px-3 py-1.5 text-xs cursor-pointer ${
                    isSelected ? "bg-vscode-accent text-white" : "text-vscode-fg hover:bg-vscode-hover"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 opacity-80 flex-shrink-0" />
                    <span className="truncate font-medium">{item.label}</span>
                  </div>
                  {item.detail && (
                    <span className={isSelected ? "text-white opacity-80" : "text-vscode-muted"}>
                      {item.detail}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
