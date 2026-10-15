use crate::model::{EdgeKind, GraphRow};

/// Render a list of GraphRows to clean, human-readable ASCII art using `*`, `|`, `/`, `\`.
pub fn render_ascii(rows: &[GraphRow]) -> String {
    let mut out = String::new();

    for (i, row) in rows.iter().enumerate() {
        // Determine column bounds
        let mut max_col = row.col;
        for e in &row.edges {
            max_col = max_col.max(e.from_col).max(e.to_col);
        }
        if i + 1 < rows.len() {
            max_col = max_col.max(rows[i + 1].col);
            for e in &rows[i + 1].edges {
                max_col = max_col.max(e.from_col).max(e.to_col);
            }
        }

        let width = (max_col as usize + 1) * 2;

        // 1. Commit node line
        let mut node_line = vec![' '; width];

        // Draw passing vertical lanes
        for e in &row.edges {
            if e.kind == EdgeKind::Straight && e.from_col != row.col {
                node_line[e.from_col as usize * 2] = '|';
            }
        }

        // Draw commit node
        node_line[row.col as usize * 2] = '*';

        let node_str: String = node_line.into_iter().collect();
        let trimmed_node = node_str.trim_end();
        if !row.sha.is_empty() {
            out.push_str(trimmed_node);
            out.push_str("   ");
            out.push_str(&row.sha);
        } else {
            out.push_str(trimmed_node);
        }
        out.push('\n');

        // 2. Connector line between row i and row i+1
        if i + 1 < rows.len() {
            let next_row = &rows[i + 1];
            let mut conn_line = vec![' '; width];

            // Collect incoming MergeIn edges for next_row
            let incoming_merges: Vec<_> = next_row
                .edges
                .iter()
                .filter(|e| e.kind == EdgeKind::MergeIn)
                .collect();

            // Handle outgoing straight edges from row
            for e in &row.edges {
                if e.kind == EdgeKind::Straight {
                    // Check if this column merges into next_row.col
                    if let Some(merge) = incoming_merges.iter().find(|m| m.from_col == e.from_col) {
                        draw_diagonal(&mut conn_line, merge.from_col, merge.to_col);
                    } else {
                        conn_line[e.from_col as usize * 2] = '|';
                    }
                }
            }

            // Handle BranchOut edges from row
            for e in &row.edges {
                if e.kind == EdgeKind::BranchOut {
                    draw_diagonal(&mut conn_line, e.from_col, e.to_col);
                }
            }

            // Any remaining incoming merges not yet drawn
            for merge in incoming_merges {
                let pos = merge.from_col as usize * 2;
                if pos < conn_line.len() && conn_line[pos] == ' ' {
                    draw_diagonal(&mut conn_line, merge.from_col, merge.to_col);
                }
            }

            let conn_str: String = conn_line.into_iter().collect();
            let trimmed_conn = conn_str.trim_end();
            if !trimmed_conn.is_empty() {
                out.push_str(trimmed_conn);
                out.push('\n');
            }
        } else {
            // Very last row: if it has outgoing edges (e.g. shallow parent), draw them
            let has_outgoing = row.edges.iter().any(|e| e.kind != EdgeKind::MergeIn);
            if has_outgoing {
                let mut conn_line = vec![' '; width];
                for e in &row.edges {
                    if e.kind == EdgeKind::Straight {
                        conn_line[e.from_col as usize * 2] = '|';
                    } else if e.kind == EdgeKind::BranchOut {
                        draw_diagonal(&mut conn_line, e.from_col, e.to_col);
                    }
                }
                let conn_str: String = conn_line.into_iter().collect();
                let trimmed_conn = conn_str.trim_end();
                if !trimmed_conn.is_empty() {
                    out.push_str(trimmed_conn);
                    out.push('\n');
                }
            }
        }
    }

    out
}

fn draw_diagonal(conn_line: &mut [char], from_col: u16, to_col: u16) {
    if to_col > from_col {
        // Sloping right: \
        let start = from_col as usize * 2 + 1;
        let end = to_col as usize * 2;
        for pos in start..end {
            if pos < conn_line.len() && conn_line[pos] == ' ' {
                conn_line[pos] = '\\';
            }
        }
    } else if from_col > to_col {
        // Sloping left: /
        let start = to_col as usize * 2 + 1;
        let end = from_col as usize * 2;
        for pos in start..end {
            if pos < conn_line.len() && conn_line[pos] == ' ' {
                conn_line[pos] = '/';
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lanes::layout;
    use crate::model::CommitNode;

    #[test]
    fn test_render_ascii_linear() {
        let commits = vec![
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec!["c0".into()], vec![]),
            CommitNode::new("c0", vec![], vec![]),
        ];

        let rows = layout(&commits);
        let ascii = render_ascii(&rows);
        assert_eq!(ascii, "*   c2\n|\n*   c1\n|\n*   c0\n");
    }

    #[test]
    fn test_render_ascii_branch_and_merge() {
        let commits = vec![
            CommitNode::new("m", vec!["c1".into(), "c2".into()], vec![]),
            CommitNode::new("c2", vec!["c1".into()], vec![]),
            CommitNode::new("c1", vec!["c0".into()], vec![]),
            CommitNode::new("c0", vec![], vec![]),
        ];

        let rows = layout(&commits);
        let ascii = render_ascii(&rows);
        assert_eq!(ascii, "*   m\n|\\\n| *   c2\n|/\n*   c1\n|\n*   c0\n");
    }
}
