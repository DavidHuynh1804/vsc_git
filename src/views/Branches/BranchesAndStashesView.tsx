import React, { useState } from "react";
import { BranchesView } from "./BranchesView";
import { StashesView } from "@/views/Stashes/StashesView";

/** Sidebar panel stacking Branches and Stashes as collapsible sections. */
export const BranchesAndStashesView: React.FC = () => {
  const [branchesCollapsed, setBranchesCollapsed] = useState(false);
  const [stashesCollapsed, setStashesCollapsed] = useState(false);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <section className={branchesCollapsed ? "flex-shrink-0" : "flex-1 min-h-0"}>
        <BranchesView
          collapsed={branchesCollapsed}
          onToggleCollapsed={() => setBranchesCollapsed((v) => !v)}
        />
      </section>
      <section
        className={`border-t border-vscode-border ${stashesCollapsed ? "flex-shrink-0" : "flex-1 min-h-0"}`}
      >
        <StashesView
          collapsed={stashesCollapsed}
          onToggleCollapsed={() => setStashesCollapsed((v) => !v)}
        />
      </section>
    </div>
  );
};
