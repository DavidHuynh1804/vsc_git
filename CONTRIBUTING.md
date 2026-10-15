# Quy ước làm việc

## Cấu trúc
- `crates/git-core/` — thư viện Rust thuần (không phụ thuộc Tauri): chạy git CLI, parser, patch, graph lanes. Test được độc lập.
- `src-tauri/` — app Tauri 2, chỉ là lớp mỏng: command IPC, session, watcher, gọi xuống `git-core`.
- `src/` — frontend React + TypeScript + Vite.

## Branch & commit
- Mỗi feature một branch `feat/<tên>` (hoặc `fix/`, `chore/`), tách từ `main`.
- Commit nhỏ, theo **Conventional Commits** (`feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, `chore: ...`).
- Commit + `git push` sau mỗi đơn vị tính năng hoàn chỉnh (build/test pass) — không gom một commit khổng lồ.
- Mở PR vào `main` bằng `gh pr create` khi feature xong; PR mô tả phần đã làm + cách kiểm chứng.

## Chất lượng
- Trước khi chạy `cargo test` lần đầu (hoặc sau khi clean), chạy `pnpm sidecars` để compile và copy sidecar binaries vào `src-tauri/binaries/` (bắt buộc cho `tauri-build`).
- Rust: `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test` phải pass.
- Frontend: `pnpm lint`, `pnpm typecheck`, `pnpm test` phải pass.
- Không sao chép code/asset từ extension Git Graph (mhutchie) — license riêng. Tham khảo VS Code git extension (MIT) được.
