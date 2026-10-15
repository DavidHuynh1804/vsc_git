use ai::postprocess_commit_message;

#[test]
fn test_postprocess_valid_conventional_commit() {
    let raw = "feat(ai): add postprocess logic\n\nExplain why this change is necessary.\n- Bullet point 1\n- Bullet point 2";
    let res = postprocess_commit_message(raw, Some(72), None);

    assert_eq!(
        res.message,
        "feat(ai): add postprocess logic\n\nExplain why this change is necessary.\n- Bullet point 1\n- Bullet point 2"
    );
    assert!(!res.has_warning);
    assert!(res.warning.is_none());
}

#[test]
fn test_postprocess_invalid_format_adds_chore() {
    let raw = "add new feature to graph";
    let res = postprocess_commit_message(raw, Some(72), None);

    assert_eq!(res.message, "chore: add new feature to graph");
    assert!(res.has_warning);
    assert!(res.warning.is_some());
}

#[test]
fn test_postprocess_strips_trailing_period_from_subject() {
    let raw = "fix(core): resolve null pointer crash.";
    let res = postprocess_commit_message(raw, Some(72), None);

    assert_eq!(res.message, "fix(core): resolve null pointer crash");
    assert!(!res.has_warning);
}

#[test]
fn test_postprocess_cuts_subject_exceeding_max_length() {
    let raw =
        "feat(ai): this is a very long commit subject line that exceeds fifty characters by a lot";
    let res = postprocess_commit_message(raw, Some(50), None);

    assert_eq!(res.message.chars().count(), 50);
    assert_eq!(
        res.message,
        "feat(ai): this is a very long commit subject line "
    );
    assert!(!res.has_warning);
}

#[test]
fn test_postprocess_strips_markdown_fences() {
    let raw = "```commit\nfeat(ui): update sidebar\n\nSidebar has new icons.\n```";
    let res = postprocess_commit_message(raw, Some(72), None);

    assert_eq!(
        res.message,
        "feat(ui): update sidebar\n\nSidebar has new icons."
    );
    assert!(!res.has_warning);
}

#[test]
fn test_postprocess_allowed_types_filtering() {
    let allowed = vec!["feat".to_string(), "fix".to_string()];
    // "docs" is not in allowed list
    let raw = "docs: update documentation";
    let res = postprocess_commit_message(raw, Some(72), Some(&allowed));

    assert_eq!(res.message, "chore: docs: update documentation");
    assert!(res.has_warning);
}
