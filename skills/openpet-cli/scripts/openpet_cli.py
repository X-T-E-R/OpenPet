#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sys
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


APP_IDENTIFIER = "dev.xter.openpet"
DEFAULT_PORT = 17321
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024
MAX_SPRITESHEET_BYTES = 12 * 1024 * 1024
USER_AGENT = "OpenPetCLI/0.1 website-import"
PET_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,70}[a-z0-9])$")
BUNDLED_PET_IDS = {"nia"}
EVENT_TYPES = ("thinking", "tool-running", "reviewing", "success", "failure", "attention")


class CliError(Exception):
    pass


@dataclass
class PetPackage:
    pet_id: str
    display_name: str
    description: str
    spritesheet: Path
    source_name: str | None = None
    source_url: str | None = None


@dataclass
class ResolvedWebsitePet:
    pet_id: str
    display_name: str
    description: str
    spritesheet_url: str
    source_name: str
    source_url: str


def fail(message: str, args: argparse.Namespace | None = None, exit_code: int = 1) -> int:
    if args is not None and getattr(args, "json", False):
        print(json.dumps({"ok": False, "error": message}, indent=2))
    else:
        print(f"error: {message}", file=sys.stderr)
    return exit_code


def print_result(data: dict[str, Any], args: argparse.Namespace, text: str | None = None) -> int:
    if getattr(args, "json", False):
        print(json.dumps(data, indent=2, ensure_ascii=False))
    elif text is not None:
        print(text)
    else:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def runtime_base_url(args: argparse.Namespace) -> str:
    if getattr(args, "base_url", None):
        return args.base_url.rstrip("/")
    port = getattr(args, "port", None) or os.environ.get("CODEX_PET_RUNTIME_PORT") or DEFAULT_PORT
    return f"http://127.0.0.1:{int(port)}"


def request_json(
    args: argparse.Namespace,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 5.0,
) -> dict[str, Any]:
    base_url = runtime_base_url(args)
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise CliError(f"runtime HTTP {error.code}: {detail}") from error
    except (URLError, OSError) as error:
        raise CliError(f"runtime is not reachable at {base_url}: {error}") from error
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise CliError(f"runtime returned invalid JSON: {error}") from error


def command_status(args: argparse.Namespace) -> int:
    snapshot = request_json(args, "GET", "/api/status")
    active = snapshot.get("activePet", {}).get("id", "unknown")
    return print_result(
        {"ok": True, "snapshot": snapshot},
        args,
        f"runtime listening on port {snapshot.get('port')}; active pet: {active}",
    )


def command_action(args: argparse.Namespace) -> int:
    snapshot = request_json(args, "POST", "/api/action", {"animationId": args.animation_id})
    return print_result(
        {"ok": True, "snapshot": snapshot},
        args,
        f"played action: {args.animation_id}",
    )


def command_say(args: argparse.Namespace) -> int:
    payload: dict[str, Any] = {"text": args.text}
    if args.ttl_ms is not None:
        payload["ttlMs"] = args.ttl_ms
    snapshot = request_json(args, "POST", "/api/say", payload)
    return print_result({"ok": True, "snapshot": snapshot}, args, "sent bubble text")


def command_event(args: argparse.Namespace) -> int:
    payload: dict[str, Any] = {"type": args.event_type}
    if args.message is not None:
        payload["message"] = args.message
    if args.ttl_ms is not None:
        payload["ttlMs"] = args.ttl_ms
    snapshot = request_json(args, "POST", "/api/event", payload)
    return print_result(
        {"ok": True, "snapshot": snapshot},
        args,
        f"sent event: {args.event_type}",
    )


