# vsc_git — Spec thiết kế v1

> Git client desktop nhẹ, tái hiện trải nghiệm **Source Control của VS Code** + **Git Graph**, viết bằng **Rust (Tauri 2) + React**, chạy trên **macOS và Windows**, dùng nội bộ team.

- Trạng thái: Draft — chờ review
- Ngày: 2026-10-15
- Tác giả: @davidHuynh59

---

## 1. Bối cảnh & mục tiêu

### 1.1 Vấn đề
Team thích công cụ git của VS Code (Source Control panel + extension Git Graph) nhưng mở cả VS Code chỉ để stage/commit/xem graph thì nặng (300–600MB RAM, khởi động chậm).

### 1.2 Mục tiêu
1. App độc lập, nhẹ, mở nhanh, chỉ làm git.
2. Trải nghiệm quen thuộc như VS Code: cùng bố cục, cùng thuật ngữ, cùng phím tắt, diff editor Monaco.
3. Có graph tương đương Git Graph, kèm thao tác chuột phải.
4. Tôn trọng cấu hình git sẵn có của từng người (hooks, ký commit, credential helper, LFS, `.gitattributes`).
5. Phân phối nội bộ: installer đã ký, tự cập nhật.

### 1.3 Tiêu chí thành công
| Chỉ số | Mục tiêu |
|---|---|
| Mở app → hiện repo | < 1 s (repo 10k file) |
| RAM idle | ≤ 150 MB |
| Refresh status sau khi lưu file | < 500 ms |
| Trang graph đầu tiên | < 300 ms (repo 200k commit) |
| Cuộn graph | 60 fps |
| Installer | < 20 MB |
| Adoption | Thành viên team dùng thay VS Code cho việc git hằng ngày sau beta |

### 1.4 Ngoài phạm vi v1
- Nhiều repo trong một cửa sổ (multi-root).
- Quản lý submodule (v1 chỉ hiển thị trạng thái submodule như một entry).
- Linux.
- Quản lý git worktree.
- Tính năng LFS chuyên sâu (lock, migrate) — LFS vẫn chạy được vì đi qua git CLI.
- Review PR (comment, approve) trong app.
- Trình soạn thảo code đầy đủ (chỉ sửa file trong diff view).

---

## 2. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Đối tượng: nội bộ team | Cần installer, ký app, auto-update, log để hỗ trợ |
| D2 | UI: Tauri 2 + React + TypeScript + Monaco | Diff giống VS Code, làm nhanh, team dễ đóng góp |
| D3 | Mỗi cửa sổ một repo | Đơn giản; mở nhiều cửa sổ khi cần |
| D4 | Lớp git: **đọc bằng `gix`, ghi + status bằng `git` CLI** | Graph nhanh trên repo lớn; hành vi ghi giống hệt git/VS Code |
| D5 | Phạm vi v1 gồm: stage từng dòng, merge/rebase + conflict editor, blame, GitHub/GitLab, ký GPG/SSH, mở editor ngoài, AI commit | Yêu cầu của team |
| D6 | AI: đổi được provider — Claude, OpenAI-compatible, Ollama | Linh hoạt, có lựa chọn chạy local |
| D7 | Hosting: GitHub + GitLab (cloud và self-hosted), xác thực bằng PAT | Team dùng cả hai; PAT đơn giản, không cần đăng ký OAuth app |

Yêu cầu hệ thống: `git` ≥ 2.35 trong PATH (hoặc đường dẫn cấu hình trong settings). macOS 12+, Windows 10 1809+ (WebView2).

---

## 3. Kiến trúc

### 3.1 Tổng quan

```
┌───────────────────── Frontend (React + TS, Vite) ──────────────────────┐
│  SourceControlView   GraphView   CommitDetail   DiffView(Monaco)       │
│  MergeEditor  BlameView  FileHistory  Settings  CommandPalette         │
│  state: Zustand (1 store / cửa sổ) · TanStack Query cho dữ liệu backend│
└──────────────────────── Tauri IPC (commands + events) ─────────────────┘
┌──────────────────────── Backend (Rust, Tauri 2) ───────────────────────┐
│ app/      : cửa sổ, recent repos, settings, updater, logging           │
│ repo/     : RepoSession (1/cửa sổ) – cache status/refs, watcher, queue │
│ git/      : cli.rs · read.rs (gix) · parse/* · ops/* · patch.rs        │
│ graph/    : walker + lanes + phân trang                                │
│ hosting/  : trait Host → GitHubHost, GitLabHost                        │
│ ai/       : trait LlmProvider → Claude, OpenAICompat, Ollama           │
│ secrets/  : keyring (Keychain / Credential Manager)                    │
│ helpers/  : askpass, sequence-editor (binary phụ đi kèm)               │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Nguyên tắc
- **Frontend không biết git.** Chỉ gọi command có type rõ ràng; type TS sinh từ Rust bằng `specta` + `tauri-specta`.
- **Một `RepoSession` cho mỗi cửa sổ.** Giữ đường dẫn repo, cache status/refs, watcher, hàng đợi ghi, các job đang chạy.
- **Ghi tuần tự, đọc song song.** Mọi thao tác ghi đi qua một hàng đợi FIFO trong từng repo (tránh tranh chấp `index.lock`). Thao tác đọc chạy song song trên thread pool.
- **Job dài có thể hủy.** fetch/pull/push/clone/rebase/AI trả `JobId`; tiến độ gửi qua event; hủy bằng `cancel_job` (kill process git / hủy HTTP stream).
- **Dự phòng đọc.** Nếu `gix` lỗi (định dạng repo lạ, extension chưa hỗ trợ) → tự động dùng git CLI cho thao tác đó và ghi log cảnh báo.

### 3.3 Luồng refresh
1. `notify` theo dõi working tree + `.git/` (bỏ qua `.git/objects`, thư mục trong `.gitignore` lớn như `node_modules`, `target`).
2. Debounce 300 ms → chạy `git status --porcelain=v2 -z --branch --untracked-files=all` (tôn trọng `status.showUntrackedFiles`).
3. So sánh với cache → nếu khác, phát event `repo://status-changed`.
4. Thay đổi trong `.git/refs`, `HEAD`, `packed-refs` → phát `repo://refs-changed` → graph/branches refresh.
5. Khi cửa sổ mất focus: giảm tần suất (debounce 2 s); khi focus lại: refresh ngay.

