mod commands;
mod hid_device;
mod udp_server;

use hid_device::HidState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(HidState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(udp_server::run(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_electron_config,
            hid_device::hid_list,
            hid_device::hid_open,
            hid_device::hid_close,
            hid_device::hid_write,
            hid_device::hid_read_feature,
            hid_device::hid_descriptors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