def command_doctor(args: argparse.Namespace) -> int:
    checks: list[dict[str, Any]] = []
    checks.append(
        {
            "name": "python",
            "ok": sys.version_info >= (3, 9),
            "detail": sys.version.split()[0],
        }
    )
    app_data = resolve_app_data_dir(args)
    checks.append({"name": "app_data_dir", "ok": True, "detail": str(app_data)})
    checks.append({"name": "pets_dir", "ok": True, "detail": str(resolve_pets_dir(args))})
    try:
        snapshot = request_json(args, "GET", "/api/status", timeout=1.0)
        checks.append(
            {
                "name": "runtime_http",
                "ok": True,
                "detail": f"{runtime_base_url(args)} activePet={snapshot.get('activePet', {}).get('id')}",
            }
        )
    except CliError as error:
        checks.append(
            {
                "name": "runtime_http",
                "ok": False,
                "warning": True,
                "detail": str(error),
            }
        )

    ok = all(check["ok"] or check.get("warning") for check in checks)
    if args.json:
        return print_result({"ok": ok, "checks": checks}, args)
    for check in checks:
        level = "ok" if check["ok"] else "warn" if check.get("warning") else "fail"
        print(f"{level}: {check['name']}: {check['detail']}")
    return 0 if ok else 1


def resolve_app_data_dir(args: argparse.Namespace) -> Path:
    explicit = getattr(args, "app_data_dir", None) or os.environ.get("CODEX_PET_APP_DATA_DIR")
    if explicit:
        return Path(explicit).expanduser().resolve()
    if sys.platform.startswith("win"):
        root = os.environ.get("APPDATA")
        if root:
            return Path(root, APP_IDENTIFIER).resolve()
        return Path.home().joinpath("AppData", "Roaming", APP_IDENTIFIER).resolve()
    if sys.platform == "darwin":
        return Path.home().joinpath("Library", "Application Support", APP_IDENTIFIER).resolve()
    root = os.environ.get("XDG_DATA_HOME")
    if root:
        return Path(root, APP_IDENTIFIER).expanduser().resolve()
    return Path.home().joinpath(".local", "share", APP_IDENTIFIER).resolve()


def resolve_pets_dir(args: argparse.Namespace) -> Path:
    explicit = getattr(args, "pets_dir", None)
    if explicit:
        return Path(explicit).expanduser().resolve()
    return resolve_app_data_dir(args).joinpath("pets").resolve()


def is_valid_pet_id(value: str) -> bool:
    return bool(PET_ID_PATTERN.fullmatch(value))


def sanitize_pet_id(value: str) -> str:
    output: list[str] = []
    previous_dash = False
    for character in value.lower():
        if character.isascii() and character.isalnum():
            output.append(character)
            previous_dash = False
        elif not previous_dash and output:
            output.append("-")
            previous_dash = True
        if len(output) >= 64:
            break
    sanitized = "".join(output).strip("-")
    return sanitized if len(sanitized) >= 2 else "imported-pet"


def truncate(value: str, max_chars: int) -> str:
    return value.strip()[:max_chars]


def safe_relative_path(base: Path, value: str) -> Path:
    raw = Path(value)
    if raw.is_absolute() or ".." in raw.parts:
        raise CliError("spritesheetPath must be a relative path inside the package")
    resolved = base.joinpath(raw).resolve()
    base_resolved = base.resolve()
    try:
        resolved.relative_to(base_resolved)
    except ValueError as error:
        raise CliError("spritesheetPath must stay inside the package directory") from error
    return resolved


