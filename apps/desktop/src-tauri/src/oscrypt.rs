// The key Electron's safeStorage keeps in «Local State» under DPAPI. Unwrapped here and handed to the host, so passwords and
// tunnel tokens saved by the Electron build stay readable; a fresh data folder gets a new key in the same place and format.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::path::Path;

const DPAPI_PREFIX: &[u8] = b"DPAPI";

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if protect {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut output)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut output)
        }
    };
    if ok == 0 || output.pbData.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as _) };
    Some(bytes)
}

#[cfg(not(windows))]
fn dpapi(_data: &[u8], _protect: bool) -> Option<Vec<u8>> {
    None
}

pub fn load_or_create(data_dir: &Path) -> Option<Vec<u8>> {
    let file = data_dir.join("Local State");
    let mut state: Value = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(|| json!({}));

    if let Some(encoded) = state.pointer("/os_crypt/encrypted_key").and_then(Value::as_str) {
        let wrapped = STANDARD.decode(encoded).ok()?;
        return wrapped.strip_prefix(DPAPI_PREFIX).and_then(|blob| dpapi(blob, false)).filter(|key| key.len() == 32);
    }

    let mut key = vec![0u8; 32];
    getrandom::fill(&mut key).ok()?;
    let blob = dpapi(&key, true)?;
    let wrapped = [DPAPI_PREFIX, blob.as_slice()].concat();
    if !state.is_object() {
        state = json!({});
    }
    state["os_crypt"] = json!({ "encrypted_key": STANDARD.encode(wrapped) });
    std::fs::create_dir_all(data_dir).ok()?;
    std::fs::write(&file, serde_json::to_string(&state).ok()?).ok()?;
    Some(key)
}
