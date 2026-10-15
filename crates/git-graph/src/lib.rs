pub mod ascii;
pub mod color;
pub mod lanes;
pub mod model;

pub use ascii::render_ascii;
pub use color::{branch_color_index, find_primary_ref, PALETTE_HEX, PALETTE_SIZE};
pub use lanes::{layout, Lane, LaneState};
pub use model::{CommitNode, Edge, EdgeKind, GraphRow, RefKind, RefLabel};
