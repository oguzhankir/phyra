//! Open only the product and primary references linked by in-product help.
use reqwest::Url;
fn reference(value: &str) -> Result<Url, String> {
    if value.len() > 2048 {
        return Err("Reference URL is too long".into());
    }
    let url = Url::parse(value).map_err(|_| "Invalid reference URL")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
    {
        return Err("References must use HTTPS without URL credentials".into());
    }
    let allowed = match url.host_str().unwrap_or_default() {
        "github.com" => {
            url.path() == "/oguzhankir/phyra"
                || url.path().starts_with("/oguzhankir/phyra/")
                || url.path() == "/ThangLe-duc/nEPINN"
                || url.path().starts_with("/ThangLe-duc/nEPINN/")
        }
        "ai.google.dev"
        | "developers.openai.com"
        | "platform.claude.com"
        | "modelcontextprotocol.io"
        | "doi.org"
        | "arxiv.org"
        | "www.pnas.org"
        | "jschoeberl.github.io"
        | "fenicsproject.org"
        | "dealii.org"
        | "scikit-fem.readthedocs.io"
        | "docs.pytorch.org"
        | "docs.nvidia.com" => true,
        _ => false,
    };
    if !allowed {
        return Err("This reference is not in Phyra's primary-source allowlist; copy its URL to open it manually".into());
    }
    Ok(url)
}
#[tauri::command]
pub fn assistant_open_reference(url: String) -> Result<(), String> {
    let url = reference(&url)?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|_| "The OS browser opener is unavailable")?;
        if !status.success() {
            return Err("The OS browser could not open this reference".into());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let operation: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let target: Vec<u16> = std::ffi::OsStr::new(url.as_str())
            .encode_wide()
            .chain(Some(0))
            .collect();
        // ShellExecute opens a validated HTTPS URI through the OS browser
        // association. The URI cannot supply a shell command or executable.
        let outcome = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if outcome as isize <= 32 {
            return Err("The OS browser could not open this reference".into());
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = url;
        Err("Copy this reference URL to open it in your browser".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn references_never_form_general_uri_or_shell_bridge() {
        assert!(reference("https://doi.org/10.1000/example").is_ok());
        assert!(reference("https://github.com/oguzhankir/phyra/issues").is_ok());
        for input in [
            "file:///etc/passwd",
            "https://user:password@doi.org/reference",
            "https://evil.example/reference",
            "https://github.com/another/repository",
            "https://doi.org.evil.example/reference",
        ] {
            assert!(reference(input).is_err());
        }
    }
}
