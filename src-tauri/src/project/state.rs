use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(crate) const LEGACY_DOCUMENT_ID: &str = "00000000-0000-4000-8000-000000000000";
const MAX_DOCUMENTS: usize = 64;
const MAX_CLOSED_DOCUMENTS: usize = 256;

pub(crate) fn document_identity(id: Option<&str>) -> Result<&str, String> {
    let id = id.unwrap_or(LEGACY_DOCUMENT_ID);
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid project document identity")?;
    if parsed.to_string() != id {
        return Err("Invalid project document identity".into());
    }
    Ok(id)
}

#[derive(Default)]
pub(crate) struct ProjectState {
    pub(crate) documents: Mutex<DocumentArchives>,
}

#[derive(Default)]
pub(crate) struct DocumentArchives {
    owner: Option<String>,
    retired_owners: HashSet<String>,
    paths: HashMap<String, (String, PathBuf, PathBuf)>,
    generations: HashMap<String, uuid::Uuid>,
    closed: HashSet<String>,
}

impl DocumentArchives {
    pub(crate) fn activate_owner(&mut self, owner: Option<&str>) -> Result<(), String> {
        let Some(owner) = owner else {
            return Ok(());
        };
        document_identity(Some(owner))?;
        if self.retired_owners.contains(owner) {
            return Err("Project request belongs to a superseded workbench session".into());
        }
        if self.owner.as_deref() != Some(owner) {
            if self.retired_owners.len() >= MAX_CLOSED_DOCUMENTS {
                return Err(
                    "Document session limit reached. Save projects and restart Phyra.".into(),
                );
            }
            if let Some(previous) = self.owner.replace(owner.into()) {
                self.retired_owners.insert(previous);
            }
            self.paths.clear();
            self.generations.clear();
            self.closed.clear();
        }
        Ok(())
    }

    pub(crate) fn require_owner(&self, owner: Option<&str>) -> Result<(), String> {
        if owner.is_some() && self.owner.as_deref() != owner {
            return Err("Project request belongs to a superseded workbench session".into());
        }
        Ok(())
    }
    pub(crate) fn require_open(&self, document: &str) -> Result<(), String> {
        document_identity(Some(document))?;
        if self.closed.contains(document) {
            return Err("This project document has closed".into());
        }
        if !self.generations.contains_key(document) && self.generations.len() >= MAX_DOCUMENTS {
            return Err("Too many open project documents".into());
        }
        Ok(())
    }

    pub(crate) fn path(&self, document: &str, project: &str) -> Option<PathBuf> {
        self.paths
            .get(document)
            .and_then(|(id, path, _)| (id == project).then(|| path.clone()))
    }

    pub(crate) fn generation(&self, document: &str) -> Option<uuid::Uuid> {
        self.generations.get(document).copied()
    }

    pub(crate) fn owner(&self, path: &Path) -> Result<Option<&str>, String> {
        let identity = archive_identity(path)?;
        Ok(self.paths.iter().find_map(|(document, (_, _, owned))| {
            (*owned == identity).then_some(document.as_str())
        }))
    }

    pub(crate) fn associate(
        &mut self,
        document: &str,
        project: &str,
        path: PathBuf,
    ) -> Result<(), String> {
        self.require_open(document)?;
        if self.owner(&path)?.is_some_and(|owner| owner != document) {
            return Err("This project file is already open in another tab".into());
        }
        let identity = archive_identity(&path)?;
        self.paths
            .insert(document.into(), (project.into(), path, identity));
        self.generations
            .insert(document.into(), uuid::Uuid::new_v4());
        Ok(())
    }

    pub(crate) fn forget(&mut self, document: &str) -> Result<(), String> {
        self.require_open(document)?;
        self.paths.remove(document);
        self.generations
            .insert(document.into(), uuid::Uuid::new_v4());
        Ok(())
    }

    pub(crate) fn close(&mut self, document: &str) -> Result<(), String> {
        self.require_close(document)?;
        self.paths.remove(document);
        self.generations.remove(document);
        self.closed.insert(document.into());
        Ok(())
    }

