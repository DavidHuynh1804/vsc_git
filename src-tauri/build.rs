fn main() {
    let mut attrs = tauri_build::Attributes::new();
    let has_manifest_in_flags = std::env::var("RUSTFLAGS")
        .map(|f| f.contains("MANIFESTINPUT"))
        .unwrap_or(false)
        || std::env::var("CARGO_ENCODED_RUSTFLAGS")
            .map(|f| f.contains("MANIFESTINPUT"))
            .unwrap_or(false);

    if has_manifest_in_flags {
        attrs =
            attrs.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }

    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
