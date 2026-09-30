# Security

Phyra is pre-release software. Security fixes currently target the latest `main` revision; no older release branch has a security-support commitment.

## Reporting a vulnerability

Do not publish credentials, private projects, exploit payloads or sensitive diagnostic files in issues or pull requests.

Use GitHub's [private vulnerability reporting form](https://github.com/oguzhankir/phyra/security/advisories/new) to send a confidential report to the maintainers. Do not include vulnerability details in public issues or pull requests. If the form is temporarily unavailable, request a private contact through a repository issue without including vulnerability details; no public security email is configured.

Include the affected commit or package version, operating system, minimal reproduction, expected impact and redacted logs. Share only the data needed to reproduce the issue. No response-time or bounty commitment is offered.

## Scope and known limits

Relevant boundaries include untrusted `.phyra` archives and typed buffers, geometry and resource validation, worker execution and cleanup, project recovery, native file access and packaged dependencies. Numerical inaccuracies also deserve a reproducible report, but do not establish a security vulnerability by themselves.

The resolved Linux GTK stack includes the open [GLib iterator safety advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). GLib is absent from the macOS and Windows Rust build graphs. Linux remains unsupported; retain the alert until an upstream-compatible fix is available. Development packaging and hosted workflow tests do not establish production signing, consumer installation or complete redistribution readiness.
