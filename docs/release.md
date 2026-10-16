# Quy trình Đóng gói & Phát hành (Release & Packaging)

Tài liệu hướng dẫn quy trình phát hành, cấu hình chữ ký số, auto-updater và chính sách rollback cho **vsc_git** theo Spec 14 và Spec 16.

---

## 1. Tổng quan kiến trúc đóng gói

- **macOS:** Universal Binary (`universal-apple-darwin`, hỗ trợ cả Apple Silicon `aarch64` và Intel `x86_64`) đóng gói dạng `.dmg`.
  - Helpers (`vsc-git-askpass`, `vsc-git-sequence-editor`) được biên dịch cho cả hai kiến trúc và ghép bằng `lipo` thành universal binary.
  - Ký bằng Developer ID Application, notarize và staple qua Apple Notary Service.
- **Windows:** Kiến trúc x64 (`x86_64-pc-windows-msvc`).
  - Bộ cài NSIS per-user (`.exe`, không yêu cầu quyền Admin) và MSI (`.msi`, hỗ trợ triển khai IT doanh nghiệp qua GPO/Intune).
  - Webview2 runtime nhúng bootstrapper (`embedBootstrapper`).
  - Ký số bằng chứng chỉ EV/OV hoặc Azure Trusted Signing.
- **Auto-Update:** Sử dụng `tauri-plugin-updater` với manifest `latest.json` được ký bằng Minisign private key.
  - Ứng dụng tự động kiểm tra bản cập nhật khi khởi động và định kỳ mỗi 6 giờ.
  - Giao diện hiển thị banner thông báo với nút **"Cập nhật & khởi động lại"**.

---

## 2. Secrets cần thiết trên GitHub Actions

Để quy trình ký và phát hành tự động chạy đầy đủ, cấu hình các Repository Secrets sau trên GitHub (`Settings -> Secrets and variables -> Actions`):

### 2.1. Apple Developer (macOS Signing & Notarization)
| Secret | Mô tả |
|---|---|
| `APPLE_CERTIFICATE` | Nội dung file chứng chỉ Developer ID Application (`.p12`) mã hóa base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Mật khẩu giải mã file `.p12` |
| `APPLE_SIGNING_IDENTITY` | Tên identity ký, ví dụ: `Developer ID Application: Company Name (TEAM_ID)` |
| `APPLE_ID` | Email tài khoản Apple Developer |
| `APPLE_PASSWORD` | App-specific password tạo từ appleid.apple.com |
| `APPLE_TEAM_ID` | 10 ký tự Team ID của tổ chức trên Apple Developer |

### 2.2. Windows Code Signing
| Secret | Mô tả |
|---|---|
| `WINDOWS_CERTIFICATE` | File chứng chỉ code signing (`.pfx`) mã hóa base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Mật khẩu giải mã file `.pfx` |
| *(Tùy chọn)* `AZURE_KEY_VAULT_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Dành cho Azure Trusted Signing |

### 2.3. Tauri Updater Signing
| Secret | Mô tả |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key string sinh từ `pnpm tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Mật khẩu của private key (để trống nếu không đặt mật khẩu) |

### 2.4. Cơ chế dự phòng khi thiếu Secrets (Unsigned Build)
Workflow phát hành (`.github/workflows/release.yml`) được thiết kế **có điều kiện (conditional)**:
- Nếu không có secret chứng chỉ Apple hoặc Windows, workflow sẽ in cảnh báo `::warning::` vào log và tự động chuyển sang chế độ **build unsigned**.
- Nếu không có `TAURI_SIGNING_PRIVATE_KEY`, workflow sẽ bỏ qua bước ký manifest cập nhật và không sinh `latest.json`, chỉ tải lên các file cài đặt (`.dmg`, `.exe`, `.msi`).
- Nhờ vậy, CI/release workflow luôn chạy thành công mà không bị crash khi chạy thử nghiệm nội bộ hoặc trên repository fork.

---

## 3. Quản lý khóa Updater (Signing Keypair)

Tauri Updater sử dụng mật mã Minisign Ed25519 để đảm bảo an toàn và tính toàn vẹn cho các bản cập nhật.

> **LƯU Ý QUAN TRỌNG VỀ PUBLIC KEY:**
> Khóa `plugins.updater.pubkey` đang được commit trong file `src-tauri/tauri.conf.json` hoàn toàn là một **PLACEHOLDER** và đội ngũ phát triển **KHÔNG GIỮ BẤT KỲ PRIVATE KEY NÀO** tương ứng với khóa này.
> Trước khi thực hiện bản phát hành đầu tiên (first release), người phụ trách phát hành (maintainer) **BẮT BUỘC** phải tự sinh cặp khóa mới, cập nhật lại `pubkey` trong `tauri.conf.json`, và cấu hình `TAURI_SIGNING_PRIVATE_KEY` vào GitHub Secrets.

