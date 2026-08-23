use std::{
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use serde::Deserialize;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const PROTOCOL_VERSION: u32 = 1;
const DEVELOPMENT_SECRET: &str = "agent-task-hub-desktop-development";

struct ManagedService {
    child: Option<Child>,
    service_url: String,
    secret: String,
}

#[derive(Default)]
struct ServiceProcess(Mutex<Option<ManagedService>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Handshake {
    protocol_version: u32,
    build_revision: String,
    service_pid: u32,
    renderer_session_token: String,
}

fn bootstrap_secret() -> Result<String, String> {
    if cfg!(debug_assertions) {
        return Ok(DEVELOPMENT_SECRET.to_string());
    }
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|error| format!("bootstrap entropy: {error}"))?;
    Ok(hex::encode(bytes))
}

fn expected_build_revision() -> &'static str {
    include_str!("../build-id.txt").trim()
}

fn service_port() -> Result<u16, String> {
    if cfg!(debug_assertions) {
        return Ok(1420);
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("reserve service port: {error}"))?;
    listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string())
}

fn start_service(app: &tauri::AppHandle, secret: &str, port: u16) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let server = resource_dir.join("service").join("server.js");
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    Command::new("node")
        .arg(server)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("ATH_DATA_DIR", data_dir)
        .env("ATH_DESKTOP_BOOTSTRAP_SECRET", secret)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(Some)
        .map_err(|error| format!("start service: {error}"))
}

fn wait_for_service(service_url: &str, secret: &str) -> Result<Handshake, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(response) = client
            .post(format!("{service_url}/api/desktop/handshake"))
            .header("x-ath-bootstrap-secret", secret)
            .send()
        {
            if response.status().is_success() {
                let handshake = response.json::<Handshake>().map_err(|error| error.to_string())?;
                if handshake.protocol_version != PROTOCOL_VERSION {
                    return Err(format!(
                        "service protocol mismatch: host={PROTOCOL_VERSION}, service={}",
                        handshake.protocol_version
                    ));
                }
                if handshake.build_revision != expected_build_revision() {
                    return Err(format!(
                        "service build mismatch: host={}, service={}",
                        expected_build_revision(), handshake.build_revision
                    ));
                }
                if handshake.service_pid == 0
                    || handshake.renderer_session_token.is_empty()
                {
                    return Err("service returned an incomplete handshake".to_string());
                }
                return Ok(handshake);
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("service did not become ready within 30 seconds".to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn stop_managed_service(service: &mut ManagedService) {
    let _ = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .and_then(|client| {
            client
                .post(format!("{}/api/desktop/shutdown", service.service_url))
                .header("x-ath-bootstrap-secret", &service.secret)
                .send()
        });
    if let Some(child) = service.child.as_mut() {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn stop_service(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<ServiceProcess>().0.lock() {
        if let Some(mut service) = guard.take() {
            stop_managed_service(&mut service);
        }
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main_window(app)))
        .manage(ServiceProcess::default())
        .setup(|app| {
            let secret = bootstrap_secret().map_err(std::io::Error::other)?;
            let port = service_port().map_err(std::io::Error::other)?;
            let service_url = format!("http://127.0.0.1:{port}");
            let mut child = start_service(app.handle(), &secret, port).map_err(std::io::Error::other)?;
            let handshake = match wait_for_service(&service_url, &secret) {
                Ok(handshake) => handshake,
                Err(error) => {
                    if let Some(process) = child.as_mut() {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                    return Err(std::io::Error::other(error).into());
                }
            };
            if let Some(process) = child.as_ref() {
                if process.id() != handshake.service_pid {
                    if let Some(process) = child.as_mut() {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                    return Err(std::io::Error::other("service PID does not match spawned process").into());
                }
            }
            let mut managed = ManagedService {
                child,
                service_url: service_url.clone(),
                secret,
            };
            let url = match format!(
                "{service_url}/#ath-desktop-session={}",
                handshake.renderer_session_token
            ).parse::<url::Url>() {
                Ok(url) => url,
                Err(error) => {
                    stop_managed_service(&mut managed);
                    return Err(std::io::Error::other(format!("invalid service url: {error}")).into());
                }
            };
            let window = match WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Agent Task Hub")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 640.0)
                .visible(false)
                .build()
            {
                Ok(window) => window,
                Err(error) => {
                    stop_managed_service(&mut managed);
                    return Err(error.into());
                }
            };
            if let Err(error) = window.show() {
                stop_managed_service(&mut managed);
                return Err(error.into());
            }
            match app.state::<ServiceProcess>().0.lock() {
                Ok(mut guard) => *guard = Some(managed),
                Err(_) => {
                    stop_managed_service(&mut managed);
                    return Err(std::io::Error::other("service lock poisoned").into());
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Agent Task Hub desktop host");

    app.run(|app, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_service(app),
        _ => {}
    });
}
