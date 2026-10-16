# UI/UX Polish Audit — vsc_git

> Báo cáo kiểm định giao diện và trải nghiệm người dùng hiện trạng của **vsc_git** theo hai bộ tiêu chuẩn:
> 1. `design-taste-frontend` (Design Systems, Anti-slop, Information-dense Desktop DevTools, Visual Consistency).
> 2. `web-design-guidelines` (Web Interface Guidelines, Accessibility WCAG AA, Keyboard Navigation, Focus States, Theming).

---

## 1. Phân tích bối cảnh & Đọc vị thiết kế (Design Read & Dials)

Theo tiêu chuẩn `design-taste-frontend`:

- **Design Read**: Công cụ Git client độc lập cho lập trình viên (dùng cả ngày trên macOS và Windows), ngôn ngữ giao diện VS Code Modern (Activity bar, Sidebar, Editor tabs, Status bar, Diff editor, Git Graph), tối ưu mật độ thông tin cao, thao tác nhanh, độ tương phản sắc nét, không hiệu ứng lòe loẹt.
- **Dial Configuration**:
  - `DESIGN_VARIANCE: 3` (Bố cục kỷ luật, cấu trúc lưới chặt chẽ, bảo toàn thói quen cơ học của người dùng VS Code).
  - `MOTION_INTENSITY: 2` (Micro-interactions nhẹ, phản hồi tức thời dưới 150ms, không animation chuyển động dài gây mỏi mắt, tôn trọng `prefers-reduced-motion`).
  - `VISUAL_DENSITY: 9` (Mật độ thông tin cao của desktop devtool: danh sách commit, file status, diff hunks, status bar compact, font hệ thống sắc nét, font monospace cho SHA/branch/diff).
- **Hệ màu & Shape Consistency**:
  - Khóa hệ bo góc (Shape Consistency Lock): Tất cả interactive items (buttons, inputs, badges) đồng nhất theo thang `rounded-sm` (2px - 4px) đúng phong cách VS Code.
  - Khóa hệ màu chủ đạo (Color Consistency Lock): Sử dụng `--vscode-accent` (`#007acc` cho Dark / `#005fb8` cho Light) làm accent chính duy nhất; trạng thái ngữ nghĩa: success (`#89d185` / `#388a34`), error (`#f14c4c` / `#e51400`), warning (`#cca700` / `#bf8803`), lane graph (bảng 12 màu tương phản cao, tối ưu cả light lẫn dark).

---

## 2. Kết quả kiểm toán Lighthouse & Web Interface Guidelines

Chạy tự động bằng headless browser trên dev server (`http://localhost:5173/`):
- **Accessibility Score**: 84/100 (Cần khắc phục để đạt 98-100)
- **Best Practices Score**: 96/100

### 2.1 Các lỗi Accessibility & ARIA nghiêm trọng (Lighthouse flagged)
1. **`aria-required-parent` (Lỗi nghiêm trọng)**:
   - Các file item trong Source Control có `role="treeitem"` nhưng thẻ cha không có `role="tree"` hay `role="group"`.
   - Các tab trong `EditorArea` có `role="tab"` nhưng thanh tab chứa nó không có `role="tablist"`.
2. **`button-name` (Lỗi nghiêm trọng)**:
   - Nút mũi tên Commit split-button (`button.flex` cạnh nút "Commit") không có `aria-label` hay accessible name.
   - Nút đóng tab, nút toggle theme, nút toggle Git Output thiếu `aria-label` chi tiết.
3. **`color-contrast` (Lỗi WCAG AA)**:
   - Biến `--vscode-muted: #858585` trên nền `--vscode-bg: #1e1e1e` và `--vscode-sidebar: #252526` chỉ đạt tỉ lệ tương phản 3.8:1 - 4.1:1, không đạt chuẩn WCAG AA (tối thiểu 4.5:1 cho văn bản thông thường).
   - Trong ô tìm kiếm Titlebar: chữ placeholder `#858585` trên nền `#3c3c3c` chỉ đạt contrast 2.98:1.
   - Thẻ tag và badge chữ nhỏ bị mờ khó đọc trong cả light và dark mode.
4. **Interactive States & Keyboard**:
   - Thiếu `focus-visible` ring đồng bộ. Các phần tử dùng `outline-none` mà không có viền chỉ báo bàn phím.
   - Các form input thiếu thuộc tính `spellCheck={false}` đối với các trường code, branch, SHA, commit message prefix.

---

