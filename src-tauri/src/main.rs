#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use song_session::{
    Session,
    protocol::{EditRequest, Failure, STATE_EVENT, Snapshot},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Shutdown {
    started: AtomicBool,
    finished: AtomicBool,
}

#[tauri::command]
async fn desktop_open(
    window: tauri::WebviewWindow,
    session: tauri::State<'_, Arc<Session>>,
) -> Result<Snapshot, Failure> {
    check_window(&window)?;
    session.read().await
}
#[tauri::command]
async fn desktop_dispatch(
    window: tauri::WebviewWindow,
    session: tauri::State<'_, Arc<Session>>,
    request: EditRequest,
) -> Result<Snapshot, Failure> {
    check_window(&window)?;
    session.dispatch(request).await
}
fn check_window(window: &tauri::WebviewWindow) -> Result<(), Failure> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(Failure::new("scope", "This window has no workspace access"))
    }
}
fn close(app: &tauri::AppHandle) {
    if app.state::<Shutdown>().started.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let session = app.state::<Arc<Session>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || session.close()).await;
        app.state::<Shutdown>()
            .finished
            .store(true, Ordering::Release);
        app.exit(0);
    });
}
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Shutdown::default())
        .setup(|app| {
            let path = app
                .path()
                .app_data_dir()?
                .join("profiles/default/workspace.sqlite");
            let handle = app.handle().clone();
            let session = Session::start(path, move |snapshot| {
                // Persistence succeeded even if a renderer has gone away.
                let _ = handle.emit_to("main", STATE_EVENT, snapshot);
            });
            app.manage(session);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![desktop_open, desktop_dispatch])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                close(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start Songwriter desktop");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && !app.state::<Shutdown>().finished.load(Ordering::Acquire)
        {
            api.prevent_exit();
            close(app);
        }
    });
}
