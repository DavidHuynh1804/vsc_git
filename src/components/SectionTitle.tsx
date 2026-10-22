import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SectionTitleProps {
  label: string;
  /** When set, the title becomes a collapse toggle. */
  collapsed?: boolean;
  onToggle?: () => void;
}

/** Uppercase sidebar section title, optionally collapsible. */
export const SectionTitle: React.FC<SectionTitleProps> = ({ label, collapsed, onToggle }) => {
  const text = <span className="text-xs font-semibold tracking-wider text-vscode-muted">{label}</span>;
  if (!onToggle) return text;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex items-center gap-1 rounded hover:text-vscode-fg"
    >
      <Chevron className="h-3.5 w-3.5 text-vscode-muted" />
      {text}
    </button>
  );
};
