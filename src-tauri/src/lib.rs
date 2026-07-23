use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::sleep,
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Clone, Default)]
struct BackendState(Arc<Mutex<Option<(String, CommandChild)>>>);

#[tauri::command]
fn backend_url(state: State<'_, BackendState>) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|_| "Backend state unavailable".to_string())?
        .as_ref()
        .map(|(url, _)| url.clone())
        .ok_or_else(|| "Backend is not ready".to_string())
}

fn wait_for_health(url: &str) -> Result<(), String> {
    let port = url
        .strip_prefix("http://127.0.0.1:")
        .ok_or_else(|| "Backend returned invalid URL".to_string())?
        .parse::<u16>()
        .map_err(|_| "Backend returned invalid port".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
            Duration::from_millis(250),
        ) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = stream.write_all(b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
            let mut response = String::new();
            let _ = stream.read_to_string(&mut response);
            if response.starts_with("HTTP/1.1 200 ") || response.starts_with("HTTP/1.0 200 ") {
                return Ok(());
            }
        }
        sleep(Duration::from_millis(100));
    }
    Err("JsonGui backend health check timed out".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = BackendState::default();
    tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let packaged_root = app.path().resource_dir().map_err(|error| error.to_string())?;
            let resource_root = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
            } else {
                [packaged_root.clone(), packaged_root.join("_up_")]
                    .into_iter()
                    .find(|root| root.join("server").join("index.mjs").is_file())
                    .ok_or_else(|| "JsonGui runtime resources are missing".to_string())?
            };
            let data_root = if cfg!(debug_assertions) {
                resource_root.join("data")
            } else {
                app.path().app_data_dir().map_err(|error| error.to_string())?
            };
            std::fs::create_dir_all(&data_root).map_err(|error| error.to_string())?;
            let script = resource_root.join("server").join("index.mjs");
            let command = if cfg!(debug_assertions) {
                app.shell().command("node").arg(script)
            } else {
                app.shell().sidecar("node").map_err(|error| error.to_string())?.arg(script)
            }
            .env("PORT", "0")
            .env("GUI_FORGE_RESOURCE_ROOT", resource_root.to_string_lossy().to_string())
            .env("GUI_FORGE_DATA_ROOT", data_root.to_string_lossy().to_string());
            let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
            let (sender, receiver) = std::sync::mpsc::channel();
            tauri::async_runtime::spawn(async move {
                let mut stdout = String::new();
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            stdout.push_str(&String::from_utf8_lossy(&bytes));
                            if let Some(start) = stdout.find("GUI_FORGE_API_READY=") {
                                let url = stdout[start + "GUI_FORGE_API_READY=".len()..]
                                    .lines()
                                    .next()
                                    .unwrap_or_default()
                                    .trim();
                                if !url.is_empty() {
                                    let _ = sender.send(Ok(url.to_string()));
                                    return;
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            let error = String::from_utf8_lossy(&bytes).trim().to_string();
                            if !error.is_empty() {
                                let _ = sender.send(Err(format!("JsonGui backend error: {error}")));
                                return;
                            }
                        }
                        CommandEvent::Terminated(_) => {
                            let _ = sender.send(Err("JsonGui backend exited before readiness".to_string()));
                            return;
                        }
                        _ => {}
                    }
                }
                let _ = sender.send(Err("JsonGui backend output closed before readiness".to_string()));
            });
            let url = match receiver
                .recv_timeout(Duration::from_secs(60))
                .map_err(|_| "JsonGui backend did not start within 60 seconds".to_string())?
            {
                Ok(url) => url,
                Err(error) => {
                    let _ = child.kill();
                    return Err(error.into());
                }
            };
            if let Err(error) = wait_for_health(&url) {
                let _ = child.kill();
                return Err(error.into());
            }
            *state.0.lock().map_err(|_| "Backend state unavailable".to_string())? = Some((url, child));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_url])
        .build(tauri::generate_context!())
        .expect("error while building JsonGui desktop shell")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut state) = app.state::<BackendState>().0.lock() {
                    if let Some((_, child)) = state.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
