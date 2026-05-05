---
name: openpet-cli
description: Use the OpenPet agent CLI protocol to inspect and control the local desktop pet, send status events, and import Codex-compatible local or website pet sources through the running runtime.
---

# OpenPet Agent CLI Protocol

Use this skill when OpenClaw, Codex, or another local agent needs to operate OpenPet. The protocol favors safe, observable runtime calls over private app-data writes.

Default entry point:

```powershell
python scripts\openpet_cli.py --help
```

## Workflow

1. Run `python scripts\openpet_cli.py doctor --json` when runtime reachability, app-data assumptions, or local server state matters.
2. Use `status`, `action`, `say`, and `event` for live control through the configured local runtime endpoint.
3. Use `import-local <path>` to ask the running OpenPet runtime to import a local package directory, `pet.json`, or `spritesheet.webp`.
4. Use `import-website <url>` to ask the running OpenPet runtime to import a supported HTTPS website source.
5. Use `--dry-run --json` before imports when you need validation without writing.
6. Treat connection failures as safe failures: report the runtime is not reachable and do not silently edit app data. `--offline-install` exists only as an explicit local fallback.

## Commands

```powershell
python scripts\openpet_cli.py --help
python scripts\openpet_cli.py doctor --json
python scripts\openpet_cli.py status --json
python scripts\openpet_cli.py action waving
python scripts\openpet_cli.py say "Thinking..." --ttl-ms 4000
python scripts\openpet_cli.py event success --message "Tests passed"
python scripts\openpet_cli.py import-local public\pets\nia --dry-run --json
python scripts\openpet_cli.py import-local <path-to-pet-folder>
python scripts\openpet_cli.py import-website https://petdex.crafter.run/pets/boba
```

## Event Contract

`event` accepts exactly:

- `thinking`
- `tool-running`
- `reviewing`
- `success`
- `failure`
- `attention`

## Loading Policy

- Do not load API details by default.
- Read `references/http-api.md` only when debugging raw HTTP requests, adding routes, or explaining endpoint payloads.
- Read `references/runtime-contract.md` only when changing import behavior, pet package validation, app-data storage, or runtime catalog assumptions.
- Read `scripts/openpet_cli.py` only when modifying or debugging the CLI implementation.

## Runtime Boundaries

- Live commands require OpenPet's local HTTP server to be running. The default endpoint is `http://127.0.0.1:17321`; use `--base-url` or `--port` when Settings uses a custom port.
- Runtime imports return an updated `RuntimeSnapshot`; agents should not require an app restart after successful live imports.
- The current app-data identifier is `dev.xter.openpet`.
- Imported packages use `spritesheet.webp`.
- Imports must not execute third-party install commands.

## Validation

After changing this skill or CLI, run:

```powershell
python scripts\openpet_cli.py --help
python scripts\openpet_cli.py doctor --json
python scripts\openpet_cli.py import-local ..\..\public\pets\nia --dry-run --json
```

If Rust runtime contracts changed, also run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

If TypeScript or package configuration changed, also run:

```powershell
pnpm build
```
