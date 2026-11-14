// The host process (apps/desktop/bridge.cjs on Node) and the messages between it and the windows. A message is a line of
// JSON; bytes in it travel raw right after the line, their lengths in "blobs" (apps/desktop/bridge/protocol.cjs). See
// docs/internal/TAURI.md.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

// A value with {__ochagBlob: n} where bytes were, and those bytes.
pub type Payload = (Value, Vec<Vec<u8>>);
type Reply = Result<Payload, String>;

#[derive(Default)]
pub struct Bridge {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    pub stopping: AtomicBool,
    pub gone: AtomicBool,
}

impl Bridge {
    fn write(&self, message: &Value) -> Result<(), String> {
        self.write_with(message.clone(), &[])
    }

    fn write_with(&self, mut message: Value, blobs: &[Vec<u8>]) -> Result<(), String> {
        if !blobs.is_empty() {
            message["blobs"] = json!(blobs.iter().map(Vec::len).collect::<Vec<_>>());
        }
        let mut guard = self.stdin.lock().map_err(|_| "Хост недоступен.".to_string())?;
        let stdin = guard.as_mut().ok_or_else(|| "Хост не запущен.".to_string())?;
        let mut result = stdin.write_all(format!("{message}\n").as_bytes());
        for blob in blobs {
            result = result.and_then(|_| stdin.write_all(blob));
        }
        result.and_then(|_| stdin.flush()).map_err(|_| "Хост не отвечает.".to_string())
    }

    pub fn event(&self, name: &str, extra: Value) {
        let mut message = json!({ "type": "event", "name": name });
        if let (Some(target), Some(fields)) = (message.as_object_mut(), extra.as_object()) {
            for (key, value) in fields {
                target.insert(key.clone(), value.clone());
            }
        }
        let _ = self.write(&message);
    }

    pub async fn invoke(&self, sender: &str, channel: String, args: Value, blobs: Vec<Vec<u8>>) -> Reply {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().map_err(|_| "Хост недоступен.".to_string())?.insert(id, tx);
        if let Err(error) = self.write_with(json!({ "type": "invoke", "id": id, "channel": channel, "args": args, "sender": sender }), &blobs) {
            self.pending.lock().ok().map(|mut pending| pending.remove(&id));
            return Err(error);
        }
        rx.await.map_err(|_| "Хост закрылся, не ответив.".to_string())?
    }

    fn settle(&self, id: u64, reply: Reply) {
        if let Some(tx) = self.pending.lock().ok().and_then(|mut pending| pending.remove(&id)) {
            let _ = tx.send(reply);
        }
    }
}

pub struct HostLocation {
    pub node: PathBuf,
    pub script: PathBuf,
    pub root: PathBuf,
    pub packaged: bool,
}

// Windows hands out resource paths as «\\?\C:\…»; Node's module loader cannot resolve those, so the prefix goes.
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

// Installed: Node and the app files sit next to the program (resources). From the repository: the system Node.
pub fn host_location(app: &AppHandle) -> HostLocation {
    if let Ok(resources) = app.path().resource_dir().map(plain) {
        let root = resources.join("app");
        if root.join("apps/desktop/bridge.cjs").exists() {
            return HostLocation { node: resources.join("node").join("node.exe"), script: root.join("apps/desktop/bridge.cjs"), root, packaged: true };
        }
    }
    let root = std::path::absolute(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")).unwrap_or_else(|_| PathBuf::from("."));
    let node = std::env::var_os("OCHAG_NODE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("node"));
    HostLocation { node, script: root.join("apps/desktop/bridge.cjs"), root, packaged: false }
}

pub fn start(app: &AppHandle, bridge: Arc<Bridge>, data_dir: &Path, key: Option<Vec<u8>>, init_extra: Value) -> Result<(), String> {
    let location = host_location(app);
    let mut command = Command::new(&location.node);
    command.arg(&location.script).current_dir(&location.root).stdin(Stdio::piped()).stdout(Stdio::piped());
    if cfg!(debug_assertions) {
        command.stderr(Stdio::inherit());
    } else {
        let log = std::fs::create_dir_all(data_dir).ok().and_then(|_| std::fs::File::create(data_dir.join("host.log")).ok());
        command.stderr(log.map(Stdio::from).unwrap_or_else(Stdio::null));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| format!("{}: {error}", location.node.display()))?;
    let stdout = child.stdout.take().ok_or("Нет вывода хоста.")?;
    *bridge.stdin.lock().map_err(|_| "Хост недоступен.")? = child.stdin.take();
    *bridge.child.lock().map_err(|_| "Хост недоступен.")? = Some(child);

    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut init = json!({
        "type": "init",
        "dataDir": data_dir,
        "appRoot": location.root,
        "packaged": location.packaged,
        "version": app.package_info().version.to_string(),
        "osCryptKey": key.map(|bytes| STANDARD.encode(bytes)),
    });
    if let (Some(target), Some(fields)) = (init.as_object_mut(), init_extra.as_object()) {
        for (name, value) in fields {
            target.insert(name.clone(), value.clone());
        }
    }
    bridge.write(&init)?;

    let handle = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(1 << 20, stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            if !matches!(reader.read_until(b'\n', &mut line), Ok(read) if read > 0) {
                break;
            }
            let Ok(mut message) = serde_json::from_slice::<Value>(&line) else { continue };
            let lengths: Vec<usize> = message.get("blobs").and_then(Value::as_array).map(|list| list.iter().filter_map(|n| n.as_u64().map(|n| n as usize)).collect()).unwrap_or_default();
            let mut blobs = Vec::with_capacity(lengths.len());
            let mut broken = false;
            for length in lengths {
                let mut blob = vec![0u8; length];
                if reader.read_exact(&mut blob).is_err() {
                    broken = true;
                    break;
                }
                blobs.push(blob);
            }
            if broken {
                break;
            }
            if let Some(object) = message.as_object_mut() {
                object.remove("blobs");
            }
            handle_message(&handle, &bridge, message, blobs);
        }
        bridge.gone.store(true, Ordering::SeqCst);
        if let Ok(mut pending) = bridge.pending.lock() {
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err("Хост остановлен.".into()));
            }
        }
        if bridge.stopping.load(Ordering::SeqCst) {
            handle.exit(0);
        } else {
            let message = crate::native(&handle, "Служебная часть «Очага» неожиданно остановилась. Перезапустите программу; подробности — в host.log в папке данных.");
            crate::fatal(&handle, &crate::native(&handle, "Очаг"), &message);
        }
    });
    Ok(())
}

