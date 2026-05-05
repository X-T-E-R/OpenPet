<p align="center">
  <img src="public/brand/openpet-logo.png" alt="OpenPet desktop pet logo" width="180" />
</p>

# OpenPet

[简体中文](README.zh-CN.md)

OpenPet is a local desktop pet runtime for Codex-compatible companions. It shows a transparent always-on-top pet window, lets users import compatible pets, and exposes a local control API so OpenClaw, Codex, and other agents can show status through actions, bubbles, and events.

GitHub: <https://github.com/X-T-E-R/OpenPet>

## Quick Start

For most Windows users, install a packaged build from [GitHub Releases](https://github.com/X-T-E-R/OpenPet/releases) and launch OpenPet. The pet appears on your desktop, can be dragged to the position you want, and can be configured from the pet right-click menu or the app tray/menu.

Release builds are generated for Windows, macOS, and Linux. Development and manual verification currently happen on Windows; macOS and Linux packages are built by CI but have not been manually tested by the developer yet.

### Platform Status

- Windows: primary manually verified platform.
- macOS: CI builds Apple Silicon and Intel artifacts separately. Normal launch of a downloaded macOS app requires Apple Developer ID signing and notarization; if the release was built without those credentials, Gatekeeper may show that OpenPet is damaged or cannot be verified. Treat unsigned macOS artifacts as tester builds, not production-ready distribution.
- Linux: CI builds `.deb`, `.rpm`, and `.AppImage` artifacts on Ubuntu, but runtime behavior has not been manually verified yet.

To run from source:

```powershell
pnpm install
pnpm tauri:dev
```

## Features

- Transparent, borderless, always-on-top desktop pet window.
- Click-to-act, drag-to-position, right-click pet menu, and app tray/menu controls.
- Website import for compatible public Codex pet pages, with imported assets stored locally and served by OpenPet.
- Local pet import through the running runtime API for agent and CLI workflows.
- Companion events for `thinking`, `tool-running`, `reviewing`, `success`, `failure`, and `attention`.
- Settings for English / Simplified Chinese UI, pet selection, click action mode, random click action pool, event reactions, event bubbles, idle self-play, autonomous walking, hover pause, walking speed, scale, reduced motion, and configurable HTTP API listen address / port.

## Import Pets

Bundled pets live in `public/pets/<id>/`. Imported pets are stored in the app data directory and join the same runtime catalog. A Codex-compatible package should include:

```text
pet.json
spritesheet.webp
```

The bundled `nia` pack uses a `1536x1872` spritesheet atlas with an `8x9` grid and `192x208` cells.

Open Settings to import from a supported website URL. Current compatibility targets:

- [Petdex](https://petdex.crafter.run/): `https://petdex.crafter.run/pets/<slug>`
- [Codex Pets](https://codex-pets.net/): `https://codex-pets.net/share/<id>` and `https://codex-pets.net/#/pets/<id>`
- [SpriteYard](https://spriteyard.com/) and [Codex Pet Shop](https://www.codexpetshop.com/): generic support for pages that expose a public Codex-compatible `spritesheet.webp`

The importer downloads public metadata and the WebP spritesheet for the URL you provide. It does not execute third-party install commands and does not hotlink gallery images at runtime.

## Agent Skills And Protocols

OpenPet is designed to be controlled by local agents. Install only the skills you need:

- `openpet-cli`: CLI control path for agents that can run local commands.
- `openpet-mcp`: MCP control path for agents or clients that support Model Context Protocol.
- `openpet-asset`: optional pet creation / validation workflow; install only when creating or packaging pets.

For normal control, choose either `openpet-cli` or `openpet-mcp`. Agents that can call localhost directly can use the HTTP API guidance below without installing a separate skill.

### Agent Hook Tip

If you want OpenPet to collaborate with an existing agent, add a short note to `AGENTS.md`, `.cursorrules`, or a similar agent instruction file. Tell the agent to use an installed OpenPet skill, such as `openpet-cli` or `openpet-mcp`, for desktop-pet progress updates during long work.

If several OpenPet skills are installed, let the agent choose one integration path and condense the chosen rule into its local instruction file. The rule should reference the installed skill instead of duplicating protocol or command details.

### CLI

```powershell
python skills\openpet-cli\scripts\openpet_cli.py --help
python skills\openpet-cli\scripts\openpet_cli.py doctor --json
python skills\openpet-cli\scripts\openpet_cli.py status --json
python skills\openpet-cli\scripts\openpet_cli.py event thinking --message "Reading the repo..."
python skills\openpet-cli\scripts\openpet_cli.py import-local public\pets\nia --dry-run --json
python skills\openpet-cli\scripts\openpet_cli.py import-website https://petdex.crafter.run/pets/boba
```

In agent instructions, tell the agent to use the `openpet-cli` skill for status checks, progress events, or pet imports. The CLI calls the running local runtime; if OpenPet is not reachable, live commands fail safely with a clear message instead of modifying app data behind the app's back.

### MCP

The MCP bridge is for IDEs or agents that support Model Context Protocol. Open your IDE / agent MCP settings and register an `openpet` stdio server that points at this repository's MCP script:

```json
{
  "mcpServers": {
    "openpet": {
      "command": "python",
      "args": ["skills/openpet-mcp/scripts/openpet_mcp_server.py"]
    }
  }
}
```

Use an absolute script path if your MCP client does not run from the repository root. The Python environment used by the client should have the official MCP SDK installed:

```powershell
python -m pip install "mcp[cli]"
```

The MCP server exposes tools for status, action, say, companion event, local import, and website import. It talks to the running OpenPet HTTP API; if OpenPet uses a custom endpoint, add `--base-url http://127.0.0.1:<port>` to the server args or set `OPENPET_BASE_URL`.

### Direct HTTP API

Agents can also call the HTTP API directly:

```http
GET /api/status
POST /api/action
POST /api/say
POST /api/event
POST /api/import/local
POST /api/import/website
GET /api/pets/<petId>/spritesheet
```

Example Companion event:

```bash
curl -X POST http://127.0.0.1:17321/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"thinking","message":"Reading the repo...","ttlMs":4000}'
```

Example local import through the runtime:

```bash
curl -X POST http://127.0.0.1:17321/api/import/local \
  -H "Content-Type: application/json" \
  -d '{"source":"public/pets/nia"}'
```

You can change the runtime listen address and port in Settings. Endpoint changes are saved and take effect after restarting OpenPet.

## Developer Checks

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python skills\openpet-cli\scripts\openpet_cli.py --help
python skills\openpet-mcp\scripts\openpet_mcp_server.py --help
python skills\openpet-cli\scripts\openpet_cli.py doctor --json
python skills\openpet-cli\scripts\openpet_cli.py import-local public\pets\nia --dry-run --json
```

For release checks and bundles:

```powershell
pnpm release:check
pnpm release:bundle
```

macOS release distribution needs Apple Developer ID signing and notarization. Configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` repository secrets before publishing macOS artifacts for normal end users; otherwise the workflow falls back to ad-hoc signed CI artifacts that Gatekeeper may block.

## Safety And Rights

- The control API defaults to `127.0.0.1` and is intended for tools running on the same machine. Use `0.0.0.0` only for trusted local-network workflows.
- Imported pets may include artwork, characters, trademarks, or fan art owned by third parties. Only import pets you have the right to use.
- Before publishing builds or asset bundles, confirm redistribution rights for bundled art. Replace uncertain assets with project-owned assets.
- OpenPet is licensed under GPL-3.0-or-later; see `LICENSE`. Imported pets and third-party artwork may have separate rights requirements.
- OpenPet is not affiliated with, endorsed by, or sponsored by OpenAI, Petdex, Codex Pets, SpriteYard, Codex Pet Shop, or other community galleries.

## Project Links

- GitHub: <https://github.com/X-T-E-R/OpenPet>
- Support: <https://afdian.com/a/xter123>

## Friendly Links

- [linux.do](https://linux.do)