### 3.4 Xác thực khi git cần tương tác
- `GIT_ASKPASS` và `SSH_ASKPASS` trỏ tới binary `vsc-git-askpass` đi kèm. Binary này kết nối IPC (socket cục bộ / named pipe, kèm token ngẫu nhiên trong env) về app → app hiện dialog trong cửa sổ đang chạy job → trả lời về git.
- `GIT_TERMINAL_PROMPT=0` để git không treo chờ terminal.
- Credential helper của người dùng (osxkeychain, manager) vẫn ưu tiên; askpass chỉ chạy khi helper không có.

### 3.5 Cấu trúc thư mục dự án

```
vsc_git/
├─ docs/spec.md
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs, lib.rs
│     ├─ app/        (windows.rs, settings.rs, recent.rs, updater.rs, logging.rs)
│     ├─ repo/       (session.rs, watcher.rs, queue.rs, jobs.rs)
│     ├─ git/
│     │  ├─ cli.rs   (spawn, env, timeout, cancel, output log)
│     │  ├─ read.rs  (gix: refs, log, blob, tree diff)
│     │  ├─ parse/   (status_v2.rs, diff.rs, blame.rs, log.rs, conflict.rs)
│     │  ├─ ops/     (stage.rs, commit.rs, branch.rs, sync.rs, stash.rs,
│     │  │            merge.rs, rebase.rs, cherry_pick.rs, reset.rs, tag.rs)
│     │  └─ patch.rs
│     ├─ graph/      (walker.rs, lanes.rs, page.rs)
│     ├─ hosting/    (mod.rs, github.rs, gitlab.rs, remote_url.rs, avatar_cache.rs)
│     ├─ ai/         (mod.rs, claude.rs, openai_compat.rs, ollama.rs,
│     │               prompt.rs, diff_budget.rs, redact.rs)
│     ├─ secrets/    (keyring.rs)
│     ├─ commands/   (đăng ký tauri command, mỏng, gọi xuống module)
│     └─ error.rs
├─ helpers/
│  ├─ askpass/           (crate binary)
│  └─ sequence-editor/   (crate binary)
├─ src/                  (frontend)
│  ├─ main.tsx, App.tsx
│  ├─ bindings.ts        (sinh bởi specta — không sửa tay)
│  ├─ stores/            (repo.ts, ui.ts, jobs.ts, settings.ts)
│  ├─ views/             (SourceControl/, Graph/, Branches/, Stashes/,
│  │                      Diff/, MergeEditor/, Blame/, FileHistory/, Settings/)
│  ├─ components/        (Toast, ConfirmDialog, CommandPalette, Tree, ...)
│  ├─ monaco/            (setup, diff gutter actions, blame decorations)
│  └─ keybindings.ts
├─ tests/fixtures/       (script tạo repo mẫu)
└─ .github/ hoặc .gitlab-ci.yml
```

---

## 4. Lớp Git

### 4.1 Phân chia đọc/ghi

| Nhóm | Thực thi | Ghi chú |
|---|---|---|
| Status | CLI `status --porcelain=v2 -z` | Tôn trọng fsmonitor, untracked cache |
| Đọc ref, HEAD, upstream, ahead/behind | `gix` | Fallback CLI `for-each-ref` |
| Log/graph | `gix` rev-walk | Fallback CLI `log --topo-order -z` |
| Nội dung blob (HEAD, index, commit) | `gix` | Dùng cho diff Monaco |
| Diff giữa 2 commit (danh sách file) | `gix` tree diff | Rename detection theo `diff.renames` |
| Diff text hiển thị | Frontend Monaco tự tính từ 2 nội dung | Không parse unified diff cho hiển thị |
| Diff unified (cho stage hunk, AI) | CLI `diff` / `diff --cached` | |
| Mọi thao tác ghi | CLI | Hooks, signing, LFS, credential đều hoạt động |
| Blame | CLI `blame --porcelain` | |
| Conflict stages | CLI `show :1:path` / `:2:` / `:3:` | |

### 4.2 Bảng ánh xạ thao tác → lệnh git

| Thao tác | Lệnh |
|---|---|
| Stage file | `git add -- <paths>` |
| Stage all | `git add -A` |
| Unstage file | `git restore --staged -- <paths>` (repo chưa có commit: `git rm --cached`) |
| Discard file tracked | `git restore --worktree -- <paths>` |
| Discard untracked | Xoá file (chuyển vào Thùng rác/Recycle Bin, không xoá vĩnh viễn) |
| Stage hunk/dòng | `git apply --cached --unidiff-zero --whitespace=nowarn -` (patch từ `patch.rs`) |
| Unstage hunk/dòng | `git apply --cached -R --unidiff-zero -` |
| Revert hunk/dòng | `git apply -R --unidiff-zero -` |
| Commit | `git commit -F <tmpfile>` (+ `--amend`, `--signoff`, `--no-verify` tuỳ chọn) |
| Ký commit | Theo `commit.gpgsign` / `gpg.format` của người dùng; app chỉ hiển thị trạng thái |
| Fetch | `git fetch --prune <remote>` (hoặc `--all`) |
| Pull | `git pull` (tôn trọng `pull.rebase`; có lựa chọn `--rebase`/`--ff-only`) |
| Push | `git push` (+ `-u <remote> <branch>` khi chưa có upstream; `--force-with-lease` khi force) |
| Sync | pull rồi push |
| Checkout branch | `git switch <branch>` |
| Checkout commit | `git switch --detach <sha>` |
| Tạo branch | `git switch -c <name> [<start>]` hoặc `git branch <name> <sha>` |
| Đổi tên / xoá branch | `git branch -m` / `git branch -d` (`-D` khi người dùng xác nhận) |
| Xoá branch remote | `git push <remote> --delete <branch>` |
| Tag | `git tag <name> <sha>` / `git tag -a <name> -m <msg> <sha>`; push: `git push <remote> <tag>` |
| Stash | `git stash push [-u] -m <msg> [-- paths]`, `apply`, `pop`, `drop`, `show -p` |
| Cherry-pick | `git cherry-pick <sha>` (merge commit: `-m 1`) |
| Revert | `git revert --no-edit <sha>` |
| Reset | `git reset --soft|--mixed|--hard <sha>` |
| Merge | `git merge [--no-ff] <ref>` |
| Rebase | `git rebase <ref>` |
| Rebase interactive | `GIT_SEQUENCE_EDITOR=<helper> git rebase -i <base>` |
| Continue/skip/abort | `git <merge|rebase|cherry-pick|revert> --continue|--skip|--abort` (continue dùng `GIT_EDITOR=true` khi message không đổi) |
| Mark resolved | Ghi nội dung Result → `git add -- <path>` |
| Blame | `git blame --porcelain [-w] [-M] [-C] -- <path>` |
| File history | `git log --follow -z --format=<fmt> -- <path>` |
| Clone | `git clone --progress <url> <dir>` |
| Init | `git init` |

