---
name: openpet-mcp
description: Use the OpenPet MCP bridge to inspect and control the local desktop pet, send status events, and import compatible pet sources through the running runtime.
---

# OpenPet MCP Bridge

Use this skill when an agent supports Model Context Protocol (MCP) and should control OpenPet through MCP tools instead of shelling out to the CLI.

Default stdio server entry point:

```powershell
python scripts\openpet_mcp_server.py --help
python scripts\openpet_mcp_server.py
```

Install the official MCP Python SDK first when it is not already available:

```powershell
python -m pip install "mcp[cli]"
```

## Client Configuration

For MCP clients that accept a stdio server command, point them at:

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

If OpenPet is using a non-default HTTP endpoint, pass it explicitly:

```json
{
  "mcpServers": {
    "openpet": {
      "command": "python",
      "args": [
        "skills/openpet-mcp/scripts/openpet_mcp_server.py",
        "--base-url",
        "http://127.0.0.1:17322"
      ]
    }
  }
}
```

## Workflow

1. Use `openpet_doctor` when runtime reachability or endpoint configuration matters.
2. Use `openpet_status`, `openpet_action`, `openpet_say`, and `openpet_event` for live control.
3. Use `openpet_import_local` to ask the running runtime to import a local package directory, `pet.json`, or `spritesheet.webp`.
4. Use `openpet_import_website` to ask the running runtime to import a supported HTTPS website source.
5. Treat connection failures as safe failures: report the runtime is not reachable and do not silently edit app data.

## Available Tools

- `openpet_doctor(base_url?: string)` checks runtime reachability.
- `openpet_status(base_url?: string)` returns the current `RuntimeSnapshot`.
- `openpet_action(animation_id, base_url?: string)` plays an action animation.
- `openpet_say(text, ttl_ms?: int, base_url?: string)` shows a speech bubble.
- `openpet_event(event_type, message?: string, ttl_ms?: int, base_url?: string)` sends a companion event.
- `openpet_import_local(source, force?: bool, id?: string, display_name?: string, description?: string, base_url?: string)` imports a local pet package through the running runtime.
- `openpet_import_website(url, force?: bool, base_url?: string)` imports a compatible website pet through the running runtime.

## Event Contract

`openpet_event` accepts exactly:

- `thinking`
- `tool-running`
- `reviewing`
- `success`
- `failure`
- `attention`

## Runtime Boundaries

- MCP tools require OpenPet's local HTTP server to be running.
- The default target is `http://127.0.0.1:17321`.
- Set `OPENPET_BASE_URL`, pass `--base-url`, or pass a per-tool `base_url` when OpenPet runs on another endpoint.
- Runtime imports return an updated `RuntimeSnapshot`; agents should not require an app restart after successful live imports.
- Imports must not execute third-party install commands.

## Validation

After changing this skill or MCP server, run:

```powershell
python scripts\openpet_mcp_server.py --help
```

If the official MCP SDK is installed, also run an MCP client/inspector smoke test against the stdio server.

If Rust runtime contracts changed, also run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

If TypeScript or package configuration changed, also run:

```powershell
pnpm build
```
