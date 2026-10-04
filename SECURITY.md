# Security

Phyra is pre-release software. Security fixes currently target the latest `main` revision; no older release branch has a security-support commitment.

## Reporting a vulnerability

Do not publish credentials, private projects, exploit payloads or sensitive diagnostic files in issues or pull requests.

Use GitHub's [private vulnerability reporting form](https://github.com/oguzhankir/phyra/security/advisories/new) to send a confidential report to the maintainers. Do not include vulnerability details in public issues or pull requests. If the form is temporarily unavailable, request a private contact through a repository issue without including vulnerability details; no public security email is configured.

Include the affected commit or package version, operating system, minimal reproduction, expected impact and redacted logs. Share only the data needed to reproduce the issue. No response-time or bounty commitment is offered.

## Scope and known limits

Relevant boundaries include untrusted `.phyra` archives and typed buffers, geometry and resource validation, worker execution and cleanup, isolated project documents, recovery, native file access, optional provider adapters, local assistant transcripts, scoped MCP access and packaged dependencies. Numerical inaccuracies also deserve a reproducible report, but do not establish a security vulnerability by themselves.

Numerical meshing, FEM and PINN execution remain local. Optional user-approved AI connections send the question, bounded completed conversation turns and relevant help/active-study snapshot to the selected connected endpoint when the user deliberately sends a message. Remote endpoints require HTTPS; local endpoints are restricted to loopback. Named providers use fixed official endpoints, redirects are blocked and native errors avoid credential-bearing response bodies. No local files or bulk field buffers are automatically attached. A provider or an external MCP client has its own data-retention policy; Phyra does not establish what those services retain.

Remote provider keys use native OS credential storage on macOS and Windows, namespaced by provider and endpoint origin; key values are never returned to the frontend. Independent provider connections use a validated version 2 settings registry with explicit version 1 migration. Version 1 assistant history remains in separate app-owned local files, with 2 MiB/160-message conversation limits and 100 conversations/32 MiB total history. Transcripts retain supplied study context and are not encrypted archives. Secrets must not enter prompts, transcripts, `.phyra` files or exports; native checks reject saved remote credentials in requests, local history and MCP snapshots.

Local MCP is off by default and uses stdio protocol 2025-11-25. Native tool allowlists authorize capability, help, project and run inspection, with a renewable 90-second session lease, revocation and an access audit. Changing enabled tools invalidates previous client configurations. No public listener, arbitrary file access, general shell, model mutations or numerical execution tools are exposed. Context, project metadata and assistant output are untrusted data; citations and instruction text do not guarantee correct model behavior or engineering safety.

The resolved Linux GTK stack includes the open [GLib iterator safety advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). GLib is absent from the macOS and Windows Rust build graphs. Linux remains unsupported; retain the alert until an upstream-compatible fix is available. Development packaging and hosted workflow tests do not establish production signing, consumer installation or complete redistribution readiness.
