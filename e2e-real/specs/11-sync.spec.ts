/**
 * Real-backend spec: fetch / pull / push against a real bare remote.
 *
 * The fixture is a clone of a local bare repository (no network), so the
 * commands run the real git transport and the assertions read the real
 * remote-tracking ref and the bare repo itself.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { git, headSha, logSubjects, revParse, tryRevParse } from "../helpers/git";
import { commitAll, cloneRemote, createRemoteRepo, pushRemoteCommit, writeFile } from "../helpers/fixtures";
import { openApp, runPaletteCommand } from "../helpers/app";

test.describe("sync with a remote", () => {
  test("fetches, pulls and pushes against a bare local remote", async ({ page }) => {
    const { bare, repo } = createRemoteRepo("sync");
    const other = cloneRemote(bare, "sync-other");
    const remoteSha = pushRemoteCommit(other, "remote.txt", "remote work\n", "feat: remote work");

    await bridgeOpenRepo(repo);
    await openApp(page);

    // Before the fetch the tracking ref is stale (the remote moved ahead).
    expect(revParse(repo, "origin/main")).not.toBe(remoteSha);

    // --- fetch ---
    await runPaletteCommand(page, "Git: Fetch");
    await expect.poll(() => revParse(repo, "origin/main")).toBe(remoteSha);
    // Fetch must not move the local branch.
    expect(headSha(repo)).not.toBe(remoteSha);

    // --- pull (fast-forward) ---
    await runPaletteCommand(page, "Git: Pull");
    await expect.poll(() => headSha(repo)).toBe(remoteSha);
    expect(logSubjects(repo, 1)[0]).toBe("feat: remote work");

    // --- push a local commit ---
    writeFile(repo, "local.txt", "local work\n");
    const localSha = commitAll(repo, "feat: local work");
    await runPaletteCommand(page, "Git: Push");
    await expect.poll(() => git(bare, ["rev-parse", "main"])).toBe(localSha);
  });

  test("publishes a new branch that has no upstream yet", async ({ page }) => {
    const { bare, repo } = createRemoteRepo("publish");
    git(repo, ["checkout", "-q", "-b", "topic"]);
    writeFile(repo, "topic.txt", "topic\n");
    const topicSha = commitAll(repo, "feat: topic");

    await bridgeOpenRepo(repo);
    await openApp(page);
    await runPaletteCommand(page, "Git: Push");

    await expect.poll(() => tryRevParse(bare, "topic")).toBe(topicSha);
    expect(git(repo, ["rev-parse", "--abbrev-ref", "topic@{upstream}"])).toBe("origin/topic");
  });
});