### 4.3 Chạy process (`git/cli.rs`)
- Env cố định: `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`, `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, `GIT_OPTIONAL_LOCKS=0` (cho lệnh đọc).
- Windows: `CREATE_NO_WINDOW` để không nháy console.
- Timeout mặc định: đọc 30 s, ghi cục bộ 120 s, mạng không timeout nhưng có nút hủy.
- Mọi lệnh ghi vào **Git Output** (lệnh, cwd, exit code, thời gian, stderr), giới hạn 5.000 dòng trong bộ nhớ.
- Tiến độ fetch/push/clone đọc từ stderr (`--progress`), parse phần trăm → event `job://progress`.

### 4.4 Sinh patch (`git/patch.rs`)
- Input: path, nhóm (unstaged/staged), danh sách khoảng dòng được chọn (theo toạ độ của file bên phải trong diff).
- Lấy unified diff `-U0` của file, lọc giữ các dòng `+`/`-` thuộc vùng chọn; dòng `-` không chọn → biến thành context, dòng `+` không chọn → bỏ. Tính lại header `@@`.
- Giữ nguyên EOL của từng dòng (CRLF), xử lý `\ No newline at end of file`.
- File binary, file mới hoàn toàn (khi chọn một phần, dùng `git add -N` trước), file bị xoá, rename: có ca xử lý riêng; binary chỉ stage cả file.
- Nếu `git apply` thất bại → báo lỗi, không thay đổi gì (apply là atomic).

---

## 5. UI

### 5.1 Layout

