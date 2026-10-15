import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders app title", () => {
    render(<App />);
    expect(screen.getByText("vsc_git")).toBeInTheDocument();
  });
});