## 3. Danh sách vấn đề chi tiết theo từng nhóm (A đến G)

### Nhóm A: Design tokens & Light/Dark Theme
- **Vấn đề**:
  1. Chưa có khai báo `color-scheme: dark` / `color-scheme: light` trên `:root` và `html`, dẫn đến scrollbar trình duyệt và native select hiển thị sai chế độ trên hệ điều hành.
  2. Light theme bị lỗi nghiêm trọng về token: `--vscode-activity: #2c2c2c` (màu tối) được dùng làm nền cho tab bar của editor (`EditorArea.tsx`), khiến thanh tab trong Light theme biến thành dải màu đen kẹp giữa nội dung trắng.
  3. Biến `--vscode-muted` ở Dark theme (`#858585`) không đạt chuẩn contrast AA 4.5:1; ở Light theme (`#6e6e6e`) mờ nhạt.
  4. Trình chuyển theme trong `stores/ui.ts` và `ActivityBar.tsx` xử lý sai logic khi trạng thái ban đầu là `system` (click lần đầu từ system không đổi sang light đúng kỳ vọng). Thiếu listener tự động theo dõi `prefers-color-scheme` khi người dùng chọn `system`.
  5. Thiếu các utility CSS cốt lõi trong `src/index.css`: `.hidden`, `.group-hover:flex`, `.group-hover:hidden`, `.focus-visible:ring-1`, `.focus-visible:ring-vscode-accent`.
- **Mức độ**: Nghiêm trọng (Blocker giao diện).
- **Cách sửa**:
  - Bổ sung đầy đủ token semantic vào `src/index.css`: `--vscode-tab-bar-bg`, `--vscode-focus-border`, `--vscode-badge-bg`, `--vscode-badge-fg`.
  - Cập nhật giá trị `--vscode-muted` đạt chuẩn contrast AA (Dark: `#9d9d9d` / `#a6a6a6`, Light: `#505050`).
  - Thêm `color-scheme` tự động và media query `@media (prefers-color-scheme: light)` hoặc class `.light`.
  - Bổ sung bộ utility CSS trong `src/index.css` cho `.hidden`, hover group, focus-visible.
  - Sửa `stores/ui.ts` để đồng bộ theme giữa Settings và UI store, hỗ trợ media query listener khi ở chế độ `system`.

### Nhóm B: Shell (Titlebar, Activity Bar, Sidebar, Status Bar, Editor Tabs)
- **Vấn đề**:
  1. **Titlebar**: Ô tìm kiếm Command Palette căn giữa có độ tương phản thấp; phím tắt `Cmd+K` / `Ctrl+K` kích thước và viền chưa tinh tế; nút `Sync` thiếu trạng thái hover/active rõ ràng.
  2. **Activity Bar**: Các icon dưới cùng (Theme toggle, Settings) bị biến màu thành đen-trên-đen trong Light theme do thừa kế màu `text-vscode-muted`. Viền chỉ báo active (vạch 2px bên trái) chưa căn chuẩn.
  3. **Sidebar**:
     - `OperationBanner` ("Rebasing...", "Merging...") bị tràn chữ, văn bản bước tiến trình đè lên các nút thao tác Continue/Skip/Abort trên màn hình hẹp.
     - Thanh kéo giãn chiều rộng Sidebar (resizer) thiếu trạng thái hover visual (đổi màu viền accent) và trạng thái `cursor-col-resize` mượt mà.
  4. **Editor Tabs**:
     - Thẻ tab thiếu `role="tablist"` bao bọc.
     - Tab bar background dùng sai token (`bg-vscode-activity`).
     - Nút đóng tab (X) thiếu `aria-label="Close tab"`.
  5. **Status Bar**:
     - Nền màu `#007acc` điện quá gắt, nút Git Output ở góc phải có viền/nền trắng bất thường không ăn nhập với layout status bar của VS Code.
     - Các item status thiếu padding chuẩn và trạng thái hover nhẹ.
- **Mức độ**: Cao.
- **Cách sửa**:
  - Chuẩn hóa layout Titlebar với token `bg-vscode-titlebar`, làm rõ border của ô tìm kiếm và badge branch.
  - Đảm bảo icon trong Activity bar luôn có contrast cao trên cả hai theme.
  - Thiết kế lại `OperationBanner` dạng 2 hàng hoặc flex-wrap thông minh, ngăn chặn đè chữ.
  - Đưa Editor Tabs về token riêng, viền tab active 1px accent, tablist chuẩn a11y.
  - Tinh chỉnh Status Bar: màu nền dịu mắt hơn (`#007acc` cho Dark, `#0066b8` cho Light), các button ở status bar thiết kế phẳng dạng VS Code status item, bỏ nút trắng thô ở góc phải.

