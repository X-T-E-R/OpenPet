use crate::{
    emit_companion_event, emit_http_action, emit_http_say, import_local_pet, import_website_pet,
    ActionPayload, AppState, CompanionEventPayload, LocalImportPayload, SayPayload,
    WebsiteImportPayload,
};
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};
use tauri::AppHandle;

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

pub fn start_http_api(app: AppHandle, state: AppState) {
    thread::spawn(move || {
        let config = state.api_bind_config();
        let addr = format!("{}:{}", config.listen_address, config.port);
        let listener = match TcpListener::bind((config.listen_address.as_str(), config.port)) {
            Ok(listener) => listener,
            Err(error) => {
                state.mark_api_error(format!("Failed to bind {addr}: {error}"));
                return;
            }
        };

        if let Ok(local_addr) = listener.local_addr() {
            state.mark_api_listening(local_addr.ip().to_string(), local_addr.port());
        }

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => handle_stream(stream, &app, &state),
                Err(error) => state.mark_api_error(format!("HTTP API connection failed: {error}")),
            }
        }
    });
}

fn handle_stream(mut stream: TcpStream, app: &AppHandle, state: &AppState) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let request = match read_request(&stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json(
                &mut stream,
                400,
                &serde_json::json!({ "ok": false, "error": error }),
            );
            return;
        }
    };

    if request.method == "OPTIONS" {
        let _ = write_empty(&mut stream, 204);
        return;
    }

    if request.method == "GET" {
        if let Some(id) = request
            .path
            .strip_prefix("/api/pets/")
            .and_then(|path| path.strip_suffix("/spritesheet"))
        {
            let _ = match state.imported_pet_spritesheet_path(id) {
                Some(path) => write_file(&mut stream, &path, "image/webp"),
                None => write_json(
                    &mut stream,
                    404,
                    &serde_json::json!({ "ok": false, "error": "pet spritesheet not found" }),
                ),
            };
            return;
        }
    }

    let result = route_request(request, app, state);
    let _ = match result {
        Ok(value) => write_json(&mut stream, 200, &value),
        Err((status, error)) => write_json(
            &mut stream,
            status,
            &serde_json::json!({ "ok": false, "error": error }),
        ),
    };
}

fn read_request(stream: &TcpStream) -> Result<Request, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|error| error.to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "missing HTTP method".to_string())?
        .to_string();
    let path = parts
        .next()
        .ok_or_else(|| "missing HTTP path".to_string())?
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse::<usize>().unwrap_or(0);
        } else if let Some(value) = trimmed.strip_prefix("content-length:") {
            content_length = value.trim().parse::<usize>().unwrap_or(0);
        }
    }

    let mut body = vec![0_u8; content_length.min(64 * 1024)];
    if !body.is_empty() {
        reader
            .read_exact(&mut body)
            .map_err(|error| error.to_string())?;
    }

    Ok(Request { method, path, body })
}

fn route_request(
    request: Request,
    app: &AppHandle,
    state: &AppState,
) -> Result<serde_json::Value, (u16, String)> {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/status") => serde_json::to_value(state.snapshot())
            .map_err(|error| (500, format!("failed to serialize status: {error}"))),
        ("POST", "/api/action") => {
            let payload = parse_body::<ActionPayload>(&request.body)?;
            if payload.animation_id.trim().is_empty() {
                return Err((400, "animationId is required".to_string()));
            }
            emit_http_action(app, state, payload);
            serde_json::to_value(state.snapshot())
                .map_err(|error| (500, format!("failed to serialize status: {error}")))
        }
        ("POST", "/api/say") => {
            let mut payload = parse_body::<SayPayload>(&request.body)?;
            payload.text = payload.text.trim().chars().take(512).collect();
            emit_http_say(app, state, payload);
            serde_json::to_value(state.snapshot())
                .map_err(|error| (500, format!("failed to serialize status: {error}")))
        }
        ("POST", "/api/event") => {
            let payload = parse_body::<CompanionEventPayload>(&request.body)?;
            emit_companion_event(app, state, payload);
            serde_json::to_value(state.snapshot())
                .map_err(|error| (500, format!("failed to serialize status: {error}")))
        }
        ("POST", "/api/import/local") => {
            let payload = parse_body::<LocalImportPayload>(&request.body)?;
            let snapshot = import_local_pet(app, state, payload).map_err(|error| (400, error))?;
            serde_json::to_value(snapshot)
                .map_err(|error| (500, format!("failed to serialize status: {error}")))
        }
        ("POST", "/api/import/website") => {
            let payload = parse_body::<WebsiteImportPayload>(&request.body)?;
            let snapshot = tauri::async_runtime::block_on(import_website_pet(app, state, payload))
                .map_err(|error| (400, error))?;
            serde_json::to_value(snapshot)
                .map_err(|error| (500, format!("failed to serialize status: {error}")))
        }
        _ => Err((404, "route not found".to_string())),
    }
}

fn parse_body<T>(body: &[u8]) -> Result<T, (u16, String)>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_json::from_slice(body).map_err(|error| (400, format!("invalid JSON: {error}")))
}

fn write_empty(stream: &mut TcpStream, status: u16) -> std::io::Result<()> {
    let headers = format!(
    "HTTP/1.1 {} {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    status,
    reason(status),
  );
    stream.write_all(headers.as_bytes())
}

fn write_json<T>(stream: &mut TcpStream, status: u16, value: &T) -> std::io::Result<()>
where
    T: Serialize,
{
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let headers = format!(
    "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
    status,
    reason(status),
    body.len(),
  );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(&body)
}

fn write_file(
    stream: &mut TcpStream,
    path: &std::path::Path,
    content_type: &str,
) -> std::io::Result<()> {
    let body = fs::read(path)?;
    let headers = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
    body.len(),
  );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(&body)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    }
}