// Events go to the page as plain JSON; the rare bytes in them travel as base64 under {__ochagBytes}.
fn inline_blobs(value: &mut Value, blobs: &[Vec<u8>]) {
    use base64::{engine::general_purpose::STANDARD, Engine};
    match value {
        Value::Array(list) => list.iter_mut().for_each(|entry| inline_blobs(entry, blobs)),
        Value::Object(map) => {
            if let (1, Some(index)) = (map.len(), map.get("__ochagBlob").and_then(Value::as_u64)) {
                if let Some(blob) = blobs.get(index as usize) {
                    *value = json!({ "__ochagBytes": STANDARD.encode(blob) });
                }
                return;
            }
            map.values_mut().for_each(|entry| inline_blobs(entry, blobs));
        }
        _ => {}
    }
}

fn handle_message(app: &AppHandle, bridge: &Arc<Bridge>, mut message: Value, blobs: Vec<Vec<u8>>) {
    match message["type"].as_str() {
        Some("result") => {
            let Some(id) = message["id"].as_u64() else { return };
            let reply = if message["ok"].as_bool() == Some(true) {
                Ok((message["value"].take(), blobs))
            } else {
                Err(message["error"].as_str().unwrap_or("Команда не выполнена.").to_string())
            };
            bridge.settle(id, reply);
        }
        Some("send") => {
            let target = message["target"].as_str().unwrap_or("main").to_string();
            let channel = message["channel"].as_str().unwrap_or_default().to_string();
            let mut payload = message["payload"].take();
            inline_blobs(&mut payload, &blobs);
            let _ = app.emit_to(target.as_str(), channel.as_str(), payload);
        }
        Some("call") => {
            let app = app.clone();
            let bridge = bridge.clone();
            std::thread::spawn(move || {
                let method = message["method"].as_str().unwrap_or_default();
                let reply = crate::shell_call(&app, method, &message["params"]);
                if let Some(id) = message["id"].as_str() {
                    let answer = match reply {
                        Ok(value) => json!({ "type": "reply", "id": id, "ok": true, "value": value }),
                        Err(error) => json!({ "type": "reply", "id": id, "ok": false, "error": error }),
                    };
                    let _ = bridge.write(&answer);
                }
            });
        }
        _ => {}
    }
}

// Closing: the host stops the server and Postgres cleanly, then exits; the shell quits when its output ends.
pub fn shutdown(bridge: &Bridge) {
    if bridge.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    bridge.event("shutdown", json!({}));
    let child = bridge.child.lock().ok().and_then(|mut child| child.take());
    if let Some(mut child) = child {
        std::thread::spawn(move || {
            for _ in 0..300 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            let _ = child.kill();
        });
    }
}

// Frames between the page and the shell: a little-endian u32 with the header length, the header (JSON with "blobs"), the bytes.
pub fn read_frame(body: &[u8]) -> Result<Payload, String> {
    let broken = || "Повреждённый запрос окна.".to_string();
    let size = u32::from_le_bytes(body.get(0..4).ok_or_else(broken)?.try_into().map_err(|_| broken())?) as usize;
    let mut header: Value = serde_json::from_slice(body.get(4..4 + size).ok_or_else(broken)?).map_err(|_| broken())?;
    let lengths: Vec<usize> = header.get("blobs").and_then(Value::as_array).map(|list| list.iter().filter_map(|n| n.as_u64().map(|n| n as usize)).collect()).unwrap_or_default();
    let mut offset = 4 + size;
    let mut blobs = Vec::with_capacity(lengths.len());
    for length in lengths {
        blobs.push(body.get(offset..offset + length).ok_or_else(broken)?.to_vec());
        offset += length;
    }
    if let Some(object) = header.as_object_mut() {
        object.remove("blobs");
    }
    Ok((header, blobs))
}

pub fn write_frame(mut header: Value, blobs: &[Vec<u8>]) -> Vec<u8> {
    header["blobs"] = json!(blobs.iter().map(Vec::len).collect::<Vec<_>>());
    let text = header.to_string();
    let mut frame = Vec::with_capacity(4 + text.len() + blobs.iter().map(Vec::len).sum::<usize>());
    frame.extend_from_slice(&(text.len() as u32).to_le_bytes());
    frame.extend_from_slice(text.as_bytes());
    for blob in blobs {
        frame.extend_from_slice(blob);
    }
    frame
}