def read_json_file(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise CliError(f"failed to read {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise CliError(f"invalid JSON in {path}: {error}") from error


def validate_webp_file(path: Path) -> None:
    if not path.is_file():
        raise CliError(f"spritesheet not found: {path}")
    if path.suffix.lower() != ".webp":
        raise CliError("current runtime imports require a .webp spritesheet")
    try:
        with path.open("rb") as handle:
            header = handle.read(16)
    except OSError as error:
        raise CliError(f"failed to read spritesheet: {error}") from error
    if len(header) < 16 or header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        raise CliError("spritesheet must have a valid WebP header")


def resolve_local_package(source: Path, args: argparse.Namespace) -> PetPackage:
    source = source.expanduser().resolve()
    manifest: dict[str, Any] | None = None
    package_dir: Path | None = None
    spritesheet: Path | None = None

    if source.is_dir():
        package_dir = source
        manifest_path = source / "pet.json"
        if not manifest_path.is_file():
            raise CliError("package directory must contain pet.json")
        manifest = read_json_file(manifest_path)
    elif source.is_file() and source.name.lower() == "pet.json":
        package_dir = source.parent
        manifest = read_json_file(source)
    elif source.is_file():
        spritesheet = source
    else:
        raise CliError(f"source path does not exist: {source}")

    if manifest is not None:
        raw_id = args.pet_id or manifest.get("id") or package_dir.name
        pet_id = sanitize_pet_id(str(raw_id))
        display_name = args.display_name or manifest.get("displayName") or pet_id
        description = args.description or manifest.get("description") or "Imported local pet."
        spritesheet_path = manifest.get("spritesheetPath") or "spritesheet.webp"
        spritesheet = safe_relative_path(package_dir, str(spritesheet_path))
        source_name = manifest.get("sourceName") or "Local"
        source_url = manifest.get("sourceUrl")
    else:
        pet_id = sanitize_pet_id(args.pet_id or source.stem)
        display_name = args.display_name or pet_id.replace("-", " ").title()
        description = args.description or "Imported local pet."
        source_name = "Local"
        source_url = None

    if not is_valid_pet_id(pet_id):
        raise CliError(f"invalid pet id after sanitization: {pet_id}")
    if not str(display_name).strip():
        raise CliError("displayName is required")
    validate_webp_file(spritesheet)

    return PetPackage(
        pet_id=pet_id,
        display_name=truncate(str(display_name), 96),
        description=truncate(str(description), 280),
        spritesheet=spritesheet,
        source_name=str(source_name) if source_name is not None else None,
        source_url=str(source_url) if source_url is not None else None,
    )


def reserve_import_id(pet_id: str) -> str:
    if pet_id in BUNDLED_PET_IDS:
        return sanitize_pet_id(f"imported-{pet_id}")
    return pet_id


def manifest_for(package: PetPackage, pet_id: str) -> dict[str, Any]:
    return {
        "id": pet_id,
        "displayName": package.display_name,
        "description": package.description,
        "spritesheetPath": "spritesheet.webp",
        "sourceName": package.source_name,
        "sourceUrl": package.source_url,
        "imported": True,
    }


def install_package(package: PetPackage, args: argparse.Namespace) -> dict[str, Any]:
    pet_id = reserve_import_id(package.pet_id)
    pets_dir = resolve_pets_dir(args)
    target_dir = pets_dir.joinpath(pet_id).resolve()
    try:
        target_dir.relative_to(pets_dir.resolve())
    except ValueError as error:
        raise CliError("target directory escaped pets dir") from error

    manifest = manifest_for(package, pet_id)
    result = {
        "petId": pet_id,
        "sourceSpritesheet": str(package.spritesheet),
        "targetDir": str(target_dir),
        "manifest": manifest,
        "dryRun": bool(args.dry_run),
        "note": "dry-run only" if args.dry_run else "offline app-data install; restart OpenPet to refresh the catalog",
    }

    if args.dry_run:
        return result
    if target_dir.exists() and not args.force:
        raise CliError(f"target package already exists: {target_dir}; use --force to overwrite files")
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(package.spritesheet, target_dir / "spritesheet.webp")
    (target_dir / "pet.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return result


def local_import_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "source": str(Path(args.source).expanduser().resolve()),
        "force": bool(args.force),
    }
    if args.pet_id:
        payload["id"] = args.pet_id
    if args.display_name:
        payload["displayName"] = args.display_name
    if args.description:
        payload["description"] = args.description
    return payload


def command_import_local(args: argparse.Namespace) -> int:
    package = resolve_local_package(Path(args.source), args)
    if not args.dry_run and not args.offline_install:
        snapshot = request_json(args, "POST", "/api/import/local", local_import_payload(args), timeout=30.0)
        active = snapshot.get("activePet", {}).get("id", package.pet_id)
        return print_result(
            {
                "ok": True,
                "mode": "runtime",
                "activePetId": active,
                "snapshot": snapshot,
            },
            args,
            f"imported local pet through running OpenPet runtime: {active}",
        )

    result = install_package(package, args)
    return print_result(
        {"ok": True, "import": result},
        args,
        f"{'validated' if args.dry_run else 'installed offline'} local pet {result['petId']} -> {result['targetDir']}",
    )


def is_blocked_host(host: str) -> bool:
    normalized = host.strip("[]").lower()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        infos = socket.getaddrinfo(normalized, None)
    except socket.gaierror:
        infos = []
    for info in infos:
        address = info[4][0]
        try:
            import ipaddress

            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    try:
        import ipaddress

        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
    )


def parse_safe_import_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "https":
        raise CliError("only HTTPS URLs are supported for website import")
    if not parsed.netloc:
        raise CliError("URL must include a host")
    if is_blocked_host(parsed.hostname or ""):
        raise CliError("local, private, and special network hosts are not allowed")
    return parsed.geturl()


def fetch_bytes(url: str, max_bytes: int) -> bytes:
    safe_url = parse_safe_import_url(url)
    request = Request(safe_url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=25) as response:
            final_url = response.geturl()
            parse_safe_import_url(final_url)
            content_length = response.headers.get("Content-Length")
            if content_length and content_length.isdigit() and int(content_length) > max_bytes:
                raise CliError(f"remote file is larger than {max_bytes // 1024 // 1024} MB")
            data = response.read(max_bytes + 1)
    except HTTPError as error:
        raise CliError(f"failed to fetch {safe_url}: HTTP {error.code}") from error
    except (URLError, OSError) as error:
        raise CliError(f"failed to fetch {safe_url}: {error}") from error
    if len(data) > max_bytes:
        raise CliError(f"remote file is larger than {max_bytes // 1024 // 1024} MB")
    return data


def fetch_json(url: str, max_bytes: int) -> Any:
    try:
        return json.loads(fetch_bytes(url, max_bytes).decode("utf-8"))
    except UnicodeDecodeError as error:
        raise CliError("JSON response was not valid UTF-8") from error
    except json.JSONDecodeError as error:
        raise CliError(f"invalid JSON response: {error}") from error


def fetch_text(url: str, max_bytes: int) -> str:
    try:
        return fetch_bytes(url, max_bytes).decode("utf-8")
    except UnicodeDecodeError as error:
        raise CliError("response was not valid UTF-8 text") from error


def path_segment_after(url: str, prefix: str) -> str | None:
    segments = [segment for segment in urlparse(url).path.split("/") if segment]
    for index, segment in enumerate(segments):
        if segment == prefix and index + 1 < len(segments):
            return segments[index + 1]
    return None


def extract_codex_pets_id(url: str) -> str | None:
    share_id = path_segment_after(url, "share")
    if share_id:
        return share_id
    fragment = urlparse(url).fragment.lstrip("/")
    if fragment.startswith("pets/"):
        return fragment.removeprefix("pets/").split("?", 1)[0]
    return None


def get_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def resolve_petdex_source(source_url: str) -> ResolvedWebsitePet:
    slug = path_segment_after(source_url, "pets")
    if not slug:
        raise CliError("open a Petdex pet detail page, for example /pets/boba")
    manifest = fetch_json("https://petdex.crafter.run/api/manifest", MAX_JSON_BYTES)
    pets = manifest.get("pets", []) if isinstance(manifest, dict) else []
    pet = next((item for item in pets if item.get("slug") == slug), None)
    if not pet:
        raise CliError(f"Petdex pet '{slug}' was not found in the public manifest")
    spritesheet_url = parse_safe_import_url(get_value(pet, "spritesheetUrl", "spritesheet_url"))
    return ResolvedWebsitePet(
        pet_id=sanitize_pet_id(str(pet.get("slug", slug))),
        display_name=truncate(str(get_value(pet, "displayName", "display_name") or slug), 96),
        description=truncate(str(pet.get("description") or "Imported Codex-compatible pet."), 280),
        spritesheet_url=spritesheet_url,
        source_name="Petdex",
        source_url=str(get_value(pet, "pageUrl", "page_url") or source_url),
    )


def resolve_codex_pets_source(source_url: str) -> ResolvedWebsitePet:
    pet_id = extract_codex_pets_id(source_url)
    if not pet_id:
        raise CliError("open a Codex Pets share/detail URL, for example /share/<pet-id> or #/pets/<pet-id>")
    detail = fetch_json(
        f"https://ihzwckyzfcuktrljwpha.supabase.co/functions/v1/petshare/api/pets/{pet_id}",
        MAX_JSON_BYTES,
    )
    pet = detail.get("pet") if isinstance(detail, dict) else None
    if not isinstance(pet, dict):
        raise CliError("Codex Pets detail response did not include pet metadata")
    resolved_id = str(get_value(pet, "id") or pet_id)
    spritesheet_url = parse_safe_import_url(str(get_value(pet, "spritesheetUrl", "spritesheet_url")))
    return ResolvedWebsitePet(
        pet_id=sanitize_pet_id(resolved_id),
        display_name=truncate(str(get_value(pet, "displayName", "display_name") or resolved_id), 96),
        description=truncate(str(pet.get("description") or "Imported Codex-compatible pet."), 280),
        spritesheet_url=spritesheet_url,
        source_name="Codex Pets",
        source_url=f"https://codex-pets.net/share/{resolved_id}",
    )


def extract_json_ld_values(html: str) -> list[Any]:
    values: list[Any] = []
    pattern = re.compile(
        r"<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(html):
        try:
            values.append(json.loads(match.group(1).strip()))
        except json.JSONDecodeError:
            continue
    return values


def find_json_string(value: Any, key: str) -> str | None:
    if isinstance(value, dict):
        current = value.get(key)
        if isinstance(current, str):
            return current
        for nested in value.values():
            found = find_json_string(nested, key)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_json_string(nested, key)
            if found:
                return found
    return None


def find_json_webp(value: Any) -> str | None:
    if isinstance(value, str):
        return value if ".webp" in value.lower() else None
    if isinstance(value, dict):
        for nested in value.values():
            found = find_json_webp(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_json_webp(nested)
            if found:
                return found
    return None


def extract_meta_content(html: str, name_or_property: str) -> str | None:
    pattern = re.compile(r"<meta\b[^>]*>", flags=re.IGNORECASE)
    attr_pattern = re.compile(r"([a-zA-Z_:.-]+)\s*=\s*([\"'])(.*?)\2", flags=re.DOTALL)
    wanted = name_or_property.lower()
    for tag in pattern.finditer(html):
        attrs = {key.lower(): unescape(value) for key, _, value in attr_pattern.findall(tag.group(0))}
        if attrs.get("name", "").lower() == wanted or attrs.get("property", "").lower() == wanted:
            content = attrs.get("content")
            if content:
                return content
    return None


def extract_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    return unescape(re.sub(r"\s+", " ", match.group(1)).strip()) if match else None


def clean_title(value: str) -> str:
    return value.split(" - ", 1)[0].split(" | ", 1)[0].strip()


def is_likely_spritesheet(value: str) -> bool:
    lower = value.lower()
    return (
        ".webp" in lower
        and "preview" not in lower
        and "share" not in lower
        and "social" not in lower
        and "icon" not in lower
        and "logo" not in lower
        and "screenshot" not in lower
    )


def extract_webp_url(html: str, base_url: str) -> str | None:
    candidates = []
    for part in re.split(r"[\s\"'()<>,;]+", html):
        if ".webp" in part.lower() and is_likely_spritesheet(part):
            candidates.append(urljoin(base_url, part.strip()))
    candidates.sort(
        key=lambda value: (
            0
            if "spritesheet.webp" in value.lower()
            else 1
            if "/sprites/" in value.lower()
            else 2
        )
    )
    return candidates[0] if candidates else None


def resolve_generic_pet_page(source_url: str) -> ResolvedWebsitePet:
    html = fetch_text(source_url, MAX_HTML_BYTES)
    json_ld = extract_json_ld_values(html)
    display_name = (
        next((find_json_string(value, "name") for value in json_ld if find_json_string(value, "name")), None)
        or extract_meta_content(html, "og:title")
        or extract_title(html)
        or "Imported Pet"
    )
    description = (
        next(
            (find_json_string(value, "description") for value in json_ld if find_json_string(value, "description")),
            None,
        )
        or extract_meta_content(html, "description")
        or "Imported Codex-compatible pet."
    )
    spritesheet_candidate = next(
        (find_json_webp(value) for value in json_ld if find_json_webp(value) and is_likely_spritesheet(find_json_webp(value) or "")),
        None,
    )
    spritesheet_url = (
        urljoin(source_url, spritesheet_candidate)
        if spritesheet_candidate
        else extract_webp_url(html, source_url)
    )
    if not spritesheet_url:
        raise CliError("could not find a Codex-compatible spritesheet.webp on this page")
    id_hint = Path(urlparse(source_url).path).name or display_name
    return ResolvedWebsitePet(
        pet_id=sanitize_pet_id(id_hint),
        display_name=truncate(clean_title(display_name), 96),
        description=truncate(description, 280),
        spritesheet_url=parse_safe_import_url(spritesheet_url),
        source_name=(urlparse(source_url).hostname or "Website").removeprefix("www."),
        source_url=source_url,
    )


def resolve_website_source(source_url: str) -> ResolvedWebsitePet:
    safe_url = parse_safe_import_url(source_url)
    host = (urlparse(safe_url).hostname or "").lower()
    if host == "petdex.crafter.run":
        return resolve_petdex_source(safe_url)
    if host in {"codex-pets.net", "www.codex-pets.net"}:
        return resolve_codex_pets_source(safe_url)
    return resolve_generic_pet_page(safe_url)


def validate_webp_bytes(data: bytes) -> None:
    if len(data) < 16 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise CliError("downloaded spritesheet must have a valid WebP header")


def command_import_website(args: argparse.Namespace) -> int:
    if not args.dry_run:
        snapshot = request_json(
            args,
            "POST",
            "/api/import/website",
            {"url": args.url, "force": bool(args.force)},
            timeout=60.0,
        )
        active = snapshot.get("activePet", {}).get("id", "unknown")
        return print_result(
            {
                "ok": True,
                "mode": "runtime",
                "activePetId": active,
                "snapshot": snapshot,
            },
            args,
            f"imported website pet through running OpenPet runtime: {active}",
        )

    resolved = resolve_website_source(args.url)
    data = b"" if args.dry_run and args.skip_download_on_dry_run else fetch_bytes(resolved.spritesheet_url, MAX_SPRITESHEET_BYTES)
    if data:
        validate_webp_bytes(data)

    temp_source = Path("<downloaded>")
    package = PetPackage(
        pet_id=resolved.pet_id,
        display_name=resolved.display_name,
        description=resolved.description,
        spritesheet=temp_source,
        source_name=resolved.source_name,
        source_url=resolved.source_url,
    )
    pet_id = reserve_import_id(package.pet_id)
    pets_dir = resolve_pets_dir(args)
    target_dir = pets_dir.joinpath(pet_id).resolve()
    manifest = manifest_for(package, pet_id)
    result = {
        "petId": pet_id,
        "spritesheetUrl": resolved.spritesheet_url,
        "targetDir": str(target_dir),
        "manifest": manifest,
        "dryRun": bool(args.dry_run),
        "note": "dry-run only" if args.dry_run else "offline app-data install; restart OpenPet to refresh the catalog",
    }

    if not args.dry_run:
        if target_dir.exists() and not args.force:
            raise CliError(f"target package already exists: {target_dir}; use --force to overwrite files")
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "spritesheet.webp").write_bytes(data)
        (target_dir / "pet.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return print_result(
        {"ok": True, "import": result},
        args,
        f"{'validated' if args.dry_run else 'installed'} website pet {pet_id} -> {target_dir}",
    )


def command_help(args: argparse.Namespace) -> int:
    parser = build_parser()
    command_parsers = getattr(parser, "_command_parsers", {})
    if args.topic:
        topic_parser = command_parsers.get(args.topic)
        if topic_parser is None:
            raise CliError(f"unknown help topic: {args.topic}")
        topic_parser.print_help()
        return 0
    parser.print_help()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openpet-cli",
        description="Control OpenPet and import Codex-compatible pet packages through the local runtime.",
    )
    parser.add_argument("--base-url", help="Runtime base URL, default derived from --port.")
    parser.add_argument("--port", type=int, help=f"Runtime HTTP port, default {DEFAULT_PORT}.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    parser.add_argument("--app-data-dir", help="Override Tauri app data directory.")
    parser.add_argument("--pets-dir", help="Override imported pets directory directly.")

    subparsers = parser.add_subparsers(dest="command", required=True)
    command_parsers: dict[str, argparse.ArgumentParser] = {}

    help_parser = subparsers.add_parser("help", help="Show top-level or command-specific help.")
    help_parser.add_argument("topic", nargs="?")
    help_parser.set_defaults(func=command_help)
    command_parsers["help"] = help_parser

    doctor = subparsers.add_parser("doctor", help="Check CLI assumptions and runtime reachability.")
    doctor.set_defaults(func=command_doctor)
    command_parsers["doctor"] = doctor

    status = subparsers.add_parser("status", help="Read runtime status through HTTP.")
    status.set_defaults(func=command_status)
    command_parsers["status"] = status

    action = subparsers.add_parser("action", help="Trigger a runtime animation action.")
    action.add_argument("animation_id", help="Animation id, for example waving, jumping, waiting, running, review, failed.")
    action.set_defaults(func=command_action)
    command_parsers["action"] = action

    say = subparsers.add_parser("say", help="Show a speech bubble.")
    say.add_argument("text")
    say.add_argument("--ttl-ms", type=int)
    say.set_defaults(func=command_say)
    command_parsers["say"] = say

    event = subparsers.add_parser("event", help="Send a companion event.")
    event.add_argument("event_type", choices=EVENT_TYPES)
    event.add_argument("--message")
    event.add_argument("--ttl-ms", type=int)
    event.set_defaults(func=command_event)
    command_parsers["event"] = event

    import_local = subparsers.add_parser("import-local", help="Validate or import a local pet package through the running runtime.")
    import_local.add_argument("source", help="Package directory, pet.json, or spritesheet.webp.")
    import_local.add_argument("--id", dest="pet_id", help="Override package pet id.")
    import_local.add_argument("--display-name", help="Override display name.")
    import_local.add_argument("--description", help="Override description.")
    import_local.add_argument("--dry-run", action="store_true", help="Validate and print target paths without writing.")
    import_local.add_argument("--force", action="store_true", help="Overwrite pet.json and spritesheet.webp if the package exists.")
    import_local.add_argument(
        "--offline-install",
        action="store_true",
        help="Write app-data files directly instead of calling the running runtime; restart OpenPet afterwards.",
    )
    import_local.set_defaults(func=command_import_local)
    command_parsers["import-local"] = import_local

    import_website = subparsers.add_parser("import-website", help="Validate or import a pet from a supported HTTPS website through the running runtime.")
    import_website.add_argument("url")
    import_website.add_argument("--dry-run", action="store_true", help="Resolve and validate without writing.")
    import_website.add_argument(
        "--skip-download-on-dry-run",
        action="store_true",
        help="During dry-run, resolve metadata but do not download the spritesheet.",
    )
    import_website.add_argument("--force", action="store_true", help="Overwrite pet.json and spritesheet.webp if the package exists.")
    import_website.set_defaults(func=command_import_website)
    command_parsers["import-website"] = import_website

    setattr(parser, "_command_parsers", command_parsers)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    if argv is None:
        argv = sys.argv[1:]
    json_requested = "--json" in argv
    if json_requested:
        argv = [value for value in argv if value != "--json"]
    args = parser.parse_args(argv)
    args.json = bool(getattr(args, "json", False) or json_requested)
    try:
        return args.func(args)
    except CliError as error:
        return fail(str(error), args)
    except KeyboardInterrupt:
        return fail("interrupted", args, 130)


if __name__ == "__main__":
    raise SystemExit(main())
