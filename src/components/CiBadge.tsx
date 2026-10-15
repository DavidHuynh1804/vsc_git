import React from "react";
import { CiState } from "@/integrations/types";

export interface CiBadgeProps {
  state: CiState;
  className?: string;
  showLabel?: boolean;
}

interface BadgeConfig {
  symbol: string;
  label: string;
  className: string;
}

const BADGE_CONFIGS: Record<CiState, BadgeConfig> = {
  success: {
    symbol: "✓",
    label: "Passed",
    className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
  },
  failure: {
    symbol: "✗",
    label: "Failed",
    className: "text-rose-500 bg-rose-500/10 border-rose-500/30",
  },
  pending: {
    symbol: "●",
    label: "Pending",
    className: "text-amber-500 bg-amber-500/10 border-amber-500/30 animate-pulse",
  },
  none: {
    symbol: "⊘",
    label: "No checks",
    className: "text-vscode-muted bg-vscode-hover border-vscode-border",
  },
};

export const CiBadge: React.FC<CiBadgeProps> = ({ state, className = "", showLabel = false }) => {
  const config = BADGE_CONFIGS[state] ?? BADGE_CONFIGS.none;

  return (
    <span
      role="status"
      aria-label={`CI Status: ${config.label}`}
      title={`CI: ${config.label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono leading-none select-none ${config.className} ${className}`}
    >
      <span className="font-bold">{config.symbol}</span>
      {showLabel && <span className="font-sans text-[10px] tracking-tight">{config.label}</span>}
    </span>
  );
};
