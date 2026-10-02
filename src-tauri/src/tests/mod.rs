use crate::{
    execution::{
        events::RunRequestId,
        state::{cancel_child, owned_directory, retain_job, EngineState},
        validation::{validate_devices, validate_metrics},
    },
    platform::files::{read_bounded, MAX_JSON},
    project::{
        archive::{read_archive, read_archive_details, write_archive},
        validation::{migrate_project, validate_project},
    },
    results::fields::array_values,
    verification::{bounded_trace, verification_bytes},
};
use serde_json::{json, Value};
use std::fs::File;
use std::io::Write;
use std::{
    fs,
    process::{Command, Stdio},
    sync::atomic::Ordering,
};
use zip::{write::SimpleFileOptions, ZipWriter};

mod archive;
mod lifecycle;
mod protocol;
mod verification;
