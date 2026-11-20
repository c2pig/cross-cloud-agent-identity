# Agent & Contributor Instructions (`cross-cloud-agent-identity`)

## Two-Way Architecture Diagram Sync

This repository powers **Lab 2 (`AI Agent ERP Overlay` — Step 1 Delegated Identity)** on [`0trust.dev`](https://github.com/c2pig/0trust.dev/blob/main/docs/ECOSYSTEM_MAP.md).

Whenever you modify code or infrastructure:
1. **Local Sync**: Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) in the same Pull Request (enforced by [`.github/workflows/diagram-check.yml`](.github/workflows/diagram-check.yml)).
2. **Global Sync**: If a cross-cloud OBO, Auth0 token-stripping, or Okta ID-JAG contract changes, also update `docs/diagrams/platform_capability_zoomin.svg` and `docs/labs/agentic-transaction.md` in [`c2pig/0trust.dev`](https://github.com/c2pig/0trust.dev).
