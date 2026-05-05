# OpenPet Runtime Import Contract

Read this when changing local or website import behavior.

## Package Shape

Imported pet packages are installed under the Tauri app data directory:

```text
<app-data>/pets/<pet-id>/
  pet.json
  spritesheet.webp
```

`pet.json` uses camelCase:

```json
{
  "id": "tiny-duck",
  "displayName": "Tiny Duck",
  "description": "A tidy duck for calm workspace days.",
  "spritesheetPath": "spritesheet.webp",
  "sourceName": "Local",
  "sourceUrl": null,
  "imported": true
}
```

## Validation Rules

- `id` must be 2 to 72 characters, lowercase ASCII letters, digits, or hyphens, and must not start or end with a hyphen.
- Bundled id `nia` is reserved; imported collisions are prefixed with `imported-`.
- `displayName` must be non-empty.
- The runtime loads imported packages only when `spritesheet.webp` exists.
- Local import accepts package directories, `pet.json`, or `.webp` spritesheets.
- Local package `spritesheetPath` must be relative and stay inside the package directory.
- Website import accepts HTTPS URLs only and rejects localhost, private, loopback, multicast, and unspecified IP hosts.
- Website import downloads bounded HTML/JSON/spritesheet bytes and validates the WebP header before writing files.
- Imports must not execute third-party install commands.

## App Data Path

The CLI derives app data from the Tauri identifier `dev.xter.openpet`:

- Windows: `%APPDATA%\dev.xter.openpet`
- macOS: `~/Library/Application Support/dev.xter.openpet`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dev.xter.openpet`

Use `--app-data-dir`, `--pets-dir`, or `CODEX_PET_APP_DATA_DIR` only for explicit diagnostics or offline local fallback.

## Website Sources

Supported resolver behavior mirrors the runtime source compatibility:

- Petdex detail page: `https://petdex.crafter.run/pets/<slug>`.
- Codex Pets share/detail URL: `https://codex-pets.net/share/<id>` or `https://codex-pets.net/#/pets/<id>`.
- Generic HTTPS page exposing a likely direct `.webp` spritesheet through JSON-LD, metadata, or HTML.

## Live Runtime Rule

Normal `import-local` and `import-website` commands call OpenPet's local HTTP routes and return the refreshed runtime snapshot. Direct app-data writes are limited to `import-local --offline-install`, which must tell the user to restart OpenPet.
