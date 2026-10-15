use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Head,
    Stash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

impl RefLabel {
    pub fn new(name: impl Into<String>, kind: RefKind) -> Self {
        Self {
            name: name.into(),
            kind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitNode {
    pub sha: String,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
}

impl CommitNode {
    pub fn new(sha: impl Into<String>, parents: Vec<String>, refs: Vec<RefLabel>) -> Self {
        Self {
            sha: sha.into(),
            parents,
            refs,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeKind {
    Straight,
    MergeIn,
    BranchOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge {
    pub from_col: u16,
    pub to_col: u16,
    pub kind: EdgeKind,
    pub color: u8,
}

impl Edge {
    pub fn new(from_col: u16, to_col: u16, kind: EdgeKind, color: u8) -> Self {
        Self {
            from_col,
            to_col,
            kind,
            color,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphRow {
    pub sha: String,
    pub col: u16,
    pub color: u8,
    pub edges: Vec<Edge>,
}

impl GraphRow {
    pub fn new(sha: impl Into<String>, col: u16, color: u8, edges: Vec<Edge>) -> Self {
        Self {
            sha: sha.into(),
            col,
            color,
            edges,
        }
    }
}