    pub(crate) fn require_close(&self, document: &str) -> Result<(), String> {
        document_identity(Some(document))?;
        if !self.closed.contains(document) && self.closed.len() >= MAX_CLOSED_DOCUMENTS {
            return Err("Document session limit reached. Save projects and restart Phyra.".into());
        }
        Ok(())
    }
}

fn archive_identity(path: &Path) -> Result<PathBuf, String> {
    let identity = if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        parent
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(path.file_name().ok_or("Invalid project archive name")?)
    };
    #[cfg(windows)]
    let identity = PathBuf::from(identity.to_string_lossy().to_lowercase());
    Ok(identity)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_project_ids_keep_separate_document_destinations() {
        let temporary = tempfile::tempdir().unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let mut state = DocumentArchives::default();
        state
            .associate(&a, "same-project", temporary.path().join("a.phyra"))
            .unwrap();
        state
            .associate(&b, "same-project", temporary.path().join("b.phyra"))
            .unwrap();
        assert_eq!(
            state.path(&a, "same-project"),
            Some(temporary.path().join("a.phyra"))
        );
        assert_eq!(
            state.path(&b, "same-project"),
            Some(temporary.path().join("b.phyra"))
        );
        assert!(state.path(&a, "different-project").is_none());
        state.forget(&a).unwrap();
        assert!(state.path(&a, "same-project").is_none());
        assert!(state.path(&b, "same-project").is_some());
    }

    #[test]
    fn archive_path_has_one_document_owner_and_closed_documents_cannot_reassociate() {
        let temporary = tempfile::tempdir().unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let path = temporary.path().join("project.phyra");
        let mut state = DocumentArchives::default();
        state.associate(&a, "project", path.clone()).unwrap();
        assert_eq!(state.owner(&path).unwrap(), Some(a.as_str()));
        assert!(state.associate(&b, "project", path.clone()).is_err());
        state.close(&a).unwrap();
        assert!(state.associate(&a, "project", path.clone()).is_err());
        state.associate(&b, "project", path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn aliases_to_an_existing_archive_cannot_acquire_another_owner() {
        let temporary = tempfile::tempdir().unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let path = temporary.path().join("project.phyra");
        std::fs::write(&path, b"archive").unwrap();
        let alias = temporary.path().join("alias.phyra");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        let mut state = DocumentArchives::default();
        state.associate(&a, "project", path).unwrap();
        assert_eq!(state.owner(&alias).unwrap(), Some(a.as_str()));
        assert!(state.associate(&b, "project", alias).is_err());
    }

    #[test]
    fn page_reload_releases_archive_destinations_and_rejects_old_owner_publication() {
        let temporary = tempfile::tempdir().unwrap();
        let before = uuid::Uuid::new_v4().to_string();
        let after = uuid::Uuid::new_v4().to_string();
        let doc = uuid::Uuid::new_v4().to_string();
        let path = temporary.path().join("project.phyra");
        let mut state = DocumentArchives::default();
        state.activate_owner(Some(&before)).unwrap();
        state.associate(&doc, "project", path.clone()).unwrap();
        state.activate_owner(Some(&after)).unwrap();
        assert!(state.owner(&path).unwrap().is_none());
        assert!(state.require_owner(Some(&before)).is_err());
        assert!(state.activate_owner(Some(&before)).is_err());
        state.require_owner(Some(&after)).unwrap();
    }

    #[test]
    fn recovery_association_removal_enforces_admission_and_closed_document_limits() {
        let mut state = DocumentArchives::default();
        let mut documents = Vec::new();
        for _ in 0..MAX_DOCUMENTS {
            let document = uuid::Uuid::new_v4().to_string();
            state.forget(&document).unwrap();
            documents.push(document);
        }
        let excess = uuid::Uuid::new_v4().to_string();
        assert!(state.forget(&excess).is_err());
        assert!(state.generation(&excess).is_none());
        assert_eq!(state.generations.len(), MAX_DOCUMENTS);
        state.close(&documents[0]).unwrap();
        assert!(state.forget(&documents[0]).is_err());
        assert!(state.generation(&documents[0]).is_none());
        state.forget(&excess).unwrap();
        assert_eq!(state.generations.len(), MAX_DOCUMENTS);
        assert!(state.forget("not-a-document-id").is_err());
    }
}
