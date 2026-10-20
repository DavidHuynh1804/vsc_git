//! Dev/test-only bridge between an external Playwright (Chromium) driver and the
//! real Tauri backend.
//!
//! The real app window is launched (debug build) and owns a real `AppHandle`,
//! `Window` and session state. Chromium cannot use Tauri IPC directly, so this
//! module exposes a tiny localhost HTTP+SSE server (bound to 127.0.0.1 only):
//!
//! * `POST /invoke` — relays `{cmd, args}` to the *real webview* by evaluating
//!   `window.__TAURI_INTERNALS__.invoke(cmd, args)` inside it, so commands run
//!   with the real `AppHandle`/`Window`/`State`. The result comes back through a
//!   bridge-only event (`e2e-bridge://reply`) emitted by the injected snippet.
//! * `GET /events` — server-sent events stream forwarding every backend event
//!   the app emits (`repo://*`, `job://*`, `git://output`, `prompt://request`, …)
//!   so the Chromium UI updates exactly like the real app.
//! * `GET /ready` — readiness probe that performs a real webview round-trip.
//! * `GET /stub/pick_folder`, `POST /control` — test-controllable stubs for
//!   native-only flows (folder picker) so no native dialog is opened.
//!
//! The module is compiled only in debug builds (`#[cfg(debug_assertions)]` in
//! `lib.rs`) and only starts when the `VSC_GIT_E2E_BRIDGE_PORT` env var is set,
//! so release builds contain no bridge code at all.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager, WebviewWindow, Wry};

const REPLY_EVENT: &str = "e2e-bridge://reply";
const PING_EVENT: &str = "e2e-bridge://ping";
/// How long a single relayed invocation may take before the HTTP caller gets a 504.
const RELAY_TIMEOUT: Duration = Duration::from_secs(30);
/// Retries when the webview has not finished loading yet (first relay after launch).
const RELAY_ATTEMPTS: usize = 4;
const RETRY_DELAY: Duration = Duration::from_millis(500);

/// Shared bridge state. `bridge` is a process-wide singleton created in `start`.
pub struct Bridge {
    app: AppHandle,
    webview: WebviewWindow<Wry>,
    /// SSE subscribers: id -> channel that receives ready-to-write SSE frames.
    clients: Mutex<HashMap<u64, Sender<String>>>,
    /// In-flight relayed invocations: request id -> reply channel.
    pending: Mutex<HashMap<u64, Sender<Result<Value, Value>>>>,
    /// Test-controllable stub returned for the native folder picker.
    pick_folder: Mutex<Option<String>>,
    next_id: AtomicU64,
    next_client_id: AtomicU64,
}

impl Bridge {
    /// Relays a single command into the real webview and waits for its reply.
    fn relay(&self, cmd: &str, args: Value, timeout: Duration) -> Result<Value, Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel::<Result<Value, Value>>();
        self.pending.lock().insert(id, tx);

