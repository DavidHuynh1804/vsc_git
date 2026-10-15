pub mod color;
pub mod lanes;
pub mod model;

pub use color::{branch_color_index, find_primary_ref, PALETTE_HEX, PALETTE_SIZE};
pub use lanes::{layout, Lane, LaneState};
pub use model::{CommitNode, Edge, EdgeKind, GraphRow, RefKind, RefLabel};
