import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BranchesView } from "./BranchesView";
import { StashesView } from "@/views/Stashes/StashesView";
import { useScmStore } from "@/scm/scmStore";
import { MockScmDataSource } from "@/scm/dataSource";

describe("BranchesView", () => {
  beforeEach(async () => {
    const ds = new MockScmDataSource();
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshRefs();
  });

  it("renders local branches, remote branches, and tags", async () => {
    render(<BranchesView />);

    expect(screen.getByText("Local Branches")).toBeInTheDocument();
    expect(screen.getByText("Remote Branches")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feat/m1-frontend")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("shows HEAD marker on current branch", () => {
    render(<BranchesView />);
    expect(screen.getAllByText("HEAD").length).toBeGreaterThan(0);
  });

  it("creates a branch via prompt dialog", async () => {
    useScmStore.getState().setDataSource(new MockScmDataSource());
    render(<BranchesView />);

    fireEvent.click(screen.getByTitle("Create New Branch"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("feat/my-feature");
    fireEvent.change(input, { target: { value: "feat/new-branch" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const refs = useScmStore.getState().refs;
      expect(refs?.branches.some((b) => b.name === "feat/new-branch")).toBe(true);
    });
  });

  it("deletes a branch with confirmation", async () => {
    render(<BranchesView />);

    // Click delete on first local branch action
    const deleteBtns = screen.getAllByTitle("Delete branch");
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Delete Branch" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  });
});

describe("StashesView", () => {
  beforeEach(async () => {
    const ds = new MockScmDataSource();
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStashes();
  });

  it("renders stash items and actions", async () => {
    render(<StashesView />);

    expect(screen.getByText(/WIP on main/)).toBeTruthy();
    // Create stash button should exist
    expect(screen.getByTitle("Create Stash")).toBeInTheDocument();
  });

  it("opens create stash dialog", () => {
    render(<StashesView />);
    fireEvent.click(screen.getByTitle("Create Stash"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Create Stash")).toBeInTheDocument();
  });

  it("pops a stash via pop action", async () => {
    const ds = new MockScmDataSource();
    await ds.stashPush({ message: "WIP test stash" });
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStashes();

    render(<StashesView />);

    const popButtons = screen.getAllByTitle("Pop stash (apply and drop)");
    expect(popButtons.length).toBeGreaterThan(0);
    fireEvent.click(popButtons[0]);

    await waitFor(() => {
      expect(useScmStore.getState().stashes.length).toBeLessThanOrEqual(1);
    });
  });

  it("drops a stash after confirmation dialog", async () => {
    const ds = new MockScmDataSource();
    await ds.stashPush({ message: "WIP drop test" });
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStashes();

    render(<StashesView />);

    const dropButtons = screen.getAllByTitle("Drop stash");
    fireEvent.click(dropButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Drop Stash" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Drop Stash" }));
  });
});