### Nhóm C: Source Control & Diff View
- **Vấn đề**:
  1. **File Item Action Buttons**: Do thiếu class `.hidden` và `.group-hover:flex` trong CSS thuần, các nút thao tác (Stage `+`, Discard `↺`, Open `↗`, More `…`) luôn luôn hiển thị trên từng hàng file, chiếm hết chiều ngang và làm tên file bị co rúm thành vài ký tự.
  2. **Commit Box**:
     - Nút AI ✨ (`Sparkles`) định vị tuyệt đối đè lên chữ placeholder `Message (Cmd+Enter to commit)` bên trong textarea.
     - Split button `Commit ▾`: nút mũi tên chevron bên phải bị lệch viền, thiếu `aria-label`, không có focus ring.
  3. **Diff View**:
     - Thanh công cụ DiffToolbar có nút toggle Inline/Side-by-side và Stage Hunk thiếu hover state sắc nét và contrast thấp trong Light theme.
     - Textarea và diff viewer thiếu đồng bộ theme Monaco khi chuyển qua lại Light/Dark.
- **Mức độ**: Nghiêm trọng (Gây khó sử dụng thực tế).
- **Cách sửa**:
  - Sửa lại CSS để action buttons của file chỉ hiện khi hover chuột vào hàng (`group-hover`), bình thường chỉ hiện status badge (M, A, D, U, R) ở góc phải.
  - Thiết kế lại góc nhập commit message: nút AI ✨ đặt ở góc phải bên dưới hoặc trên toolbar commit box, không đè lên placeholder văn bản.
  - Tinh chỉnh split button Commit liền khối, có `aria-label="Commit actions"` cho chevron dropdown.
  - Cập nhật DiffToolbar và ImageDiffView/BinaryDiffView cho hiển thị sắc nét ở cả hai theme.

### Nhóm D: Git Graph View
- **Vấn đề**:
  1. **Lane colors**: Một số màu trong mảng 12 lane có độ tương phản chưa tối ưu khi chuyển qua Light theme (ví dụ màu vàng `#eab308` hoặc xanh lục nhạt khó đọc trên nền trắng).
  2. **Commit row layout**: Cột Refs badge, Monospace SHA, Author, Relative time cần khoảng cách đệm (gap/padding) chuẩn xác theo lưới, tránh giật khi cuộn.
  3. **Canvas Graph Rendering**: Cần đảm bảo canvas vẽ nét mượt, đường cong rẽ nhánh mềm mại, các commit node có viền rõ ràng.
  4. Nút "Go to HEAD" và thanh công cụ tìm kiếm lọc branch cần đồng bộ giao diện VS Code widget.
- **Mức độ**: Cao.
- **Cách sửa**:
  - Tinh chỉnh bảng 12 màu lane (`--lane-0` đến `--lane-11`) trong cả hai theme: sẫm màu và rõ nét hơn ở Light theme, tươi sáng vừa phải ở Dark theme.
  - Ref badge: bo góc 3px, font chữ 11px gọn, có viền nhẹ để phân tách trên nền canvas.
  - SHA hiển thị dạng font mono tabular, contrast cao.
  - Tinh chỉnh toolbar đồ thị và commit detail panel với layout ngăn nắp, tab file diff trực quan.

### Nhóm E: Dialogs, Toast, Command Palette, Welcome & Settings
- **Vấn đề**:
  1. **Command Palette**:
     - Các item danh sách lệnh có icon không đều (một số có icon, một số không), khiến chữ bị thụt thò không thẳng hàng.
     - Ô input search thiếu styling focus tinh tế, phím mũi tên điều hướng cần highlight rõ ràng hơn.
  2. **Dialogs & Modals**:
     - `ConfirmDialog`, `CreatePrDialog`, `PromptDialog` thiếu thuộc tính `overscroll-behavior: contain`.
     - Lớp backdrop phủ đen (`inset-0 bg-black/50`) cần chuyển tiếp mượt mà, viền dialog sắc nét, box-shadow nổi bật.
  3. **Error Toast & Notifications**:
     - `ErrorToast` nằm ở góc trên bên trái (`top-4 left-4`) đè trực tiếp lên thanh công cụ Titlebar và Activity bar. Cần chuyển về vị trí góc dưới bên phải (`bottom-8 right-6`) giống VS Code notification.
     - Cần có `role="alert"` hoặc `aria-live="polite"`.
  4. **Welcome View**:
     - Khối "Open Repository" và "Clone Repository" có contrast xám trên xám khó nhìn.
     - Cần bố cục thoáng đãng, phân cấp rõ ràng giữa Start, Recent Repositories và Quick Shortcuts.
  5. **Settings View**:
     - Cột danh mục cài đặt bên trái dùng nút thẻ vuông màu xám thô, hover chưa mượt.
     - Ô chọn Theme và các input setting cần border và padding chỉn chu theo chuẩn VS Code form controls.
