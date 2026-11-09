#[cfg(target_os = "macos")]
pub async fn print(window: tauri::WebviewWindow) -> Result<(), String> {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    use objc2_app_kit::{NSPrintInfo, NSPrintOperation, NSWindow};

    let (sender, receiver) = std::sync::mpsc::channel();
    window
        .with_webview(move |platform| {
            // Tauri runs this callback on the UI thread; both borrowed native
            // handles belong to the live WebView for the callback's duration.
            let result = unsafe {
                let webview = (platform.inner() as *const AnyObject).as_ref();
                let parent = (platform.ns_window() as *const NSWindow).as_ref();
                match (webview, parent) {
                    (Some(webview), Some(parent)) => {
                        let info: Retained<NSPrintInfo> =
                            msg_send![&*NSPrintInfo::sharedPrintInfo(), copy];
                        // WKWebView computes the page count from native margins,
                        // but its PDF renderer applies CSS @page margins. Keep
                        // both at 18 mm so counting and rendering agree.
                        let margin = 18.0 * 72.0 / 25.4;
                        info.setTopMargin(margin);
                        info.setRightMargin(margin);
                        info.setBottomMargin(margin);
                        info.setLeftMargin(margin);
                        let operation: Retained<NSPrintOperation> =
                            msg_send![webview, printOperationWithPrintInfo: &*info];
                        operation.setCanSpawnSeparateThread(true);
                        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                            parent,
                            None,
                            None,
                            std::ptr::null_mut(),
                        );
                        Ok(())
                    }
                    _ => Err("打印窗口尚未就绪，请重试。".into()),
                }
            };
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    // Never wait for the UI callback on the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv().map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn print(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}
