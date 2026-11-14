// «Очаг» on Tauri: the windows, dialogs and links live here; the game's host keeps running on Node behind bridge.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod oscrypt;
mod storage;
mod webview;

use bridge::Bridge;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const PRELOAD: &str = include_str!("../../preload.cjs");
const SHIM: &str = include_str!("desktop-shim.js");

// The only addresses a window may send to the browser; desktop-external-links.test.ts checks the client against it.
const EXTERNAL_LINKS: [&str; 6] = [
    "https://github.com/Darmion/ochag/issues",
    "https://aka.ms/vs/17/release/vc_redist.x64.exe",
    "https://helloiamsinan.itch.io/rpg-essentials-ultimate-fantasy-icons-gui-pack",
    "https://tommusic.itch.io/",
    "https://dnd.wizards.com/resources/systems-reference-document",
    "https://creativecommons.org/licenses/by/4.0/legalcode",
];

struct Settings {
    data_dir: PathBuf,
    browser_args: String,
    storage_script: String,
}

fn data_dir() -> PathBuf {
    for arg in std::env::args() {
        if let Some(value) = arg.strip_prefix("--user-data-dir=") {
            return PathBuf::from(value);
        }
    }
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("ttrpg-foundation")
}

// The page's translations for Windows' own dialogs and its interface language, kept by main/native-texts.cjs.
fn native_texts(data_dir: &Path) -> serde_json::Map<String, Value> {
    std::fs::read_to_string(data_dir.join("native-texts.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

// Read each time: the page may switch the language while the program runs.
pub fn native(app: &AppHandle, text: &str) -> String {
    let texts = native_texts(&app.state::<Settings>().data_dir);
    texts.get(text).and_then(Value::as_str).filter(|value| !value.trim().is_empty()).unwrap_or(text).to_string()
}

// Chromium's own controls (file buttons, form hints) follow the interface language from the next start.
fn native_locale(data_dir: &Path) -> Option<String> {
    let value = native_texts(data_dir).get("__locale")?.as_str()?.to_string();
    let (language, region) = match value.split_once('-') {
        Some((language, region)) => (language, Some(region)),
        None => (value.as_str(), None),
    };
    let valid = (2..=3).contains(&language.len())
        && language.bytes().all(|byte| byte.is_ascii_lowercase())
        && region.is_none_or(|region| (2..=4).contains(&region.len()) && region.bytes().all(|byte| byte.is_ascii_alphabetic()));
    valid.then(|| if value == "en" { "en-US".to_string() } else { value })
}

// Both windows share one WebView2 profile, so they must start with the same arguments.
fn browser_args(data_dir: &Path) -> String {
    let mut args = vec![
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string(),
        "--autoplay-policy=no-user-gesture-required".to_string(),
    ];
    if let Some(locale) = native_locale(data_dir) {
        args.push(format!("--lang={locale}"));
    }
    for arg in std::env::args() {
        if arg.starts_with("--remote-debugging-port=")
            || arg == "--disable-backgrounding-occluded-windows"
            || arg == "--disable-renderer-backgrounding"
            || arg == "--disable-background-timer-throttling"
        {
            args.push(arg);
        }
    }
    args.join(" ")
}

fn window_script(storage: &str, player_view: bool) -> String {
    let query = if player_view { "history.replaceState(null, '', location.pathname + '?view=player');\n" } else { "" };
    format!("{storage}{query}{}", SHIM.replace("/*PRELOAD*/", PRELOAD))
}

fn app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn open_window(app: &AppHandle, label: &str, title: &str, player_view: bool) -> tauri::Result<tauri::WebviewWindow> {
    let settings = app.state::<Settings>();
    let (width, height, min_width, min_height) = if player_view { (1280.0, 800.0, 480.0, 360.0) } else { (1280.0, 900.0, 850.0, 620.0) };
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .background_color(tauri::window::Color(11, 7, 4, 255))
        .initialization_script(window_script(&settings.storage_script, player_view))
        .data_directory(settings.data_dir.join("WebView2"))
        .additional_browser_args(&settings.browser_args)
        // Tauri's own file drop handler takes over OLE drag and drop on Windows; the inventory drags items with HTML5.
        .disable_drag_drop_handler()
        // Electron's windows took the page's title: the player view names whose view it shows.
        .on_document_title_changed(|window, title| {
            if !title.is_empty() && !title.contains("localhost") {
                let _ = window.set_title(&title);
            }
        })
        // Electron granted what the page asks for; the game uses turn alerts, pasting a server address and music.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Notifications
            | tauri::webview::PermissionKind::ClipboardRead
            | tauri::webview::PermissionKind::Autoplay => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .on_navigation(app_url)
        .on_new_window({
            let app = app.clone();
            move |url, _features| {
                if EXTERNAL_LINKS.contains(&url.as_str()) {
                    let _ = app.opener().open_url(url.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            }
        });

    let mut external = None;
    if player_view {
        let primary = app.primary_monitor().ok().flatten().and_then(|monitor| monitor.name().cloned());
        external = app.available_monitors().unwrap_or_default().into_iter().find(|monitor| monitor.name().cloned() != primary);
        if let Some(monitor) = &external {
            let position = monitor.position().to_logical::<f64>(monitor.scale_factor());
            builder = builder.position(position.x + 40.0, position.y + 40.0);
        }
    }
    let window = builder.build()?;
    webview::app_window(&window);
    webview::trust_pinned(&window, app.state::<Arc<Bridge>>().inner().clone());
    if external.is_some() {
        let _ = window.maximize();
    }
    Ok(window)
}

pub fn fatal(app: &AppHandle, title: &str, message: &str) {
    app.dialog().message(message).title(title).kind(MessageDialogKind::Error).blocking_show();
    app.exit(1);
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

// Requests from the host: dialogs, links, windows, quitting. Runs on its own thread, so blocking dialogs are fine.
pub fn shell_call(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "dialog.open" | "dialog.save" => {
            let mut dialog = app.dialog().file();
            if let Some(title) = text(params, "title") {
                dialog = dialog.set_title(title);
            }
            if let Some(filters) = params.get("filters").and_then(Value::as_array) {
                for filter in filters {
                    let extensions: Vec<String> = filter["extensions"].as_array().map(|list| list.iter().filter_map(|entry| entry.as_str().map(str::to_string)).collect()).unwrap_or_default();
                    let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
                    dialog = dialog.add_filter(text(filter, "name").unwrap_or_default(), &refs);
                }
            }
            if let Some(default_path) = text(params, "defaultPath").map(PathBuf::from) {
                if let Some(parent) = default_path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
                    dialog = dialog.set_directory(parent);
                }
                if let Some(name) = default_path.file_name() {
                    dialog = dialog.set_file_name(name.to_string_lossy());
                }
            }
            if method == "dialog.save" {
                let chosen = dialog.blocking_save_file().and_then(|path| path.into_path().ok());
                return Ok(json!({ "canceled": chosen.is_none(), "filePath": chosen }));
            }
            let multiple = params["properties"].as_array().is_some_and(|list| list.iter().any(|entry| entry == "multiSelections"));
            let chosen: Vec<PathBuf> = if multiple {
                dialog.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|path| path.into_path().ok()).collect()
            } else {
                dialog.blocking_pick_file().and_then(|path| path.into_path().ok()).into_iter().collect()
            };
            Ok(json!({ "canceled": chosen.is_empty(), "filePaths": chosen }))
        }
        "shell.openPath" => app.opener().open_path(text(params, "path").unwrap_or_default(), None::<&str>).map(|_| Value::Null).map_err(|error| error.to_string()),
        "shell.reveal" => app.opener().reveal_item_in_dir(text(params, "path").unwrap_or_default()).map(|_| Value::Null).map_err(|error| error.to_string()),
        "window.attention" => {
            if let Some(window) = app.get_webview_window("main") {
                if !window.is_focused().unwrap_or(true) {
                    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }
            }
            Ok(Value::Null)
        }
        "window.openPlayerView" => {
            let title = text(params, "title").unwrap_or_else(|| native(app, "Очаг — вид игроков"));
            let handle = app.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            app.run_on_main_thread(move || {
                let _ = tx.send(open_window(&handle, "player-view", &title, true).map(|_| ()).map_err(|error| error.to_string()));
            })
            .map_err(|error| error.to_string())?;
            rx.recv().map_err(|error| error.to_string())??;
            Ok(Value::Null)
        }
        "window.focus" => {
            if let Some(window) = text(params, "label").and_then(|label| app.get_webview_window(&label)) {
                let _ = window.set_focus();
            }
            Ok(Value::Null)
        }
        "window.close" => {
            if let Some(window) = text(params, "label").and_then(|label| app.get_webview_window(&label)) {
                let _ = window.close();
            }
            Ok(Value::Null)
        }
        "app.quit" => {
            bridge::shutdown(&app.state::<Arc<Bridge>>());
            Ok(Value::Null)
        }
        "host.failed" => {
            fatal(app, &native(app, "Не удалось запустить «Очаг»"), &text(params, "message").unwrap_or_default());
            Ok(Value::Null)
        }
        _ => Ok(Value::Null),
    }
}

// One frame in, one frame out (bridge::read_frame): files pass between the page and the host as bytes, not as text.
// When the webview blocks Tauri's ipc:// requests, Tauri falls back to postMessage and the frame arrives as a JSON
// array of numbers: slower, but the window keeps working.
#[tauri::command]
async fn desktop_invoke(window: tauri::WebviewWindow, bridge: State<'_, Arc<Bridge>>, request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let fallback: Vec<u8>;
    let body: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(body) => body,
        tauri::ipc::InvokeBody::Json(Value::Array(list)) => {
            fallback = list.iter().map(|n| n.as_u64().filter(|n| *n < 256).map(|n| n as u8)).collect::<Option<_>>().ok_or("Неверный запрос окна.")?;
            &fallback
        }
        _ => return Err("Неверный запрос окна.".into()),
    };
    let (header, blobs) = bridge::read_frame(body)?;
    let channel = header["channel"].as_str().unwrap_or_default().to_string();
    let (value, blobs) = bridge.invoke(window.label(), channel, header["args"].clone(), blobs).await?;
    Ok(tauri::ipc::Response::new(bridge::write_frame(json!({ "value": value }), &blobs)))
}

#[tauri::command]
fn set_zoom(window: tauri::WebviewWindow, factor: f64) {
    let _ = window.set_zoom(factor.clamp(0.5, 2.0));
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) {
    if window.label() == "player-view" {
        let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
    }
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) {
    if EXTERNAL_LINKS.contains(&url.as_str()) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

fn displays(app: &AppHandle) -> Value {
    let primary = app.primary_monitor().ok().flatten().and_then(|monitor| monitor.name().cloned());
    let list: Vec<Value> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let area = monitor.position().to_logical::<f64>(monitor.scale_factor());
            let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
            json!({ "primary": monitor.name().cloned() == primary, "workArea": { "x": area.x, "y": area.y, "width": size.width, "height": size.height } })
        })
        .collect();
    json!(list)
}

fn main() {
    let bridge = Arc::new(Bridge::default());
    let mut builder = tauri::Builder::default();
    // One copy per data folder, as Electron's lock was: a separate --user-data-dir (a test profile, a second «player» on the
    // same computer) runs on its own.
    if !std::env::args().any(|arg| arg.starts_with("--user-data-dir=")) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(bridge.clone())
        .manage({
            let data_dir = data_dir();
            Settings { storage_script: storage::migration_script(&data_dir), browser_args: browser_args(&data_dir), data_dir }
        })
        .invoke_handler(tauri::generate_handler![desktop_invoke, set_zoom, toggle_fullscreen, open_external])
        .setup(move |app| {
            let handle = app.handle().clone();
            let settings = handle.state::<Settings>();
            let key = oscrypt::load_or_create(&settings.data_dir);
            let path = handle.path();
            let extra = json!({
                "displays": displays(&handle),
                "documents": path.document_dir().ok(),
                "downloads": path.download_dir().ok(),
                "desktop": path.desktop_dir().ok(),
                "appData": path.data_dir().ok(),
            });
            if let Err(message) = bridge::start(&handle, bridge.clone(), &settings.data_dir, key, extra) {
                fatal(&handle, &native(&handle, "Не удалось запустить «Очаг»"), &message);
                return Ok(());
            }
            open_window(&handle, "main", &native(&handle, "Очаг"), false)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if window.label() == "player-view" {
                    app.state::<Arc<Bridge>>().event("window-closed", json!({ "label": "player-view" }));
                } else if window.label() == "main" {
                    if let Some(player) = app.get_webview_window("player-view") {
                        let _ = player.close();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("«Очаг» не запустился")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let bridge = app.state::<Arc<Bridge>>();
                if !bridge.gone.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    bridge::shutdown(&bridge);
                }
            }
        });
}