- **Mức độ**: Trung bình.
- **Cách sửa**:
  - Dọn dẹp Command Palette: chuẩn hóa vị trí icon (fallback icon mặc định hoặc khoảng trống cố định `w-4`), viền input focus-visible tinh gọn.
  - Chuyển `ErrorToast` xuống góc dưới bên phải màn hình, thiết kế dạng VS Code toast notification.
  - Tinh chỉnh `WelcomeView` và `SettingsView` với card bo nhẹ, độ tương phản chuẩn mực, hover state nhẹ nhàng.

### Nhóm F: M3 Views (Merge Editor, Blame, File History, Interactive Rebase)
- **Vấn đề**:
  1. **Merge Editor**:
     - 3 khung (Theirs / Ours / Result) cần nhãn phân biệt rõ nét, viền ngăn cách sắc nét, nút "Mark as Resolved" nổi bật.
     - Thanh đếm số lượng xung đột ("N conflicts remaining") cần badge màu warning/error dễ nhận biết.
  2. **Blame View**:
     - Cột lề blame bên trái hiển thị tuổi commit và tác giả cần font monospace nhỏ gọn, không gây rối mắt khi đọc code.
  3. **File History View**:
     - Mini graph và danh sách log cần thanh cuộn gọn gàng, diff file view hiển thị tương tự editor.
  4. **Interactive Rebase View**:
     - Danh sách commit rebase cần kéo thả trực quan, các dropdown action (pick, squash, reword, drop...) có màu badge phân biệt.
- **Mức độ**: Trung bình.
- **Cách sửa**:
  - Đồng bộ bảng màu và typography của 4 view này với hệ thống design token mới.
  - Đảm bảo các nút hành động (Accept Current, Accept Incoming, Accept Both) có màu sắc ngữ nghĩa chuẩn (xanh dương / xanh lá / tím).

### Nhóm G: Accessibility & WCAG AA Polish
- **Vấn đề**:
  1. Thiếu `aria-label` trên hàng loạt nút icon-only (split button chevron, close tab, refresh, collapse/expand chevron, theme toggle).
  2. Thiếu cấu trúc ARIA phân cấp (`role="tree"`, `role="tablist"`).
  3. Thiếu focus-visible indicator khi điều hướng bằng phím Tab.
  4. Một số văn bản chữ nhỏ dưới 12px có độ tương phản dưới 4.5:1.
- **Mức độ**: Cao (Tiêu chí chất lượng cốt lõi).
- **Cách sửa**:
  - Rà soát toàn bộ component có nút icon để gắn `aria-label`.
  - Bổ sung `role="tablist"` vào thanh tab, `role="tree"` vào danh sách file Source Control.
  - Thêm quy tắc CSS `:focus-visible` với ring 1.5px màu `--vscode-accent` hoặc `--vscode-focus-border`.
  - Kiểm tra lại độ tương phản màu với Lighthouse và devtools a11y tree.

---

## 4. Kế hoạch thực hiện theo thứ tự cam kết (Commit plan)

1. **Commit 1**: `docs(ui): add comprehensive UI/UX and a11y audit report`
2. **Commit 2**: `feat(ui): design tokens, utility classes and light/dark theme system`
3. **Commit 3**: `feat(ui): polish shell layout (titlebar, activity bar, sidebar, tabs, status bar)`
4. **Commit 4**: `feat(ui): polish source control view, commit box and diff viewer`
5. **Commit 5**: `feat(ui): polish git graph lanes, commit rows and canvas rendering`
6. **Commit 6**: `feat(ui): polish dialogs, command palette, toast notifications, welcome and settings`
7. **Commit 7**: `feat(ui): polish m3 views (merge editor, blame, file history, interactive rebase)`
8. **Commit 8**: `feat(ui): complete a11y pass with focus-visible, aria-labels and contrast AA`
