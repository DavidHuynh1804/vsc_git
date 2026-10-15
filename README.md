# vsc_git

Git client desktop nhẹ, tái hiện trải nghiệm **Source Control của VS Code** + **Git Graph**.
Rust (Tauri 2) + React + Monaco · macOS & Windows.

- Spec: [docs/spec.md](docs/spec.md)
- Quy ước đóng góp: [CONTRIBUTING.md](CONTRIBUTING.md)

> Trạng thái: đang phát triển (M0).

## Phát triển

Yêu cầu: Node.js 22+, pnpm 11+, Rust stable.

```bash
# Cài đặt dependency
pnpm install

# Build sidecars (askpass, sequence-editor) trước khi test/dev Rust
pnpm sidecars

# Chạy app dev
pnpm tauri dev

# Kiểm tra code & test
pnpm lint && pnpm typecheck && pnpm test
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