```
┌─ Titlebar: repo name · branch ▾ · ⟳ Sync ↓2 ↑1 · 🔍 Cmd+K ───────────────┐
├─ Activity ─┬─ Sidebar (resizable) ──────┬─ Editor area (tabs) ─────────────┤
│ ⎇ Changes  │ [ commit message box   ✨ ] │  diff: src/app.ts (Working Tree) │
│ ◉ Graph    │ [✓ Commit ▾]                │  ┌ Monaco DiffEditor ───────────┐│
│ ⇅ Branches │ ▸ Merge Changes (2)         │  │ side-by-side / inline toggle  ││
│ ☰ Stashes  │ ▾ Staged Changes (3)    −   │  │ gutter: Stage/Revert hunk     ││
│ ⚙ Settings │ ▾ Changes (5)        + ↺    │  └──────────────────────────────┘│
│            │   M app.ts  src     + ↺ ↗   │                                  │
├────────────┴─────────────────────────────┴──────────────────────────────────┤
│ Status bar: ⎇ main · ↓2 ↑1 · CI ✓ · job: fetching… · ✍ signed · AI: haiku  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Graph mở trong editor area như một tab (giống Git Graph), có thể kéo ra cửa sổ riêng.
- Theme: Dark/Light/theo hệ thống, màu bám VS Code Dark Modern / Light Modern.
- Màn hình chào (chưa mở repo): Open folder, Clone, Init, danh sách Recent.

### 5.2 Source Control view
- Nhóm: **Merge Changes**, **Staged Changes**, **Changes**, **Untracked** (tuỳ chọn gộp vào Changes như VS Code).
- Hiển thị dạng list hoặc tree; badge trạng thái M/A/D/R/C/U/T/!; tên file + thư mục mờ.
- Hành động trên mục: Stage (+), Unstage (−), Discard (↺, có xác nhận), Open diff (click), Open file in external editor (↗), Copy path, Copy relative path, Add to `.gitignore`, Reveal in Finder/Explorer.
- Hành động trên nhóm: Stage all / Unstage all / Discard all.
- Chọn nhiều bằng Shift/Cmd-click; kéo thả giữa Staged và Changes.
- Ô commit:
  - Đa dòng, đếm ký tự dòng tiêu đề, cảnh báo > 72.
  - Gợi ý `type(scope):` theo Conventional Commits (autocomplete type; scope lấy từ lịch sử repo).
  - Nút ✨ sinh message bằng AI (mục 8).
  - Menu Commit ▾: Commit, Commit & Push, Commit & Sync, Commit (Amend), Commit (Signoff), Commit (No Verify).
  - Không có gì staged → hỏi "Stage tất cả thay đổi rồi commit?" (Luôn / Có / Không), giống `git.enableSmartCommit`.
  - Message nháp lưu theo repo, không mất khi đóng app.

### 5.3 Diff view
- Monaco DiffEditor, side-by-side hoặc inline, ngôn ngữ đoán theo phần mở rộng.
- Nguồn trái/phải theo ngữ cảnh: Changes = index ↔ working tree; Staged = HEAD ↔ index; Commit = parent ↔ commit; So sánh = A ↔ B.
- Bên phải sửa được khi là working tree; Cmd/Ctrl+S lưu; cảnh báo nếu file thay đổi trên đĩa.
- Hành động ở gutter và khi bôi chọn: **Stage Hunk**, **Stage Selected Lines**, **Unstage Hunk/Lines**, **Revert Hunk/Lines**. Phím tắt như VS Code.
- Điều hướng thay đổi trước/sau (Alt+F5 / Shift+Alt+F5).
- Ảnh (png/jpg/gif/svg/webp): hiển thị 2 bên. File > 5 MB hoặc binary: chỉ hiện kích thước/hash.
- Whitespace: toggle bỏ qua khoảng trắng.

### 5.4 Branches view
- Local (đánh dấu HEAD, ahead/behind so với upstream, badge CI), Remote (theo remote), Tags.
- Hành động: checkout, tạo từ đây, đổi tên, xoá, đặt/huỷ upstream, merge vào hiện tại, rebase hiện tại lên đây, push, so sánh với HEAD, tạo PR/MR, mở trên web.
- Checkout khi working tree bẩn và có xung đột → hỏi: Stash & checkout / Huỷ.

### 5.5 Stashes view
- Danh sách stash (message, branch, thời gian). Hành động: apply, pop, drop (xác nhận), xem diff, tạo branch từ stash.
- Tạo stash: message, tuỳ chọn kèm untracked, tuỳ chọn chỉ các file đang chọn.

### 5.6 Command palette & phím tắt
- Cmd/Ctrl+K hoặc Cmd/Ctrl+Shift+P: tìm mọi lệnh (`Git: Commit`, `Git: Checkout to…`, `Git: Stash`, ...).
- Phím tắt mặc định:

| Lệnh | macOS | Windows |
|---|---|---|
| Commit | Cmd+Enter | Ctrl+Enter |
| Command palette | Cmd+Shift+P / Cmd+K | Ctrl+Shift+P / Ctrl+K |
| Mở Source Control | Ctrl+Shift+G | Ctrl+Shift+G |
| Mở Graph | Cmd+Shift+H | Ctrl+Shift+H |
| Stage selected ranges | Cmd+K Cmd+Alt+S | Ctrl+K Ctrl+Alt+S |
| Revert selected ranges | Cmd+K Cmd+R | Ctrl+K Ctrl+R |
| Refresh | Cmd+R | F5 |
| Sync | Cmd+Shift+S | Ctrl+Shift+S |
| Mở repo | Cmd+O | Ctrl+O |
| Cửa sổ mới | Cmd+Shift+N | Ctrl+Shift+N |

- Cho phép chỉnh phím tắt trong settings (`keybindings.json`).

---

## 6. Graph

### 6.1 Dữ liệu
- `graph/walker.rs`: `gix` rev-walk từ tập ref đã chọn (mặc định: tất cả local + remote + tags + HEAD; stash tuỳ chọn), thứ tự topo, ưu tiên ngày commit.
- Phân trang 500 commit/trang. Trạng thái walker và **trạng thái làn** được giữ trong `RepoSession` để trang tiếp nối tiếp đúng.
- Khi refs thay đổi → reset walker, giữ vị trí cuộn theo sha nếu còn tồn tại.
- Dòng ảo **Uncommitted changes** ở đầu khi working tree bẩn (click → mở Source Control).

### 6.2 Thuật toán chia làn (`graph/lanes.rs`)
- Duy trì mảng `active: Vec<Option<Sha>>` — mỗi phần tử là commit mà làn đó đang "chờ".
- Với mỗi commit C theo thứ tự topo:
  1. Tìm các làn đang chờ C. Làn trái nhất là cột của C; các làn còn lại hội tụ vào C (edge merge-in) rồi đóng.
  2. Nếu không làn nào chờ C (đầu nhánh) → cấp làn trống trái nhất hoặc thêm làn mới.
  3. Parent đầu tiên tiếp tục ở làn của C. Mỗi parent phụ: nếu đã có làn chờ → edge tới làn đó; nếu chưa → mở làn mới.
  4. Dồn các làn trống ở cuối.
- Output mỗi dòng: `GraphRow { sha, col, color, edges: Vec<Edge{from_col, to_col, kind, color}> }`, `kind ∈ {Straight, MergeIn, BranchOut}`.
- Màu: hash ổn định của tên branch "sở hữu" làn (ưu tiên ref trỏ trực tiếp, nếu không thì kế thừa làn con), bảng 12 màu đọc tốt ở cả dark và light.
- Snapshot test cho các hình dạng: tuyến tính, merge 2 nhánh, octopus merge, nhiều root, criss-cross merge, nhánh dài song song.

### 6.3 Hiển thị
- `@tanstack/react-virtual` cho danh sách; một `<canvas>` phủ cột graph, chỉ vẽ các dòng đang hiện (+ đệm).
- Cột: Graph · Refs (nhãn branch/tag/remote/HEAD, có màu, tooltip khi quá dài) · Message · Author (avatar) · Date (tương đối/tuyệt đối) · SHA ngắn · CI badge.
- Cột thay đổi kích thước, ẩn/hiện được; lưu theo người dùng.
- HEAD hiển thị nổi bật; commit trên nhánh hiện tại đậm hơn, còn lại mờ nhẹ (tuỳ chọn).

### 6.4 Tương tác
- Click commit → panel chi tiết (dưới hoặc bên phải): sha, parents (click được), author/committer, ngày, message đầy đủ, chữ ký (verified/không), refs, danh sách file thay đổi (list/tree, +/− số dòng). Click file → mở diff Monaco.
- Cmd/Ctrl+click commit thứ hai → **so sánh A ↔ B** (danh sách file + diff).
- Tìm kiếm: message / author / sha / nội dung diff (`-S`, chạy CLI, có thể hủy); highlight kết quả, Enter/Shift+Enter để nhảy.
- Lọc: chọn branch (multi-select), ẩn/hiện remote, ẩn/hiện tags, ẩn/hiện stash, chỉ first-parent.
- Nút "Đi tới HEAD", phím `/` để tìm.

### 6.5 Menu chuột phải
**Trên commit:** Checkout (detached) · Create Branch… · Create Tag… (lightweight/annotated, tuỳ chọn push) · Cherry-pick · Revert · Reset current branch to here (soft/mixed/hard) · Merge into current branch · Rebase current branch onto this · Interactive rebase from here · Copy SHA · Copy message · Open on GitHub/GitLab · Explain commit (AI).

**Trên ref (branch/tag/remote):** Checkout · Merge into current · Rebase current onto · Rename · Delete (local/remote) · Push · Set upstream · Compare with HEAD · Create PR/MR · Open on web.

Mọi thao tác thay đổi lịch sử hiện dialog xác nhận có mô tả lệnh sẽ chạy. Reset hard và xoá branch chưa merge yêu cầu xác nhận hai bước.

---

## 7. Merge, rebase, conflict, blame

### 7.1 Trạng thái thao tác dở dang
- Phát hiện từ `.git/`: `MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`.
- Banner trên Source Control và Graph: "Rebasing `feature` onto `main` — bước 3/7" + nút **Continue / Skip / Abort**. Continue bị khoá khi còn file conflict.

### 7.2 Interactive rebase
- Bắt đầu từ graph ("Interactive rebase from here").
- App chạy `git rebase -i <base>` với `GIT_SEQUENCE_EDITOR=<vsc-git-sequence-editor>`. Helper đọc file todo, gửi về app qua IPC, chờ người dùng chỉnh rồi ghi lại.
- UI: danh sách commit, kéo thả đổi thứ tự, chọn action pick/reword/edit/squash/fixup/drop cho từng dòng. Nút Start / Cancel (Cancel → helper exit ≠ 0 → git hủy rebase).
- Reword/squash cần sửa message: `GIT_EDITOR` cũng trỏ helper, hiện dialog sửa message.

### 7.3 Merge conflict editor
- Mở khi click file trong nhóm Merge Changes.
- Ba khung: **Incoming (theirs, :3)** · **Current (ours, :2)** · **Result** (sửa được, khởi tạo từ file working tree có conflict markers). Base (:1) có thể bật xem.
- Mỗi vùng conflict: Accept Current / Accept Incoming / Accept Both (current trước) / Accept Base; đếm "còn N conflict", nút trước/sau.
- **Mark as Resolved**: ghi Result ra file → `git add`. Cảnh báo nếu vẫn còn marker `<<<<<<<`.
- Các trường hợp không phải text (binary, delete/modify, rename/rename): dialog chọn "giữ bản của ta / của họ / xoá".
- Nút "Open in external editor" cho ai muốn tự sửa.

### 7.4 Blame
- Mở từ menu file hoặc diff: Monaco chỉ đọc + decoration lề trái (tác giả, ngày tương đối, màu theo tuổi commit).
- Hover → tóm tắt commit; click → chọn commit đó trong Graph.
- Tuỳ chọn: bỏ qua whitespace (`-w`), phát hiện di chuyển dòng (`-M`, `-C`), tôn trọng `blame.ignoreRevsFile`.
- Blame tại một commit cũ ("blame trước commit này").

### 7.5 File history
- `git log --follow` cho một file, hiện dạng danh sách có mini graph; click → diff của file tại commit đó; theo dõi rename.

---

## 8. AI commit message

### 8.1 Provider
```rust
trait LlmProvider {
    fn id(&self) -> &str;
    async fn list_models(&self) -> Result<Vec<String>>;
    fn generate(&self, req: GenerateRequest, cancel: CancelToken)
        -> impl Stream<Item = Result<String>>;
}
```
| Provider | Cấu hình | Mặc định |
|---|---|---|
| Claude | API key (keyring), model | `claude-haiku-5-5`; tuỳ chọn `claude-sonnet-5-5` |
| OpenAI-compatible | base URL, API key, model | — (người dùng nhập) |
| Ollama | base URL | `http://localhost:11434`, model chọn từ `/api/tags` |