        let script = build_relay_script(id, cmd, &args);
        if self.webview.eval(script).is_err() {
            self.pending.lock().remove(&id);
            return Err(json!({
                "kind": "Internal",
                "message": "e2e-bridge: failed to evaluate script in the app webview",
            }));
        }

        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.pending.lock().remove(&id);
                Err(json!({
                    "kind": "Internal",
                    "message": format!("e2e-bridge: webview did not reply to '{cmd}' in time"),
                }))
            }
            Err(RecvTimeoutError::Disconnected) => {
                self.pending.lock().remove(&id);
                Err(json!({
                    "kind": "Internal",
                    "message": "e2e-bridge: reply channel closed",
                }))
            }
        }
    }

    /// Relays with a few retries so the very first request can survive a webview
    /// that is still loading. Real command errors are returned immediately —
    /// only bridge-side failures (no reply / eval rejected) are retried.
    fn relay_with_retry(&self, cmd: &str, args: Value, timeout: Duration) -> Result<Value, Value> {
        let mut last_err = json!({
            "kind": "Internal",
            "message": "e2e-bridge: relay never ran",
        });
        for attempt in 0..RELAY_ATTEMPTS {
            match self.relay(cmd, args.clone(), timeout) {
                Ok(value) => return Ok(value),
                Err(err) => {
                    let retryable = err
                        .get("message")
                        .and_then(Value::as_str)
                        .map(|msg| msg.starts_with("e2e-bridge:"))
                        .unwrap_or(false);
                    if !retryable {
                        return Err(err);
                    }
                    last_err = err;
                }
            }
            if attempt + 1 < RELAY_ATTEMPTS {
                std::thread::sleep(RETRY_DELAY);
            }
        }
        Err(last_err)
    }

    fn handle_reply(&self, payload: &str) {
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            eprintln!("[e2e-bridge] malformed reply payload: {payload}");
            return;
        };
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            eprintln!("[e2e-bridge] reply without id: {payload}");
            return;
        };
        let Some(tx) = self.pending.lock().remove(&id) else {
            return;
        };
        let ok = value.get("ok").and_then(Value::as_u64).unwrap_or(0);
        if ok == 1 {
            let result = value.get("result").cloned().unwrap_or(Value::Null);
            let _ = tx.send(Ok(result));
        } else {
            let error = value.get("error").cloned().unwrap_or(Value::Null);
            let _ = tx.send(Err(error));
        }
    }

    /// Forwards a backend event to every connected SSE client.
    fn broadcast(&self, event: &str, payload: &str) {
        let Ok(event_json) = serde_json::to_string(event) else {
            return;
        };
        let frame = format!("data: {{\"event\":{event_json},\"payload\":{payload}}}\n\n");
        let mut clients = self.clients.lock();
        clients.retain(|_, tx| tx.send(frame.clone()).is_ok());
    }
}

/// Starts the bridge if `VSC_GIT_E2E_BRIDGE_PORT` is set. Never fails the app.
pub fn maybe_start(app: &AppHandle) {
    let port = match std::env::var("VSC_GIT_E2E_BRIDGE_PORT") {
        Ok(raw) => match raw.trim().parse::<u16>() {
            Ok(port) => port,
            Err(err) => {
                eprintln!("[e2e-bridge] invalid VSC_GIT_E2E_BRIDGE_PORT '{raw}': {err}");
                return;
            }
        },
        Err(_) => return,
    };

    // `setup` may run before the configured window/webview exists; wait for it so
    // the relay always has a webview to evaluate in.
    let app = app.clone();
    std::thread::Builder::new()
        .name("e2e-bridge-wait".into())
        .spawn(move || {
            for _ in 0..600 {
                if !app.webview_windows().is_empty() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if let Err(err) = start(app, port) {
                eprintln!("[e2e-bridge] failed to start on 127.0.0.1:{port}: {err}");
            }
        })
        .ok();
}

/// Events forwarded to Chromium (mirrors the events exposed in `src/bindings.ts`).
const FORWARDED_EVENTS: &[&str] = &[
    "git://output",
    "job://chunk",
    "job://done",
    "job://progress",
    "prompt://request",
    "repo://operation-changed",
    "repo://refs-changed",
    "repo://status-changed",
];

fn start(app: AppHandle, port: u16) -> std::io::Result<()> {
    let webview = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "no webview available yet")
        })?;

    let bridge = Arc::new(Bridge {
        app,
        webview,
        clients: Mutex::new(HashMap::new()),
        pending: Mutex::new(HashMap::new()),
        pick_folder: Mutex::new(None),
        next_id: AtomicU64::new(1),
        next_client_id: AtomicU64::new(1),
    });

    // Forward backend events (Rust-emitted or webview-emitted) to Chromium, and
    // complete pending relay replies.
    for name in std::iter::once(REPLY_EVENT).chain(FORWARDED_EVENTS.iter().copied()) {
        let bridge = bridge.clone();
        // `tauri::Event` does not expose its name to Rust listeners, so the
        // registered name is captured per closure instead.
        let registered = name.to_string();
        let app = bridge.app.clone();
        app.listen_any(name, move |event| {
            let payload = event.payload().to_string();
            if registered == REPLY_EVENT {
                bridge.handle_reply(&payload);
            } else {
                bridge.broadcast(&registered, &payload);
            }
        });
    }

    let listener = TcpListener::bind(("127.0.0.1", port))?;
    std::thread::Builder::new()
        .name("e2e-bridge-http".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    break;
                };
                let bridge = bridge.clone();
                let _ = std::thread::Builder::new()
                    .name("e2e-bridge-conn".into())
                    .spawn(move || {
                        if let Err(err) = bridge.handle_connection(stream) {
                            let kind = err.kind();
                            if kind != std::io::ErrorKind::BrokenPipe
                                && kind != std::io::ErrorKind::ConnectionReset
                                && kind != std::io::ErrorKind::UnexpectedEof
                            {
                                eprintln!("[e2e-bridge] connection error: {err}");
                            }
                        }
                    });
            }
        })?;

    eprintln!("[e2e-bridge] listening on http://127.0.0.1:{port}");
    Ok(())
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

