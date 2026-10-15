use git_graph::{layout, render_ascii, CommitNode, LaneState};

#[test]
fn test_snapshot_linear() {
    let commits = vec![
        CommitNode::new("c2", vec!["c1".into()], vec![]),
        CommitNode::new("c1", vec!["c0".into()], vec![]),
        CommitNode::new("c0", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("linear_history", ascii);
}

#[test]
fn test_snapshot_branch_and_merge() {
    let commits = vec![
        CommitNode::new("m", vec!["c1".into(), "c2".into()], vec![]),
        CommitNode::new("c2", vec!["c1".into()], vec![]),
        CommitNode::new("c1", vec!["c0".into()], vec![]),
        CommitNode::new("c0", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("branch_and_merge", ascii);
}

#[test]
fn test_snapshot_two_long_parallel_branches() {
    // Two branches parallel for several commits before converging
    // main: c0 -> c1 -> c2 -> c3 -> m
    // feat: c0 -> f1 -> f2 -> f3 -> m
    let commits = vec![
        CommitNode::new("m", vec!["c3".into(), "f3".into()], vec![]),
        CommitNode::new("f3", vec!["f2".into()], vec![]),
        CommitNode::new("c3", vec!["c2".into()], vec![]),
        CommitNode::new("f2", vec!["f1".into()], vec![]),
        CommitNode::new("c2", vec!["c1".into()], vec![]),
        CommitNode::new("f1", vec!["c0".into()], vec![]),
        CommitNode::new("c1", vec!["c0".into()], vec![]),
        CommitNode::new("c0", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("two_long_parallel_branches", ascii);
}

#[test]
fn test_snapshot_octopus_merge() {
    // 3 parents: c1, c2, c3
    let commits = vec![
        CommitNode::new("m", vec!["c1".into(), "c2".into(), "c3".into()], vec![]),
        CommitNode::new("c3", vec!["c0".into()], vec![]),
        CommitNode::new("c2", vec!["c0".into()], vec![]),
        CommitNode::new("c1", vec!["c0".into()], vec![]),
        CommitNode::new("c0", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("octopus_merge", ascii);
}

#[test]
fn test_snapshot_multiple_roots() {
    // 2 completely independent root commits / disconnected trees
    let commits = vec![
        CommitNode::new("r1_head", vec!["r1_root".into()], vec![]),
        CommitNode::new("r2_head", vec!["r2_root".into()], vec![]),
        CommitNode::new("r1_root", vec![], vec![]),
        CommitNode::new("r2_root", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("multiple_roots", ascii);
}

#[test]
fn test_snapshot_criss_cross_merge() {
    // Criss-cross merge:
    // A and B both merged into m1 and m2
    // m1 = parents(a2, b2)
    // m2 = parents(b2, a2)
    let commits = vec![
        CommitNode::new("m1", vec!["a2".into(), "b2".into()], vec![]),
        CommitNode::new("m2", vec!["b2".into(), "a2".into()], vec![]),
        CommitNode::new("b2", vec!["root".into()], vec![]),
        CommitNode::new("a2", vec!["root".into()], vec![]),
        CommitNode::new("root", vec![], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("criss_cross_merge", ascii);
}

#[test]
fn test_snapshot_paged_merge_first_page_parent_second_page() {
    let commits = [
        CommitNode::new("m", vec!["c1".into(), "c2".into()], vec![]),
        CommitNode::new("c2", vec!["c1".into()], vec![]),
        CommitNode::new("c1", vec!["c0".into()], vec![]),
        CommitNode::new("c0", vec![], vec![]),
    ];

    let mut state = LaneState::new();
    let mut rows = state.layout_page(&commits[..1]); // only merge commit
    rows.extend(state.layout_page(&commits[1..])); // parents on second page

    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("paged_merge_first_page_parent_second_page", ascii);
}

#[test]
fn test_snapshot_shallow_parent_no_panic() {
    let commits = vec![
        CommitNode::new("c2", vec!["c1".into()], vec![]),
        CommitNode::new("c1", vec!["missing_sha".into()], vec![]),
    ];
    let rows = layout(&commits);
    let ascii = render_ascii(&rows);
    insta::assert_snapshot!("shallow_parent_no_panic", ascii);
}
