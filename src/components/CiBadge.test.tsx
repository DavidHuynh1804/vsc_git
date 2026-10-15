import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CiBadge } from "./CiBadge";
import { CiState } from "@/integrations/types";

describe("CiBadge Component", () => {
  const states: Array<{ state: CiState; symbol: string; label: string }> = [
    { state: "success", symbol: "✓", label: "Passed" },
    { state: "failure", symbol: "✗", label: "Failed" },
    { state: "pending", symbol: "●", label: "Pending" },
    { state: "none", symbol: "⊘", label: "No checks" },
  ];

  it.each(states)(
    "renders correct symbol and aria-label for state: $state",
    ({ state, symbol, label }) => {
      const { unmount } = render(<CiBadge state={state} />);
      const badge = screen.getByRole("status");

      expect(badge).toHaveAttribute("aria-label", `CI Status: ${label}`);
      expect(badge).toHaveTextContent(symbol);
      unmount();
    }
  );

  it("renders with text label when showLabel is true", () => {
    render(<CiBadge state="success" showLabel />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("✓");
    expect(badge).toHaveTextContent("Passed");
  });

  it("applies custom className", () => {
    render(<CiBadge state="failure" className="custom-test-class" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("custom-test-class");
  });
});
