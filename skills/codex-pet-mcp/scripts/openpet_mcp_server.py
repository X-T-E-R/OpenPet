from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

DEFAULT_RUNTIME_HOST = "127.0.0.1"
DEFAULT_RUNTIME_PORT = 17321
EVENT_TYPES = {"thinking", "tool-running", "reviewing", "success", "failure", "attention"}


class OpenPetError(RuntimeError):
    pass


def default_base_url() -> str:
    base_url = os.environ.get("OPENPET_BASE_URL")
    if base_url:
        return normalize_base_url(base_url)

    host = os.environ.get("CODEX_PET_RUNTIME_HOST", DEFAULT_RUNTIME_HOST)
    raw_port = os.environ.get("CODEX_PET_RUNTIME_PORT", str(DEFAULT_RUNTIME_PORT))
    try:
        port = int(raw_port)
    except ValueError:
        port = DEFAULT_RUNTIME_PORT
    return normalize_base_url(f"http://{host}:{port}")


def normalize_base_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise OpenPetError("base_url must be an http(s) URL, for example http://127.0.0.1:17321")
    return value.rstrip("/")


def target_base_url(base_url: str | None, fallback: str) -> str:
    return normalize_base_url(base_url) if base_url else fallback


def request_json(
    fallback_base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    base_url: str | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    url = f"{target_base_url(base_url, fallback_base_url)}{path}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"

    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = raw or error.reason
        raise OpenPetError(f"OpenPet HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise OpenPetError(f"OpenPet runtime is not reachable at {url}: {error.reason}") from error

    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise OpenPetError(f"OpenPet returned non-JSON response from {url}") from error

    if not isinstance(value, dict):
        raise OpenPetError(f"OpenPet returned an unexpected response from {url}")
    return value


def compact_result(action: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "action": action,
        "activePet": snapshot.get("activePet"),
        "apiBaseUrl": snapshot.get("apiBaseUrl"),
        "apiListening": snapshot.get("apiListening"),
        "apiRestartRequired": snapshot.get("apiRestartRequired"),
        "lastAction": snapshot.get("lastAction"),
        "bubbleText": snapshot.get("bubbleText"),
        "recentEvents": snapshot.get("recentEvents", [])[:3],
    }


def build_server(fallback_base_url: str):
    try:
        from mcp.server.fastmcp import FastMCP
    except ModuleNotFoundError as error:
        raise SystemExit(
            'Missing official MCP Python SDK. Install it with: python -m pip install "mcp[cli]"'
        ) from error

    mcp = FastMCP("OpenPet")

    @mcp.tool()
    def openpet_doctor(base_url: str | None = None) -> dict[str, Any]:
        """Check whether the OpenPet runtime HTTP API is reachable."""
        resolved_base_url = target_base_url(base_url, fallback_base_url)
        try:
            snapshot = request_json(resolved_base_url, "GET", "/api/status")
            return {
                "ok": True,
                "baseUrl": resolved_base_url,
                "apiListening": snapshot.get("apiListening"),
                "apiRestartRequired": snapshot.get("apiRestartRequired"),
                "activePet": snapshot.get("activePet"),
            }
        except OpenPetError as error:
            return {"ok": False, "baseUrl": resolved_base_url, "error": str(error)}

    @mcp.tool()
    def openpet_status(base_url: str | None = None) -> dict[str, Any]:
        """Return the current OpenPet runtime snapshot."""
        return request_json(fallback_base_url, "GET", "/api/status", base_url=base_url)

    @mcp.tool()
    def openpet_action(animation_id: str, base_url: str | None = None) -> dict[str, Any]:
        """Play an OpenPet action animation."""
        snapshot = request_json(
            fallback_base_url,
            "POST",
            "/api/action",
            {"animationId": animation_id},
            base_url=base_url,
        )
        return compact_result("action", snapshot)

    @mcp.tool()
    def openpet_say(
        text: str,
        ttl_ms: int | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """Show a speech bubble above the pet."""
        payload: dict[str, Any] = {"text": text}
        if ttl_ms is not None:
            payload["ttlMs"] = ttl_ms
        snapshot = request_json(fallback_base_url, "POST", "/api/say", payload, base_url=base_url)
        return compact_result("say", snapshot)

    @mcp.tool()
    def openpet_event(
        event_type: str,
        message: str | None = None,
        ttl_ms: int | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """Send a companion event such as thinking, reviewing, success, or failure."""
        if event_type not in EVENT_TYPES:
            raise OpenPetError(f"event_type must be one of: {', '.join(sorted(EVENT_TYPES))}")
        payload: dict[str, Any] = {"type": event_type}
        if message:
            payload["message"] = message
        if ttl_ms is not None:
            payload["ttlMs"] = ttl_ms
        snapshot = request_json(fallback_base_url, "POST", "/api/event", payload, base_url=base_url)
        return compact_result("event", snapshot)

    @mcp.tool()
    def openpet_import_local(
        source: str,
        force: bool = False,
        id: str | None = None,
        display_name: str | None = None,
        description: str | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """Import a local OpenPet package directory, pet.json, or spritesheet.webp."""
        payload: dict[str, Any] = {"source": source, "force": force}
        if id:
            payload["id"] = id
        if display_name:
            payload["displayName"] = display_name
        if description:
            payload["description"] = description
        snapshot = request_json(
            fallback_base_url,
            "POST",
            "/api/import/local",
            payload,
            base_url=base_url,
            timeout=30.0,
        )
        return compact_result("import-local", snapshot)

    @mcp.tool()
    def openpet_import_website(
        url: str,
        force: bool = False,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """Import a compatible public pet page through the running OpenPet runtime."""
        snapshot = request_json(
            fallback_base_url,
            "POST",
            "/api/import/website",
            {"url": url, "force": force},
            base_url=base_url,
            timeout=45.0,
        )
        return compact_result("import-website", snapshot)

    return mcp


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="openpet-mcp-server",
        description="Expose OpenPet runtime controls as MCP tools.",
    )
    parser.add_argument(
        "--base-url",
        help=f"OpenPet HTTP API base URL, default http://{DEFAULT_RUNTIME_HOST}:{DEFAULT_RUNTIME_PORT}.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        base_url = normalize_base_url(args.base_url) if args.base_url else default_base_url()
    except OpenPetError as error:
        print(str(error), file=sys.stderr)
        return 2

    server = build_server(base_url)
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