Streaming SSE/NDJSON; timeout kết nối 15 s; hủy được.

### 8.2 Input
- `git diff --cached --no-color --no-ext-diff -M` (chỉ phần staged).
- Danh sách file + trạng thái, tên branch.
- 10 subject commit gần nhất (để bắt chước style, ngôn ngữ, scope).
- Ràng buộc từ repo nếu có: `commitlint.config.*` / `.commitlintrc*` (đọc `type-enum`, `scope-enum`, `header-max-length`), hoặc `.vsc-git.json` → `commit.types`, `commit.scopes`.
- Số issue suy từ tên branch (`feat/ABC-123-...`, `fix/123-...`).

### 8.3 Ngân sách diff (`ai/diff_budget.rs`)
- Bỏ khỏi nội dung (chỉ giữ tên): lock file (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`, `poetry.lock`), file minified (`*.min.*`), file trong `dist/`, `build/`, file đánh dấu `linguist-generated` trong `.gitattributes`, binary. Danh sách chỉnh được trong settings.
- Ước tính token ≈ số ký tự / 3.5. Ngưỡng mặc định 20k token. Vượt ngưỡng → với mỗi file giữ header + thống kê +/− + các hunk đầu cho tới khi hết ngân sách; ghi chú "(đã cắt bớt)".

### 8.4 Che secret (`ai/redact.rs`)
Regex che trước khi gửi: AWS key, GitHub/GitLab token (`ghp_`, `github_pat_`, `glpat-`), Slack token, private key block (`-----BEGIN ... PRIVATE KEY-----`), JWT, chuỗi `password=`/`secret=`/`api_key=` trong file `.env*`. Thay bằng `[REDACTED]`.

### 8.5 Output
- Định dạng **Conventional Commits**: `type(scope)!: subject` (≤ 72 ký tự, mệnh lệnh, không dấu chấm cuối) + dòng trống + body (tại sao/cái gì, bullet nếu nhiều thay đổi) + footer (`BREAKING CHANGE: …`, `Refs: ABC-123`).
- Ngôn ngữ: theo setting (`auto` = theo các commit gần nhất, `en`, `vi`).
- Stream trực tiếp vào ô commit; một lần Undo khôi phục nội dung cũ; bấm ✨ lại để sinh lại.
- Hậu kiểm: nếu dòng đầu không khớp regex conventional → thử sửa (gán `chore:`) và cảnh báo nhẹ.

### 8.6 Cũng dùng AI cho
- Title + description PR/MR (input: log commit giữa base và head + diff tóm tắt).
- "Explain commit" trong graph.

### 8.7 Quyền riêng tư
- Lần đầu dùng provider từ xa trên một repo → dialog "Diff staged sẽ được gửi tới {provider} ({host}). Tiếp tục?" (nhớ theo repo).
- Danh sách repo cấm AI: theo đường dẫn glob hoặc pattern URL remote. Nút ✨ bị ẩn trong các repo này.
- Không ghi nội dung prompt/response vào log (chỉ ghi kích thước, model, thời gian).

---

## 9. Tích hợp GitHub / GitLab

### 9.1 Nhận diện
- Parse URL remote (`git@host:owner/repo.git`, `ssh://`, `https://`) → `(host, owner/namespace, repo)`.
- Bảng `hosts` trong settings: `{ host, kind: github|gitlab, api_base_url }`. Mặc định có `github.com` và `gitlab.com`; người dùng thêm GitHub Enterprise / GitLab self-hosted.
- Remote mặc định: `origin`; nếu có `upstream` thì PR nhắm tới `upstream` (tuỳ chọn).

### 9.2 Xác thực
- PAT cho từng host, lưu trong keyring với key `vsc_git/host/<host>`.
- "Test connection" gọi API user hiện tại và hiển thị scope. Scope cần: GitHub `repo`, `read:user` (fine-grained: Contents read, Pull requests read/write, Commit statuses read, Checks read); GitLab `api`.

### 9.3 Tính năng
| Tính năng | GitHub | GitLab |
|---|---|---|
| Tạo PR/MR | `POST /repos/{o}/{r}/pulls` | `POST /projects/{id}/merge_requests` |
| PR/MR của branch hiện tại | `GET /repos/{o}/{r}/pulls?head=` | `GET /projects/{id}/merge_requests?source_branch=` |
| Trạng thái CI | Check runs + combined status | Pipelines theo sha |
| Avatar | `GET /search/users?q={email}+in:email` / author từ API commit | `GET /avatar?email=` |
| Mở trên web | URL commit/branch/PR | URL commit/branch/MR |

- Tạo PR/MR: chọn base/head, title/body (AI điền giúp được), draft, reviewers (autocomplete), labels. Branch chưa push → đề nghị push trước.
- CI: badge ✓ ✗ ● ⊘ ở status bar, branch list, graph. Poll 60 s **chỉ khi cửa sổ focus**, cache theo sha, tôn trọng rate limit (`X-RateLimit-*`, `RateLimit-*`) — chạm ngưỡng thì giãn poll.
- Avatar cache trên đĩa 7 ngày; fallback Gravatar → chữ cái đầu.
- Thiếu token / host không xác định → ẩn các tính năng này, phần còn lại chạy bình thường.

---

## 10. Settings

Lưu tại `~/Library/Application Support/vsc_git/settings.json` (macOS) và `%APPDATA%\vsc_git\settings.json` (Windows). Secret **không** nằm trong file này.

```jsonc
{
  "git.path": null,                     // null = tìm trong PATH
  "git.autoFetch": true,
  "git.autoFetchPeriodSec": 180,
  "git.confirmSync": true,
  "git.enableSmartCommit": "ask",       // ask | always | never
  "git.untrackedChanges": "mixed",      // mixed | separate | hidden
  "git.pruneOnFetch": true,
  "git.defaultCloneDir": null,
  "scm.viewMode": "list",               // list | tree
  "diff.renderSideBySide": true,
  "diff.ignoreTrimWhitespace": false,
  "graph.showRemoteBranches": true,
  "graph.showTags": true,
  "graph.showStashes": true,
  "graph.dateFormat": "relative",
  "graph.pageSize": 500,
  "externalEditor.command": "code",     // ví dụ: "zed", "subl", "idea"
  "externalEditor.args": ["--goto", "{file}:{line}"],
  "ai.enabled": true,
  "ai.provider": "claude",              // claude | openai | ollama
  "ai.model": "claude-haiku-5-5",
  "ai.baseUrl": null,
  "ai.language": "auto",                // auto | en | vi
  "ai.maxDiffTokens": 20000,
  "ai.excludeGlobs": ["**/*.lock", "**/package-lock.json", "**/pnpm-lock.yaml", "**/*.min.*", "dist/**", "build/**"],
  "ai.disabledRepos": [],
  "hosts": [
    { "host": "github.com", "kind": "github", "apiBaseUrl": "https://api.github.com" },
    { "host": "gitlab.com", "kind": "gitlab", "apiBaseUrl": "https://gitlab.com/api/v4" }
  ],
  "ui.theme": "system",
  "update.channel": "stable"            // stable | beta
}
```

Settings riêng theo repo (tuỳ chọn, commit vào repo): `.vsc-git.json` — `commit.types`, `commit.scopes`, `ai.disabled`.

---

## 11. IPC (danh sách command chính)

Tất cả trả `Result<T, AppError>`; type TS sinh tự động.

| Nhóm | Command |
|---|---|
| App | `open_repo(path)`, `init_repo(path)`, `clone_repo(url, dir) -> JobId`, `recent_repos()`, `get_settings()`, `set_settings(patch)`, `git_version()`, `export_logs() -> path` |
| Status | `get_status() -> RepoStatus`, `refresh()` |
| Stage | `stage(paths)`, `unstage(paths)`, `discard(paths)`, `stage_all()`, `unstage_all()`, `stage_ranges(path, ranges)`, `unstage_ranges(path, ranges)`, `revert_ranges(path, ranges)` |
| Nội dung | `get_file_content(path, rev: Head|Index|Worktree|Commit(sha)|Stage(n))`, `save_worktree_file(path, content)` |
| Commit | `commit(CommitOptions)`, `last_commit_message()`, `get_draft_message()`, `set_draft_message()` |
| Branch/ref | `list_refs()`, `checkout(ref)`, `create_branch(name, start)`, `rename_branch`, `delete_branch(name, force)`, `delete_remote_branch`, `set_upstream`, `create_tag`, `delete_tag`, `push_tag` |
| Sync | `fetch(remote?) -> JobId`, `pull(opts) -> JobId`, `push(opts) -> JobId`, `sync() -> JobId` |
| Stash | `list_stashes()`, `stash_push(opts)`, `stash_apply(i)`, `stash_pop(i)`, `stash_drop(i)`, `stash_diff(i)` |
| History | `cherry_pick(sha)`, `revert(sha)`, `reset(sha, mode)`, `merge(ref, opts)`, `rebase(ref)`, `rebase_interactive(base) -> JobId`, `submit_rebase_todo(items)`, `op_continue()`, `op_skip()`, `op_abort()`, `get_operation_state()` |
| Conflict | `get_conflict(path) -> ConflictVersions`, `resolve_conflict(path, content)`, `resolve_with(path, Ours|Theirs|Delete)` |
| Graph | `graph_reset(filter)`, `graph_page(cursor) -> GraphPage`, `commit_detail(sha)`, `compare(a, b) -> Vec<FileChange>`, `graph_search(query) -> JobId` |
| Blame/history | `blame(path, rev?, opts)`, `file_history(path, cursor)` |
| Hosting | `host_info()`, `test_host_token(host)`, `set_host_token(host, token)`, `create_pull_request(req)`, `current_pull_request()`, `ci_status(shas)`, `avatar(email)` |
| AI | `ai_generate_commit() -> JobId`, `ai_generate_pr(base, head) -> JobId`, `ai_explain_commit(sha) -> JobId`, `ai_list_models()`, `set_ai_key(provider, key)` |
| Job | `cancel_job(id)` |
| Askpass | `answer_prompt(id, value | null)` |
| External | `open_in_editor(path, line?)`, `reveal_in_file_manager(path)`, `open_url(url)` |

Event: `repo://status-changed`, `repo://refs-changed`, `repo://operation-changed`, `job://progress`, `job://chunk` (AI stream), `job://done`, `prompt://request` (askpass/sequence editor), `git://output`.

---

## 12. Xử lý lỗi

```rust
struct AppError {
    kind: ErrorKind,
    message: String,          // thân thiện, hiển thị cho người dùng
    git_stderr: Option<String>,
    hint: Option<Hint>,       // hành động gợi ý
}
enum ErrorKind {
    NotARepo, GitMissing, GitTooOld, IndexLocked, Conflict, DirtyWorktree,
    AuthFailed, NonFastForward, HookFailed, NothingToCommit, Network,
    PatchFailed, HostApi, AiProvider, Cancelled, Internal,
}
```

| Kind | UI |
|---|---|
| `GitMissing` / `GitTooOld` | Màn hình hướng dẫn cài/cập nhật git, link tải |
| `IndexLocked` | "Có tiến trình git khác đang chạy?" → Thử lại / Xoá `index.lock` (xác nhận) |
| `NonFastForward` | "Remote có commit mới" → Pull rồi Push / Force (with lease) |
| `AuthFailed` | Gợi ý kiểm tra SSH key / credential helper / PAT |
| `HookFailed` | Hiện output hook; nút "Commit với --no-verify" |
| `DirtyWorktree` | Stash & tiếp tục / Huỷ |
| `PatchFailed` | "Diff đã thay đổi, refresh và thử lại" |

- Toast có nút "Chi tiết" (stderr đầy đủ) và "Mở Git Output".
- Panic trong Rust được bắt, ghi log, hiển thị lỗi `Internal` thay vì crash.

---

## 13. Bảo mật

- Secret (PAT, API key AI) chỉ nằm trong keyring hệ điều hành (crate `keyring`).
- Log: che URL có credential (`https://user:token@`), header `Authorization`, biến môi trường nhạy cảm.
- Tauri capabilities tối thiểu: frontend **không** có plugin shell/fs; mọi truy cập qua command của app. Command nhận đường dẫn phải nằm trong repo đang mở (kiểm tra canonical path).
- CSP: `default-src 'self'`; `connect-src` chỉ IPC; mọi HTTP ra ngoài (hosting, AI) đi từ Rust.
- Askpass IPC: socket/pipe chỉ người dùng hiện tại truy cập, token ngẫu nhiên mỗi phiên.
- Thao tác nguy hiểm luôn xác nhận; force push luôn dùng `--force-with-lease`; discard untracked đưa vào Thùng rác.

---

## 14. Hiệu năng

- Status: tôn trọng `core.fsmonitor`, `core.untrackedCache`; không chạy lại khi status đang chạy (gộp yêu cầu).
- Watcher bỏ qua `.git/objects`, `node_modules`, `target`, và các thư mục ignored lớn (đọc từ `git check-ignore` cho thư mục cấp 1).
- Graph: walker + lanes trong Rust, gửi dữ liệu gọn; canvas chỉ vẽ vùng nhìn thấy.
- Monaco: lazy load, chỉ nạp các ngôn ngữ cần; worker diff chạy nền.
- Đo đạc: `tracing` span cho từng command; trang debug ẩn hiển thị thời gian các lệnh git.
- Benchmark repo mẫu: repo nhỏ (100 commit), repo trung bình (20k commit, 5k file), repo lớn (linux kernel shallow 200k commit hoặc tương đương).

---

## 15. Test

| Tầng | Công cụ | Nội dung |
|---|---|---|
| Unit Rust | `cargo test`, `insta` | Parser status v2, blame porcelain, log; `patch.rs` (bảng ca: CRLF, no newline, hunk liền kề, chọn 1 dòng, file mới, file xoá); `lanes.rs` snapshot; `remote_url`; `diff_budget`; `redact` |
| Integration Rust | `tempfile` + git thật | Fixture script tạo repo: merge, conflict, rebase dở, rename, binary, submodule, hooks lỗi. Chạy op → kiểm trạng thái bằng git CLI |
| Hosting/AI | `wiremock` | Tạo PR/MR, CI status, rate limit, stream SSE/NDJSON, hủy giữa chừng |
| Frontend | Vitest + Testing Library | Store, Source Control list, commit box, graph row rendering, conflict editor actions |
| E2E | Playwright trên build web với mock IPC | Luồng: mở repo → stage hunk → commit; graph → cherry-pick; giải conflict |
| CI | GitHub Actions hoặc GitLab CI | macOS arm64, macOS x64, Windows x64; git 2.35 và git mới nhất |

Tiêu chí merge: test pass trên cả 3 nền tảng, `cargo clippy -D warnings`, `eslint`, `tsc --noEmit`.

---

## 16. Đóng gói & phát hành

- **macOS:** universal `.dmg` (arm64 + x64), ký Developer ID Application, notarize + staple.
- **Windows:** NSIS `.exe` (per-user, không cần admin) + `.msi` (cho IT triển khai), ký bằng Azure Trusted Signing hoặc chứng chỉ OV/EV của công ty. WebView2 bootstrapper nhúng.
- **Helpers** (`askpass`, `sequence-editor`) đóng gói dạng sidecar, ký cùng app.
- **Auto-update:** `tauri-plugin-updater`, manifest `latest.json` ký bằng updater key, host trên server nội bộ hoặc S3; kênh `stable` / `beta`. Kiểm tra khi khởi động + mỗi 6 giờ; người dùng chọn "Cập nhật & khởi động lại".
- **Phiên bản:** semver; CHANGELOG sinh từ conventional commits của chính repo.
- **Telemetry:** không có. Hỗ trợ qua "Export logs" (zip log + phiên bản app/git/OS, đã che secret).

---

## 17. Milestones

| M | Nội dung | Kết quả kiểm chứng | Ước lượng |
|---|---|---|---|
| **M0** | Khung Tauri 2 + React + Vite + specta; mở repo, recent, watcher, Git Output, settings, CI build 3 nền tảng | Mở repo bất kỳ, thấy branch + log lệnh git | 3–4 ngày |
| **M1** | Source Control đầy đủ: status, diff Monaco, stage/unstage/discard file + hunk + dòng, commit (amend, signoff, no-verify, smart commit), branches, stash, fetch/pull/push/sync có tiến độ & hủy, askpass, mở editor ngoài | Dùng thay VS Code cho stage/commit/sync hằng ngày | 2–3 tuần |
| **M2** | Graph chỉ xem: walker, lanes, canvas, virtual scroll, chi tiết commit, so sánh 2 commit, tìm kiếm, lọc | Repo 200k commit cuộn 60 fps, trang đầu < 300 ms | 1.5–2 tuần |
| **M3** | Thao tác graph (checkout, branch, tag, cherry-pick, revert, reset, merge, rebase, interactive rebase), banner continue/abort, conflict editor 3 cột, blame, file history | Giải được conflict merge/rebase hoàn toàn trong app | 2–3 tuần |
| **M4** | AI commit/PR/explain với 3 provider, redact, diff budget; GitHub/GitLab: PAT, tạo PR/MR, CI badge, avatar | Sinh commit conventional đúng chuẩn; tạo PR/MR từ app | 1.5–2 tuần |
| **M5** | Ký + notarize, installer, updater, kiểm thử hiệu năng, sửa lỗi, beta nội bộ | Đồng nghiệp tự cài và tự cập nhật được | 1 tuần |
| | **Tổng** | | **~9–12 tuần** (1 người, có AI hỗ trợ) |

---

## 18. Rủi ro & giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| `gix` thiếu tính năng / lỗi với repo đặc biệt (sparse, partial clone, SHA-256) | Graph/đọc sai | Fallback CLI tự động; test fixture cho các loại repo |
| Stage từng dòng sai patch ở ca hiếm | Mất/sai thay đổi | `git apply` atomic; bộ test bảng ca lớn; ca không chắc chắn → báo lỗi thay vì đoán |
| Tạo process chậm trên Windows | Refresh chậm | Gộp lệnh, cache, dùng `gix` cho đọc, debounce |
| WebView2/WebKit khác biệt render | UI lệch giữa 2 OS | E2E/screenshot cả 2 nền tảng trong CI |
| Askpass/SSH passphrase phức tạp (agent, hardware key) | Push/pull treo | `GIT_TERMINAL_PROMPT=0`, timeout prompt, hướng dẫn dùng ssh-agent |
| Chi phí ký app Windows / Apple Developer | Chậm phát hành | Chuẩn bị chứng chỉ từ M0; beta nội bộ có thể chạy bản chưa ký kèm hướng dẫn |
| Rò rỉ code qua AI | Bảo mật | Mặc định chỉ staged diff, redact, cảnh báo lần đầu, danh sách repo cấm, lựa chọn Ollama local |
| License | Pháp lý | Git extension của VS Code (MIT) được tham khảo; **Git Graph (mhutchie) có license riêng hạn chế phái sinh — chỉ tham khảo hành vi, không sao chép code/asset** |

---

## 19. Phụ lục — Tham chiếu

- VS Code git extension: `microsoft/vscode/extensions/git/src` (`git.ts`, `repository.ts`, `staging.ts`, `commands.ts`) — MIT.
- Conventional Commits 1.0.0: https://www.conventionalcommits.org
- Tauri 2: https://v2.tauri.app · gitoxide: https://github.com/GitoxideLabs/gitoxide · Monaco: https://microsoft.github.io/monaco-editor
- git porcelain v2: `git help status` (mục "Porcelain Format Version 2").
