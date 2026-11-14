// WebView2 settings that make the window behave like an app rather than a browser, and the GM's pinned certificates.
use crate::bridge::Bridge;
use serde_json::json;
use std::sync::Arc;

// No browser context menu, no Reload/Find/Print/Back keys and no autofill pop-ups, as in the Electron build; WebView2 has
// all of them on by default. The keys still reach the page. WebView2 only tells about the page's full screen (F11 at the
// table), so the window follows it here.
#[cfg(windows)]
pub fn app_window(window: &tauri::WebviewWindow) {
    use webview2_com::ContainsFullScreenElementChangedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Settings3, ICoreWebView2Settings4};
    use windows::core::{Interface, BOOL};
    let target = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
            if let Some(sender) = sender {
                let mut full = BOOL::default();
                sender.ContainsFullScreenElement(&mut full)?;
                let _ = target.set_fullscreen(full.as_bool());
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_ContainsFullScreenElementChanged(&handler, &mut token);
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetAreDefaultContextMenusEnabled(false);
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = settings.SetIsGeneralAutofillEnabled(false);
            let _ = settings.SetIsPasswordAutosaveEnabled(false);
        }
    });
}

#[cfg(not(windows))]
pub fn app_window(_window: &tauri::WebviewWindow) {}

// The GM's server runs on a self-signed certificate that players pin by fingerprint (host/tls.cjs). Electron let the host
// decide through setCertificateVerifyProc; here WebView2 reports the certificate error, the host decides the same way, and
// the window allows the address for the session. The page's own WebSocket (/live) and fetches depend on it.

#[cfg(windows)]
pub fn trust_pinned(window: &tauri::WebviewWindow, bridge: Arc<Bridge>) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2ServerCertificateErrorDetectedEventArgs, ICoreWebView2_14,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW, COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_DEFAULT,
    };
    use webview2_com::{CoTaskMemPWSTR, ServerCertificateErrorDetectedEventHandler};
    use windows::core::{Interface, PWSTR};

    // COM objects of the event stay on the window's thread; they only travel inside this box to come back there.
    struct Pending(ICoreWebView2ServerCertificateErrorDetectedEventArgs, ICoreWebView2Deferral);
    unsafe impl Send for Pending {}
    impl Pending {
        fn finish(self, allow: bool) {
            let action = if allow { COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW } else { COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_DEFAULT };
            unsafe {
                let _ = self.0.SetAction(action);
                let _ = self.1.Complete();
            }
        }
    }

    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_14>() else { return };
        let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut uri = PWSTR::null();
            args.RequestUri(&mut uri)?;
            let uri = CoTaskMemPWSTR::from(uri).to_string();
            let mut pem = PWSTR::null();
            args.ServerCertificate()?.ToPemEncoding(&mut pem)?;
            let pem = CoTaskMemPWSTR::from(pem).to_string();
            let host = tauri::Url::parse(&uri).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_default();
            let pending = Pending(args.clone(), args.GetDeferral()?);
            let (bridge, app, label) = (bridge.clone(), app.clone(), label.clone());
            tauri::async_runtime::spawn(async move {
                let allow = bridge.invoke(&label, "__tls:check".into(), json!([host, pem]), Vec::new()).await.ok().and_then(|(value, _)| value.as_bool()).unwrap_or(false);
                let _ = app.run_on_main_thread(move || pending.finish(allow));
            });
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_ServerCertificateErrorDetected(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn trust_pinned(_window: &tauri::WebviewWindow, _bridge: Arc<Bridge>) {}
