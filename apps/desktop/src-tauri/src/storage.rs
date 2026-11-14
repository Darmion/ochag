// The window settings the Electron build kept in localStorage (language, table layout, the last scene) live in Chromium's
// LevelDB under the file:// origin. On the first start under Tauri they are read from a copy and handed to the new window once.
use rusty_leveldb::{LdbIterator, Options, DB};
use std::path::Path;

const ORIGIN: &[u8] = b"_file://\x00";
const MARKER: &str = "ochag-electron-storage-moved";

// Chromium stores keys and values with a leading byte: 1 — Latin-1, 0 — UTF-16LE.
fn decode(bytes: &[u8]) -> Option<String> {
    let (kind, rest) = bytes.split_first()?;
    match kind {
        1 => Some(rest.iter().map(|&byte| byte as char).collect()),
        0 if rest.len() % 2 == 0 => String::from_utf16(&rest.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect::<Vec<_>>()).ok(),
        _ => None,
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && entry.file_name() != "LOCK" {
            std::fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn read(source: &Path) -> Option<Vec<(String, String)>> {
    let copy = std::env::temp_dir().join(format!("ochag-local-storage-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&copy);
    copy_dir(source, &copy).ok()?;
    let entries = (|| {
        let mut db = DB::open(&copy, Options::default()).ok()?;
        let mut iter = db.new_iter().ok()?;
        let mut entries = Vec::new();
        while let Some((key, value)) = iter.next() {
            if let Some(name) = key.strip_prefix(ORIGIN) {
                if let (Some(name), Some(value)) = (decode(name), decode(&value)) {
                    entries.push((name, value));
                }
            }
        }
        Some(entries)
    })();
    let _ = std::fs::remove_dir_all(&copy);
    entries
}

// A script that puts the old settings into the new window's localStorage, unless it already has them.
pub fn migration_script(data_dir: &Path) -> String {
    let source = data_dir.join("Local Storage").join("leveldb");
    let marker = data_dir.join("WebView2").join(MARKER);
    if marker.exists() || !source.exists() {
        return String::new();
    }
    let Some(entries) = read(&source) else { return String::new() };
    let _ = std::fs::create_dir_all(marker.parent().unwrap_or(data_dir));
    let _ = std::fs::write(&marker, entries.len().to_string());
    if entries.is_empty() {
        return String::new();
    }
    let json = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".into());
    format!(
        "(() => {{ try {{ if (localStorage.getItem('{MARKER}') !== null) return; for (const [key, value] of {json}) if (localStorage.getItem(key) === null) localStorage.setItem(key, value); localStorage.setItem('{MARKER}', '1'); }} catch {{}} }})();\n"
    )
}