impl Bridge {
    fn handle_connection(&self, stream: TcpStream) -> std::io::Result<()> {
        stream.set_nodelay(true).ok();
        let request = read_request(&stream)?;
        match (request.method.as_str(), request.path.as_str()) {
            ("OPTIONS", _) => write_cors_preflight(stream),
            ("GET", "/health") => write_json(stream, 200, &json!({ "ok": true })),
            ("GET", "/ready") => self.handle_ready(stream),
            ("POST", "/invoke") => self.handle_invoke(stream, &request.body),
            ("GET", "/events") => self.handle_events(stream),
            ("GET", "/stub/pick_folder") => {
                let path = self.pick_folder.lock().clone();
                write_json(stream, 200, &json!({ "path": path }))
            }
            ("POST", "/control") => self.handle_control(stream, &request.body),
            _ => write_json(
                stream,
                404,
                &json!({ "ok": false, "error": "unknown route" }),
            ),
        }
    }

    fn handle_ready(&self, stream: TcpStream) -> std::io::Result<()> {
        let ping = json!({ "event": PING_EVENT, "payload": {} });
        match self.relay("plugin:event|emit", ping, Duration::from_secs(5)) {
            Ok(value) => write_json(
                stream,
                200,
                &json!({ "ok": true, "ready": true, "ping": value }),
            ),
            Err(error) => write_json(
                stream,
                503,
                &json!({ "ok": false, "ready": false, "error": error }),
            ),
        }
    }

    fn handle_invoke(&self, stream: TcpStream, body: &[u8]) -> std::io::Result<()> {
        let request: Value = match serde_json::from_slice(body) {
            Ok(value) => value,
            Err(err) => {
                return write_json(
                    stream,
                    400,
                    &json!({ "ok": false, "error": { "kind": "Internal", "message": format!("bad request body: {err}") } }),
                )
            }
        };
        let Some(cmd) = request.get("cmd").and_then(Value::as_str) else {
            return write_json(
                stream,
                400,
                &json!({ "ok": false, "error": { "kind": "Internal", "message": "missing cmd" } }),
            );
        };
        let args = request.get("args").cloned().unwrap_or(Value::Null);
        let timeout = request
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .map(Duration::from_millis)
            .unwrap_or(RELAY_TIMEOUT);

        match self.relay_with_retry(cmd, args, timeout) {
            Ok(result) => write_json(stream, 200, &json!({ "ok": true, "result": result })),
            Err(error) => write_json(stream, 200, &json!({ "ok": false, "error": error })),
        }
    }

