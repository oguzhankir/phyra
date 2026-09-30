use std::{path::PathBuf, sync::Mutex};
#[derive(Default)]
pub(crate) struct ProjectState {
    pub(crate) current_path: Mutex<Option<(String, PathBuf)>>,
}
