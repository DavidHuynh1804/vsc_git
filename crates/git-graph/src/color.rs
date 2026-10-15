use crate::model::{RefKind, RefLabel};

pub const PALETTE_SIZE: usize = 12;

/// Standard 12-color palette hex codes (readable on dark and light themes).
pub const PALETTE_HEX: [&str; PALETTE_SIZE] = [
    "#3b82f6", // 0: Blue
    "#22c55e", // 1: Green
    "#eab308", // 2: Amber
    "#ef4444", // 3: Red
    "#a855f7", // 4: Purple
    "#06b6d4", // 5: Cyan
    "#f97316", // 6: Orange
    "#ec4899", // 7: Pink
    "#84cc16", // 8: Lime
    "#6366f1", // 9: Indigo
    "#14b8a6", // 10: Teal
    "#f43f5e", // 11: Rose
];

/// Stable hash of branch name to a color index in 0..11.
pub fn branch_color_index(name: &str) -> u8 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in name.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash % (PALETTE_SIZE as u64)) as u8
}

/// Find the best ref to color a commit/lane, prioritizing local branch,
/// then remote branch, then head, then tag, etc.
pub fn find_primary_ref(refs: &[RefLabel]) -> Option<&RefLabel> {
    refs.iter()
        .find(|r| matches!(r.kind, RefKind::LocalBranch))
        .or_else(|| {
            refs.iter()
                .find(|r| matches!(r.kind, RefKind::RemoteBranch))
        })
        .or_else(|| refs.iter().find(|r| matches!(r.kind, RefKind::Head)))
        .or_else(|| refs.iter().find(|r| matches!(r.kind, RefKind::Tag)))
        .or_else(|| refs.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_index_bounds_and_stability() {
        assert!(branch_color_index("main") < 12);
        assert_eq!(branch_color_index("main"), branch_color_index("main"));
        assert!(branch_color_index("feature/xyz") < 12);
    }
}