### 3.1. Tạo cặp khóa mới cho môi trường sản xuất
Người quản trị repository chạy lệnh sau tại máy trạm cá nhân:
```bash
pnpm tauri signer generate
```
Lệnh sẽ sinh ra một cặp khóa:
1. **Public Key:** Thay thế giá trị placeholder tại trường `plugins.updater.pubkey` trong file `src-tauri/tauri.conf.json` rồi commit vào git.
2. **Private Key:** Lưu trữ an toàn trong trình quản lý mật khẩu của tổ chức và thêm vào GitHub Repository Secret với tên `TAURI_SIGNING_PRIVATE_KEY` (kèm `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nếu có đặt mật khẩu cho khóa).

> **CẢNH BÁO AN TOÀN:**
> - **TUYỆT ĐỐI KHÔNG BAO GIỜ** commit Private Key vào git hay in private key ra log CI/terminal công khai.
> - Nếu mất Private Key hoặc mật khẩu, bạn sẽ không thể ký tiếp các bản cập nhật tự động cho client hiện tại và người dùng sẽ phải gỡ cài đặt để cài lại bản mới thủ công.
---

## 4. Quy trình phát hành từng bước (Step-by-step Release)

### Bước 1: Đồng bộ phiên bản (Bump Version)
Sử dụng script không phụ thuộc:
```bash
# Tăng patch: 0.1.0 -> 0.1.1
node scripts/bump-version.mjs patch

# Hoặc tăng minor: 0.1.0 -> 0.2.0
node scripts/bump-version.mjs minor

# Hoặc đặt phiên bản cụ thể
node scripts/bump-version.mjs 1.0.0
```
Script sẽ tự động cập nhật đồng bộ 4 vị trí:
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- Root `Cargo.toml`
- Đồng thời cập nhật `Cargo.lock`.

### Bước 2: Sinh CHANGELOG từ Conventional Commits
```bash
node scripts/changelog.mjs --write
```
Script sẽ phân tích lịch sử commit từ tag gần nhất đến HEAD, tự động phân nhóm theo:
- Features (`feat`)
- Bug Fixes (`fix`)
- Performance Improvements (`perf`)
- Refactoring, Docs, CI, Build, Tests, Chores
- Breaking Changes (`!`)
và ghi vào đầu file `CHANGELOG.md`.

### Bước 3: Commit và gắn Tag
```bash
git add .
git commit -m "chore(release): v0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

### Bước 4: Kiểm tra và xuất bản trên GitHub
1. Tag `v*` kích hoạt GitHub Actions workflow `.github/workflows/release.yml`.
2. Job `create-release` tạo một **Draft Release** trên GitHub với ghi chú phát hành từ changelog.
3. Job `build-tauri` chạy matrix:
   - macOS runner: biên dịch sidecar universal, đóng gói `.dmg`, ký & notarize (nếu có secret).
   - Windows runner: biên dịch sidecar x64, đóng gói NSIS installer và MSI installer, ký số (nếu có secret).
   - Nếu có `TAURI_SIGNING_PRIVATE_KEY`, sinh updater bundle (`.tar.gz`, `.zip`), ký chữ ký điện tử `.sig` và sinh file `latest.json`.
4. Sau khi workflow hoàn tất, vào mục **Releases** trên GitHub, kiểm tra các artifact và nhấn **"Publish release"**.

---

## 5. Quy trình Rollback (Khắc phục sự cố)

Trong trường hợp phiên bản vừa phát hành gặp lỗi nghiêm trọng:

1. **Gỡ bỏ tạm thời bản cập nhật tự động:**
   - Xóa file `latest.json` trên release bị lỗi hoặc sửa `latest.json` để không trỏ tới bản cài đặt hỏng.
   - Chuyển trạng thái Release trên GitHub từ *Published* sang *Draft* hoặc *Pre-release*.
2. **Khuyến nghị chuẩn (Hotfix Release):**
   - Bộ cập nhật của Tauri Updater chỉ cho phép nâng lên phiên bản có số semver cao hơn phiên bản hiện tại của client.
   - Vì vậy, cách khắc phục triệt để nhất là tạo ngay một bản **Hotfix** (ví dụ: `v0.2.1` hoàn tác commit lỗi):
     ```bash
     git revert <commit_hash>
     node scripts/bump-version.mjs patch
     node scripts/changelog.mjs --write
     git commit -am "fix(release): revert problematic change"
     git tag v0.2.1
     git push origin main --tags
     ```
   - Bản `v0.2.1` sẽ được đóng gói và updater client sẽ tự động nhận diện và cập nhật người dùng về trạng thái an toàn.

---

## 6. Kiểm thử Hiệu năng (Performance Benchmarks - Spec 14)

Để đảm bảo hiệu năng theo tiêu chuẩn Spec 14:
- Status < 500 ms (tôn trọng fsmonitor/untrackedCache).
- Graph first page < 300 ms với repo 20.000 commits.
- Log (100 commits) < 200 ms.
- Diff < 100 ms.

### Chạy kiểm thử cục bộ:
```bash
# Chạy với repo nhỏ (100 commits)
pnpm bench

# Chạy đầy đủ cả repo nhỏ và repo lớn (20k commits / 5k files tạo nhanh qua git fast-import)
node scripts/bench/run-bench.mjs --all
```

### Chạy kiểm thử trên GitHub Actions:
Vào tab **Actions** -> Chọn workflow **"Benchmark"** -> Nhấn **Run workflow** (`workflow_dispatch`). Repo mẫu lớn được tạo tự động trong bộ nhớ đệm và xóa ngay sau khi đo đạc, không đưa dữ liệu repo lớn vào git.
