use crate::color::{branch_color_index, find_primary_ref};
use crate::model::{CommitNode, Edge, EdgeKind, GraphRow};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lane {
    pub target: String,
    pub color: u8,
}

impl Lane {
    pub fn new(target: impl Into<String>, color: u8) -> Self {
        Self {
            target: target.into(),
            color,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaneState {
    pub active: Vec<Option<Lane>>,
}

impl LaneState {
    pub fn new() -> Self {
        Self { active: Vec::new() }
    }

    pub fn is_empty(&self) -> bool {
        self.active.is_empty()
    }

    pub fn reset(&mut self) {
        self.active.clear();
    }

    /// Layout a slice of commits into GraphRows according to spec 6.2.
    /// This method is stateful: calling it repeatedly on consecutive chunks
    /// yields the exact same output as calling it once on all commits combined.
    pub fn layout_page(&mut self, commits: &[CommitNode]) -> Vec<GraphRow> {
        let mut rows = Vec::with_capacity(commits.len());

        for commit in commits {
            // 1. Find all active lanes waiting for this commit.
            let waiting_lanes: Vec<usize> = self
                .active
                .iter()
                .enumerate()
                .filter_map(|(i, lane)| {
                    if lane.as_ref().is_some_and(|l| l.target == commit.sha) {
                        Some(i)
                    } else {
                        None
                    }
                })
                .collect();

            // 2. Determine column and color for this commit.
            let col = if !waiting_lanes.is_empty() {
                waiting_lanes[0]
            } else {
                // Branch head: find first empty lane or append new lane.
                self.active
                    .iter()
                    .position(|l| l.is_none())
                    .unwrap_or(self.active.len())
            };

            // Color priority: direct ref > inherited lane color > hash/col
            let color = if let Some(primary_ref) = find_primary_ref(&commit.refs) {
                branch_color_index(&primary_ref.name)
            } else if !waiting_lanes.is_empty() {
                self.active[col].as_ref().unwrap().color
            } else {
                (col % 12) as u8
            };

            if col >= self.active.len() {
                self.active.resize(col + 1, None);
            }

            let mut edges = Vec::new();

            // 1b. Other lanes waiting for the same commit converge into this commit and close.
            let closing_lanes = if waiting_lanes.len() > 1 {
                &waiting_lanes[1..]
            } else {
                &[]
            };
            for &other_col in closing_lanes {
                let other_color = self.active[other_col].as_ref().unwrap().color;
                edges.push(Edge::new(
                    other_col as u16,
                    col as u16,
                    EdgeKind::MergeIn,
                    other_color,
                ));
                self.active[other_col] = None;
            }

            // Passing lanes: active lanes that pass straight through this row.
            for (idx, lane_opt) in self.active.iter().enumerate() {
                if idx != col && !closing_lanes.contains(&idx) {
                    if let Some(lane) = lane_opt {
                        edges.push(Edge::new(
                            idx as u16,
                            idx as u16,
                            EdgeKind::Straight,
                            lane.color,
                        ));
                    }
                }
            }

            // 3. Parents:
            // - First parent continues on commit's lane.
            // - Secondary parents connect to existing waiting lane or open a new lane (BranchOut).
            if commit.parents.is_empty() {
                self.active[col] = None;
            } else {
                let p0 = &commit.parents[0];
                self.active[col] = Some(Lane::new(p0, color));
                edges.push(Edge::new(col as u16, col as u16, EdgeKind::Straight, color));

                // Deduplicate secondary parents to avoid duplicate branch edges
                let mut seen_secondary = std::collections::HashSet::new();
                for p_sub in &commit.parents[1..] {
                    if p_sub == p0 || !seen_secondary.insert(p_sub) {
                        continue;
                    }

                    // Check if an active lane is already waiting for p_sub
                    let existing = self.active.iter().enumerate().position(|(idx, l)| {
                        idx != col && l.as_ref().is_some_and(|lane| lane.target == *p_sub)
                    });

                    if let Some(target_col) = existing {
                        let branch_color = self.active[target_col].as_ref().unwrap().color;
                        edges.push(Edge::new(
                            col as u16,
                            target_col as u16,
                            EdgeKind::BranchOut,
                            branch_color,
                        ));
                    } else {
                        // Open new lane
                        let new_col = self
                            .active
                            .iter()
                            .position(|l| l.is_none())
                            .unwrap_or(self.active.len());
                        let new_color = ((color as usize + 1 + (new_col % 11)) % 12) as u8;

                        if new_col >= self.active.len() {
                            self.active.resize(new_col + 1, None);
                        }
                        self.active[new_col] = Some(Lane::new(p_sub, new_color));
                        edges.push(Edge::new(
                            col as u16,
                            new_col as u16,
                            EdgeKind::BranchOut,
                            new_color,
                        ));
                    }
                }
            }

            // 4. Trim trailing empty lanes
            while self.active.last().is_some_and(|l| l.is_none()) {
                self.active.pop();
            }

            // Deterministic sort of edges
            edges.sort_by_key(|e| (e.from_col, e.to_col, e.kind as u8));
            edges.dedup();

            rows.push(GraphRow::new(commit.sha.clone(), col as u16, color, edges));
        }

        rows
    }
}

pub fn layout(commits: &[CommitNode]) -> Vec<GraphRow> {
    LaneState::new().layout_page(commits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_history() {
        let commits = vec![
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec!["c0".into()], vec![]),
            CommitNode::new("c0", vec![], vec![]),
        ];

        let rows = layout(&commits);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].col, 0);
        assert_eq!(rows[1].col, 0);
        assert_eq!(rows[2].col, 0);

        assert_eq!(rows[0].edges.len(), 1);
        assert_eq!(rows[0].edges[0].kind, EdgeKind::Straight);
        assert_eq!(rows[0].edges[0].from_col, 0);
        assert_eq!(rows[0].edges[0].to_col, 0);

        assert_eq!(rows[1].edges.len(), 1);
        assert_eq!(rows[1].edges[0].kind, EdgeKind::Straight);

        assert_eq!(rows[2].edges.len(), 0);
    }

    #[test]
    fn test_branch_and_merge() {
        let commits = vec![
            CommitNode::new("m", vec!["c1".into(), "c2".into()], vec![]),
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec![], vec![]),
        ];

        let rows = layout(&commits);
        assert_eq!(rows.len(), 3);
        // m is on col 0
        assert_eq!(rows[0].col, 0);
        // m branches to c2 on col 1
        assert!(rows[0]
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::Straight && e.from_col == 0 && e.to_col == 0));
        assert!(rows[0]
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::BranchOut && e.from_col == 0 && e.to_col == 1));

        // c2 is on col 1
        assert_eq!(rows[1].col, 1);
        // lane 0 passes through
        assert!(rows[1]
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::Straight && e.from_col == 0 && e.to_col == 0));

        // c1 is on col 0
        assert_eq!(rows[2].col, 0);
        // lane 1 merged into c1
        assert!(rows[2]
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::MergeIn && e.from_col == 1 && e.to_col == 0));
    }

    #[test]
    fn test_merge_first_page_parent_second_page() {
        let commits = vec![
            CommitNode::new("m", vec!["c1".into(), "c2".into()], vec![]),
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec![], vec![]),
        ];

        let baseline = layout(&commits);

        let mut state = LaneState::new();
        let mut paged = state.layout_page(&commits[..1]);
        paged.extend(state.layout_page(&commits[1..]));

        assert_eq!(paged, baseline);
    }

    #[test]
    fn test_shallow_parent_no_panic() {
        let commits = vec![
            CommitNode::new("c1", vec!["shallow_parent_sha".into()], vec![]),
            CommitNode::new("c0", vec![], vec![]),
        ];

        let mut state = LaneState::new();
        let rows = state.layout_page(&commits);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].sha, "c1");
        assert_eq!(rows[1].sha, "c0");
        // c1's lane is still waiting for shallow_parent_sha, so it stays active
        assert!(!state.is_empty());
    }

    #[test]
    fn test_pagination_property_at_every_cut_position() {
        // Construct a non-trivial DAG
        let commits = vec![
            CommitNode::new("c12", vec!["c10".into(), "c11".into()], vec![]),
            CommitNode::new("c11", vec!["c8".into(), "c9".into()], vec![]),
            CommitNode::new("c10", vec!["c7".into()], vec![]),
            CommitNode::new("c9", vec!["c6".into()], vec![]),
            CommitNode::new("c8", vec!["c5".into(), "c6".into()], vec![]),
            CommitNode::new("c7", vec!["c4".into()], vec![]),
            CommitNode::new("c6", vec!["c3".into()], vec![]),
            CommitNode::new("c5", vec!["c3".into()], vec![]),
            CommitNode::new("c4", vec!["c2".into()], vec![]),
            CommitNode::new("c3", vec!["c1".into()], vec![]),
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec!["c0".into()], vec![]),
            CommitNode::new("c0", vec![], vec![]),
        ];

        let baseline = layout(&commits);

        // Test every 2-page cut
        for cut in 0..=commits.len() {
            let mut state = LaneState::new();
            let mut result = state.layout_page(&commits[..cut]);
            result.extend(state.layout_page(&commits[cut..]));
            assert_eq!(
                result, baseline,
                "Failed 2-page split at cut position {}",
                cut
            );
        }

        // Test variable chunk sizes (multi-page streaming)
        for chunk_size in 1..=commits.len() {
            let mut state = LaneState::new();
            let mut result = Vec::new();
            for chunk in commits.chunks(chunk_size) {
                result.extend(state.layout_page(chunk));
            }
            assert_eq!(
                result, baseline,
                "Failed multi-page split with chunk_size {}",
                chunk_size
            );
        }
    }
}
