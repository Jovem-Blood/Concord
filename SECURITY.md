# Security Policy

## Supported versions

Security fixes target the latest release and the current `main` branch. Older builds may not receive patches.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/Jovem-Blood/Concord/security/advisories/new).

Do not open a public issue for vulnerabilities and do not include live credentials, room tokens, captured media, personal data, or a publicly exploitable proof of concept. A useful report includes:

- the affected version or commit;
- the affected platform and deployment shape;
- reproduction steps with secrets removed;
- the expected and observed security impact; and
- any mitigation you have already tested.

The maintainers will acknowledge the report when possible, investigate it, and coordinate disclosure after a fix or mitigation is available. Please allow a reasonable remediation window before publishing details.

## Deployment responsibility

Self-hosters are responsible for protecting Cloudflare credentials, restricting `ALLOWED_ORIGINS`, using HTTPS, keeping Concord and its dependencies updated, and monitoring the public API. Never expose `CLOUDFLARE_SFU_APP_SECRET` in `VITE_` variables or client bundles.
