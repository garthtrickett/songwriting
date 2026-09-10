#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use song_agent::runtime::Runtime;
use song_audio::{AudioPlay, AudioView, Engine, OutputDevice};
use song_session::{
    Session,
    protocol::{AgentConfig, AgentView, EditRequest, Failure, STATE_EVENT, Snapshot},
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
#[tauri::command]
async fn desktop_agent_status(
    window: tauri::WebviewWindow,
    agent: tauri::State<'_, Arc<Runtime>>,
) -> Result<AgentView, Failure> {
    check_window(&window)?;
    agent.view().await
}
#[tauri::command]
async fn desktop_agent_configure(
    window: tauri::WebviewWindow,
    agent: tauri::State<'_, Arc<Runtime>>,
    config: AgentConfig,
) -> Result<(), Failure> {
    check_window(&window)?;
    agent.configure(config).await
}
#[tauri::command]
async fn desktop_agent_start(
    window: tauri::WebviewWindow,
    agent: tauri::State<'_, Arc<Runtime>>,
    prompt: String,
) -> Result<(), Failure> {
    check_window(&window)?;
    agent.start(prompt).await
}
#[tauri::command]
async fn desktop_agent_resume(
    window: tauri::WebviewWindow,
    agent: tauri::State<'_, Arc<Runtime>>,
    id: String,
) -> Result<(), Failure> {
    check_window(&window)?;
    agent.resume(id).await
}
#[tauri::command]
async fn desktop_agent_cancel(
    window: tauri::WebviewWindow,
    agent: tauri::State<'_, Arc<Runtime>>,
    id: String,
) -> Result<(), Failure> {
    check_window(&window)?;
    agent.cancel(id).await
}
#[tauri::command]
async fn desktop_audio_status(
    window: tauri::WebviewWindow,
    audio: tauri::State<'_, Arc<Engine>>,
) -> Result<AudioView, Failure> {
    check_window(&window)?;
    audio.view().await.map_err(Failure::from)
}
#[tauri::command]
async fn desktop_audio_devices(
    window: tauri::WebviewWindow,
    audio: tauri::State<'_, Arc<Engine>>,
) -> Result<Vec<OutputDevice>, Failure> {
    check_window(&window)?;
    audio.devices().await.map_err(Failure::from)
}
#[tauri::command]
async fn desktop_audio_play(
    window: tauri::WebviewWindow,
    audio: tauri::State<'_, Arc<Engine>>,
    session: tauri::State<'_, Arc<Session>>,
    request: AudioPlay,
) -> Result<(), Failure> {
    check_window(&window)?;
    song_agent::audio::play(&session, &audio, request).await
}
#[tauri::command]
async fn desktop_audio_stop(
    window: tauri::WebviewWindow,
    audio: tauri::State<'_, Arc<Engine>>,
) -> Result<(), Failure> {
    check_window(&window)?;
    audio.stop().map_err(Failure::from)
}
#[tauri::command]
async fn desktop_media_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session: tauri::State<'_, Arc<Session>>,
) -> Result<song_media::MediaView, Failure> {
    check_window(&window)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| Failure::new("media", e.to_string()))?
        .join("profiles")
        .join(session.profile_id().await?)
        .join("media");
    Ok(song_media::status(&root))
}
#[tauri::command]
async fn desktop_profiles(
    window: tauri::WebviewWindow,
    session: tauri::State<'_, Arc<Session>>,
) -> Result<Vec<song_session::protocol::ProfileView>, Failure> {
    check_window(&window)?;
    session.profiles().await
}
#[tauri::command]
async fn desktop_profile_create(
    window: tauri::WebviewWindow,
    session: tauri::State<'_, Arc<Session>>,
    id: String,
) -> Result<song_session::protocol::ProfileView, Failure> {
    check_window(&window)?;
    session.create_profile(id).await
}
#[tauri::command]
async fn desktop_profile_switch(
    window: tauri::WebviewWindow,
    session: tauri::State<'_, Arc<Session>>,
    audio: tauri::State<'_, Arc<Engine>>,
    agent: tauri::State<'_, Arc<Runtime>>,
    id: String,
) -> Result<song_session::protocol::Snapshot, Failure> {
    check_window(&window)?;
    let snapshot = session.switch_profile(id).await?;
    // Quiesce the old profile's workers after the switch commits; agent
    // reasoning restarts cleanly on the new profile once reconfigured.
    let _ = audio.stop();
    agent.shutdown().await;
    Ok(snapshot)
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
    let audio = app.state::<Arc<Engine>>().inner().clone();
    let agent = app.state::<Arc<Runtime>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = audio.stop();
        agent.shutdown().await;
        let _ = tauri::async_runtime::spawn_blocking(move || audio.close()).await;
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
            let path = app.path().app_data_dir()?.join("profiles");
            let handle = app.handle().clone();
            let session = Session::start(path, move |snapshot| {
                // Persistence succeeded even if a renderer has gone away.
                let _ = handle.emit_to("main", STATE_EVENT, snapshot);
            });
            let audio = Engine::new();
            app.manage(Arc::new(Runtime::with_audio(
                session.clone(),
                audio.clone(),
            )));
            app.manage(audio);
            app.manage(session);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_open,
            desktop_dispatch,
            desktop_agent_status,
            desktop_agent_configure,
            desktop_agent_start,
            desktop_agent_resume,
            desktop_agent_cancel,
            desktop_audio_status,
            desktop_audio_devices,
            desktop_audio_play,
            desktop_audio_stop,
            desktop_media_status,
            desktop_profiles,
            desktop_profile_create,
            desktop_profile_switch
        ])
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
