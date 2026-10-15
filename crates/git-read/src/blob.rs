use std::path::Path;

use crate::error::ReadError;
use crate::repo::ReadRepo;

impl ReadRepo {
    /// Read blob content at a specific revision (HEAD, branch, commit SHA) and path.
    pub fn blob_at(
        &self,
        rev_spec: &str,
        path: impl AsRef<Path>,
    ) -> Result<Option<Vec<u8>>, ReadError> {
        let tree = match self.resolve_tree(rev_spec) {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };

        let entry = match tree.lookup_entry_by_path(path.as_ref()) {
            Ok(Some(entry)) => entry,
            _ => return Ok(None),
        };

        let obj = match entry.object() {
            Ok(obj) => obj,
            Err(_) => return Ok(None),
        };

        if let Ok(blob) = obj.try_into_blob() {
            Ok(Some(blob.data.to_vec()))
        } else {
            Ok(None)
        }
    }

    /// Read blob content from the git index at a specific path and stage (0 = unconflicted, 1 = base, 2 = ours, 3 = theirs).
    pub fn index_blob(
        &self,
        path: impl AsRef<Path>,
        stage: u8,
    ) -> Result<Option<Vec<u8>>, ReadError> {
        let stage_enum = match stage {
            0 => gix::index::entry::Stage::Unconflicted,
            1 => gix::index::entry::Stage::Base,
            2 => gix::index::entry::Stage::Ours,
            3 => gix::index::entry::Stage::Theirs,
            _ => {
                return Err(ReadError::NotFound(format!(
                    "Invalid index stage {stage}, must be 0..=3"
                )))
            }
        };

        let index = match self.gix_repo().open_index() {
            Ok(idx) => idx,
            Err(e) => return Err(ReadError::Gix(format!("Failed to open index: {e}"))),
        };

        let path_ref = path.as_ref();
        let path_str = path_ref.to_string_lossy();
        let normalized_path = path_str.replace('\\', "/");
        let bstr_path = gix::bstr::BStr::new(normalized_path.as_bytes());

        let entry = match index.entry_by_path_and_stage(bstr_path, stage_enum) {
            Some(entry) => entry,
            None => return Ok(None),
        };

        let obj = self
            .gix_repo()
            .find_object(entry.id)
            .map_err(|e| ReadError::Gix(e.to_string()))?;
        if obj.kind == gix::object::Kind::Blob {
            Ok(Some(obj.data.to_vec()))
        } else {
            Ok(None)
        }
    }
}
