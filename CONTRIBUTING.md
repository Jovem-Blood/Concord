# Contributing to Concord

Thanks for helping improve Concord. Small, focused changes are easier to review and safer for a real-time media application.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Open an issue before investing in a large feature or architecture change.
- Never include Cloudflare credentials, room tokens, captured media, or personal data in an issue, fixture, screenshot, or commit.
- Use Node.js 24 LTS and pnpm 10.15.0 for the closest match to CI and release builds.

## Local setup

1. Copy `.env.example` to `.env` without replacing an existing configuration.
2. Add your own Cloudflare Realtime Serverless SFU credentials.
3. Install dependencies with `pnpm install`.
4. Start the API with `pnpm dev:server`.
5. In another terminal, run `pnpm dev:web` or `pnpm dev:desktop`.

Unit tests use a mocked SFU and do not require credentials.

## Quality checks

Run these checks before submitting a pull request:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

For capture, WebRTC, audio, reconnect, or cross-platform changes, complete the relevant sections of [the manual test checklist](docs/manual-test-checklist.md). Release packaging uses `pnpm make` and must run on the target operating system with Node.js 22.12 through 24.x.

## Pull requests

- Explain the problem and the chosen solution.
- Keep unrelated formatting or refactors out of the same pull request.
- Add or update tests for behavior changes.
- Describe manual verification, especially for browser permissions, native capture, audio, and reconnection.
- Update both `README.md` and `README.pt-BR.md` when public behavior, setup, configuration, or limitations change.
- Include screenshots only when they help reviewers understand a visible UI change, and make sure they contain no private information.

## Commit guidance

Use clear, imperative commit messages such as `Add Linux release packaging` or `Fix room reconnect cleanup`. A pull request may contain multiple commits; maintainers can squash it when merging.

## Security reports

Do not disclose vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) instead.