    fn handle_control(&self, stream: TcpStream, body: &[u8]) -> std::io::Result<()> {
        let request: Value = match serde_json::from_slice(body) {
            Ok(value) => value,
            Err(err) => {
                return write_json(
                    stream,
                    400,
                    &json!({ "ok": false, "error": format!("bad control body: {err}") }),
                )
            }
        };

        if let Some(path) = request.get("pick_folder") {
            let value = match path {
                Value::String(path) => Some(path.clone()),
                _ => None,
            };
            *self.pick_folder.lock() = value;
        }

        write_json(stream, 200, &json!({ "ok": true }))
    }

    fn handle_events(&self, stream: TcpStream) -> std::io::Result<()> {
        let (tx, rx) = channel::<String>();
        let client_id = self.next_client_id.fetch_add(1, Ordering::SeqCst);
        self.clients.lock().insert(client_id, tx);

        let result = write_sse(stream, &rx, client_id);
        self.clients.lock().remove(&client_id);
        result
    }
}

fn write_sse(stream: TcpStream, rx: &Receiver<String>, _client_id: u64) -> std::io::Result<()> {
    let mut stream = stream;
    stream.write_all(
        b"HTTP/1.1 200 OK\r\n\
          Content-Type: text/event-stream\r\n\
          Cache-Control: no-cache\r\n\
          Connection: keep-alive\r\n\
          Access-Control-Allow-Origin: *\r\n\
          \r\n: connected\n\n",
    )?;
    stream.flush()?;

    loop {
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(frame) => {
                stream.write_all(frame.as_bytes())?;
                stream.flush()?;
            }
            Err(RecvTimeoutError::Timeout) => {
                // Keep-alive comment so proxies and Chromium keep the stream open.
                stream.write_all(b": keepalive\n\n")?;
                stream.flush()?;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

fn read_request(stream: &TcpStream) -> std::io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "empty request",
        ));
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    Ok(HttpRequest { method, path, body })
}

fn write_json(mut stream: TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let payload = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let head = format!(
        "HTTP/1.1 {status} {}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\
         \r\n",
        status_text(status),
        payload.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(&payload)?;
    stream.flush()
}

fn write_cors_preflight(mut stream: TcpStream) -> std::io::Result<()> {
    stream.write_all(
        b"HTTP/1.1 204 No Content\r\n\
          Access-Control-Allow-Origin: *\r\n\
          Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
          Access-Control-Allow-Headers: content-type\r\n\
          Access-Control-Max-Age: 600\r\n\
          Content-Length: 0\r\n\
          Connection: close\r\n\
          \r\n",
    )?;
    stream.flush()
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

/// Builds the snippet evaluated inside the real webview. It calls the real
/// `window.__TAURI_INTERNALS__.invoke` (so the command receives the real
/// `AppHandle`/`Window`/state) and posts the outcome back as a bridge event.
fn build_relay_script(id: u64, cmd: &str, args: &Value) -> String {
    let cmd_json = serde_json::to_string(&Value::String(cmd.to_string()))
        .unwrap_or_else(|_| "\"\"".to_string());
    let args_json = serde_json::to_string(args).unwrap_or_else(|_| "null".to_string());
    let reply_json = serde_json::to_string(REPLY_EVENT).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "(function () {{\n\
           var id = {id};\n\
           function safe(v) {{ try {{ return v === undefined ? null : JSON.parse(JSON.stringify(v)); }} catch (e) {{ return String(v); }} }}\n\
           function send(p) {{ try {{ window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{ event: {reply_json}, payload: p }}).catch(function () {{}}); }} catch (e) {{}} }}\n\
           Promise.resolve().then(function () {{\n\
             return window.__TAURI_INTERNALS__.invoke({cmd_json}, {args_json});\n\
           }}).then(function (r) {{\n\
             send({{ id: id, ok: 1, result: safe(r) }});\n\
           }}, function (e) {{\n\
             send({{ id: id, ok: 0, error: safe(e) }});\n\
           }});\n\
         }})();"
    )
}
