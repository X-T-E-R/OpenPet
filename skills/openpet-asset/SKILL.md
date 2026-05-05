---
name: openpet-asset
description: Create, validate, and package Codex-compatible desktop pet assets for OpenPet.
---

# OpenPet Asset

Use this skill when creating or validating OpenPet asset packages. This runtime-specific skill is derived from the local Codex `hatch-pet` skill concept; preserve that attribution in substantial future rewrites.

## Contract

Runtime pet packages use:

```text
pet-folder/
  pet.json
  spritesheet.webp
```

`pet.json` shape:

```json
{
  "id": "tiny-duck",
  "displayName": "Tiny Duck",
  "description": "A tidy duck for calm workspace days.",
  "spritesheetPath": "spritesheet.webp"
}
```

Spritesheet contract:

- PNG or WebP with alpha for authoring; imported runtime packages currently require `spritesheet.webp`.
- Atlas is `1536x1872`.
- Grid is `8` columns by `9` rows.
- Cell size is `192x208`.
- Background and unused cells are transparent.
- Row timings are owned by `src/pet/animation.ts`.

## Workflow

1. If creating new art, use the upstream Codex `hatch-pet` workflow for generation, row extraction, contact sheets, validation, and package creation.
2. Validate the final atlas when the upstream validator exists. From that validator skill's folder, run:

```powershell
python scripts\validate_atlas.py <path-to-spritesheet>
```

3. If the upstream validator is unavailable, still verify dimensions, alpha channel, `8x9` grid, and `192x208` cells with an image tool.
4. Review contact sheets, preview videos, `qa/review.json`, and `final/validation.json` when they exist.
5. For bundled runtime assets, copy the finished package into `public/pets/<id>/`.
6. For local user imports, prefer the CLI:

```powershell
python ..\openpet-cli\scripts\openpet_cli.py import-local <pet-folder> --dry-run
python ..\openpet-cli\scripts\openpet_cli.py import-local <pet-folder>
```

## Runtime Rules

- Built-in art lives under `public/pets/<id>/`.
- Imported art lives under app data and is installed through the CLI or Settings UI.
- Do not point runtime code at a personal Codex pets folder or another user-local path.
- Preserve source, license status, and release caveats before bundling art.
- Transparent pet windows must keep `html`, `body`, and `#root` transparent for the pet route.
- Autonomous walking and hover pause are runtime settings, not asset metadata.

## Acceptance Check

- `validate_atlas.py` reports `ok: true`, or another deterministic atlas check confirms dimensions/grid/cell size.
- `pet.json` uses a safe id and relative `spritesheetPath`.
- Imported packages validate with `python ..\openpet-cli\scripts\openpet_cli.py import-local <path> --dry-run`.
- No white, checkerboard, or opaque rectangular background is visible in used or unused cells.
- The pet shell shows the full `192x208` CSS cell at scale `1`.
- Source, license status, and redistribution caveats are preserved before bundling or sharing assets.
