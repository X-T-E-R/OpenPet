# OpenPet HTTP API Reference

Read this only when debugging raw HTTP behavior or changing runtime routes. For normal agent use, prefer:

```powershell
python scripts\openpet_cli.py --help
```

## Base URL

Default:

```text
http://127.0.0.1:17321
```

The OpenPet Settings page can save a custom listen address and port for the next app launch. Environment override:

```powershell
$env:CODEX_PET_RUNTIME_HOST = "127.0.0.1"
$env:CODEX_PET_RUNTIME_PORT = "17322"
pnpm tauri:dev
```

The CLI also accepts `--port <port>` or `--base-url <url>`.

## Routes

### Status

```http
GET /api/status
```

Returns `RuntimeSnapshot`.

### Action

```http
POST /api/action
Content-Type: application/json

{"animationId":"waving"}
```

Public action ids are `waving`, `jumping`, `waiting`, `running`, `review`, and `failed`.

### Say

```http
POST /api/say
Content-Type: application/json

{"text":"Thinking...","ttlMs":4000}
```

`ttlMs` is optional. Text is trimmed and capped by the runtime.

### Companion Event

```http
POST /api/event
Content-Type: application/json

{"type":"success","message":"Tests passed","ttlMs":4000}
```

Supported event types are `thinking`, `tool-running`, `reviewing`, `success`, `failure`, and `attention`.

### Local Import

```http
POST /api/import/local
Content-Type: application/json

{"source":"public/pets/nia","force":false}
```

`source` can be a package directory, `pet.json`, or `spritesheet.webp` path accessible to the local runtime. Optional fields are `id`, `displayName`, `description`, and `force`.

### Website Import

```http
POST /api/import/website
Content-Type: application/json

{"url":"https://petdex.crafter.run/pets/boba","force":false}
```

The runtime resolves supported HTTPS sources, downloads bounded public metadata and WebP spritesheets, validates them, writes a local package, refreshes the catalog, and returns an updated `RuntimeSnapshot`.

### Imported Spritesheet

```http
GET /api/pets/<petId>/spritesheet
```

Returns `image/webp` for imported pets that are already loaded into the runtime catalog.
