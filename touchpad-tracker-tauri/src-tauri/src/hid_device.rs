use hidapi::{DeviceInfo, HidApi, HidDevice};
use serde::Serialize;
use std::{ffi::CString, sync::mpsc, thread, time::Duration};
use tauri::{AppHandle, Emitter, State};

use crate::udp_server::I2cRawFrame;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceInfo {
    path: String,
    vendor_id: u16,
    product_id: u16,
    serial_number: String,
    release: u16,
    manufacturer: String,
    product: String,
    interface: i32,
    usage_page: u16,
    usage: u16,
}

impl From<&DeviceInfo> for HidDeviceInfo {
    fn from(info: &DeviceInfo) -> Self {
        Self {
            path: info.path().to_string_lossy().into_owned(),
            vendor_id: info.vendor_id(),
            product_id: info.product_id(),
            serial_number: info.serial_number().unwrap_or_default().to_owned(),
            release: info.release_number(),
            manufacturer: info.manufacturer_string().unwrap_or_default().to_owned(),
            product: info.product_string().unwrap_or_default().to_owned(),
            interface: info.interface_number(),
            usage_page: info.usage_page(),
            usage: info.usage(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidOpenResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hid_desc: Option<Vec<u8>>,
    report_desc: Option<Vec<u8>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidWriteResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    sent_bytes: usize,
}

#[derive(Serialize)]
pub struct HidReadFeatureResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDescriptorsResult {
    hid_desc: Vec<u8>,
    report_desc: Vec<u8>,
}

#[derive(Serialize)]
pub struct HidCloseResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

enum WorkerCommand {
    Write(Vec<u8>, mpsc::Sender<Result<usize, String>>),
    ReadFeature(u8, usize, mpsc::Sender<Result<Vec<u8>, String>>),
    Descriptors(mpsc::Sender<Result<Vec<u8>, String>>),
    Close(mpsc::Sender<()>),
}

pub struct HidState {
    worker: std::sync::Mutex<Option<mpsc::Sender<WorkerCommand>>>,
}

impl Default for HidState {
    fn default() -> Self {
        Self { worker: std::sync::Mutex::new(None) }
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn run_worker(device: HidDevice, receiver: mpsc::Receiver<WorkerCommand>, app: AppHandle) {
    let mut input = vec![0u8; 4096];
    loop {
        while let Ok(command) = receiver.try_recv() {
            match command {
                WorkerCommand::Write(data, reply) => {
                    let result = device.write(&data).map_err(|error| error.to_string());
                    if result.is_ok() {
                        let payload = &data[1..];
                        let length = data.len();
                        let mut raw_bytes = vec![length as u8, (length >> 8) as u8];
                        raw_bytes.extend_from_slice(&data);
                        let _ = app.emit("raw-frame", I2cRawFrame {
                            timestamp: timestamp(), i2c_address: 0, is_read: false,
                            register: (payload.len() >= 2)
                                .then(|| u16::from_le_bytes([payload[0], payload[1]])),
                            raw_bytes, source: "hid",
                        });
                    }
                    let _ = reply.send(result);
                }
                WorkerCommand::ReadFeature(report_id, length, reply) => {
                    let mut data = vec![0u8; length.max(1)];
                    data[0] = report_id;
                    let result = device.get_feature_report(&mut data)
                        .map(|length| { data.truncate(length); data })
                        .map_err(|error| error.to_string());
                    let _ = reply.send(result);
                }
                WorkerCommand::Descriptors(reply) => {
                    let mut data = vec![0u8; 4096];
                    let result = device.get_report_descriptor(&mut data)
                        .map(|length| { data.truncate(length); data })
                        .map_err(|error| error.to_string());
                    let _ = reply.send(result);
                }
                WorkerCommand::Close(reply) => {
                    let _ = reply.send(());
                    return;
                }
            }
        }

        match device.read_timeout(&mut input, 20) {
            Ok(length) if length > 0 => {
                let mut raw_bytes = vec![length as u8, (length >> 8) as u8];
                raw_bytes.extend_from_slice(&input[..length]);
                let _ = app.emit("raw-frame", I2cRawFrame {
                    timestamp: timestamp(), i2c_address: 0, is_read: true,
                    register: None, raw_bytes, source: "hid",
                });
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!("HID read error: {error}");
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn request<T>(state: &HidState, make: impl FnOnce(mpsc::Sender<T>) -> WorkerCommand) -> Result<T, String> {
    let worker = state.worker.lock().map_err(|_| "HID state lock poisoned")?;
    let sender = worker.as_ref().ok_or("HID device is not open")?;
    let (reply_sender, reply_receiver) = mpsc::channel();
    sender.send(make(reply_sender)).map_err(|_| "HID worker stopped")?;
    reply_receiver.recv_timeout(Duration::from_secs(5)).map_err(|_| "HID worker timed out".to_owned())
}

#[tauri::command]
pub fn hid_list() -> Result<Vec<HidDeviceInfo>, String> {
    let api = HidApi::new().map_err(|error| error.to_string())?;
    Ok(api.device_list().map(HidDeviceInfo::from).collect())
}

#[tauri::command]
pub fn hid_open(path: String, app: AppHandle, state: State<'_, HidState>) -> HidOpenResult {
    let Ok(mut worker) = state.worker.lock() else {
        return HidOpenResult { success: false, error: Some("HID state lock poisoned".to_owned()), hid_desc: None, report_desc: None };
    };
    if worker.is_some() {
        return HidOpenResult { success: false, error: Some("a HID device is already open".to_owned()), hid_desc: None, report_desc: None };
    }
    let opened = HidApi::new().map_err(|error| error.to_string()).and_then(|api| {
        let c_path = CString::new(path).map_err(|_| "invalid HID path".to_owned())?;
        api.open_path(&c_path).map_err(|error| error.to_string())
    });
    let Ok(device) = opened else {
        return HidOpenResult { success: false, error: opened.err(), hid_desc: None, report_desc: None };
    };
    let mut descriptor = vec![0u8; 31];
    descriptor[0] = 0;
    let hid_desc = device.get_feature_report(&mut descriptor).ok()
        .filter(|length| *length >= 30)
        .map(|_| descriptor[..30].to_vec());
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || run_worker(device, receiver, app));
    *worker = Some(sender);
    HidOpenResult { success: true, error: None, hid_desc, report_desc: None }
}

#[tauri::command]
pub fn hid_close(state: State<'_, HidState>) -> HidCloseResult {
    let Ok(mut worker) = state.worker.lock() else {
        return HidCloseResult { success: false, error: Some("HID state lock poisoned".to_owned()) };
    };
    let Some(sender) = worker.take() else { return HidCloseResult { success: true, error: None }; };
    let (reply_sender, reply_receiver) = mpsc::channel();
    let result = sender.send(WorkerCommand::Close(reply_sender))
        .map_err(|_| "HID worker stopped".to_owned())
        .and_then(|_| reply_receiver.recv_timeout(Duration::from_secs(5)).map_err(|_| "HID close timed out".to_owned()));
    HidCloseResult { success: result.is_ok(), error: result.err() }
}

#[tauri::command]
pub fn hid_write(report_id: u8, data: Vec<u8>, state: State<'_, HidState>) -> HidWriteResult {
    let mut report = Vec::with_capacity(data.len() + 1);
    report.push(report_id);
    report.extend(data);
    match request(&state, |reply| WorkerCommand::Write(report, reply)).and_then(|result| result) {
        Ok(sent_bytes) => HidWriteResult { success: true, error: None, sent_bytes },
        Err(error) => HidWriteResult { success: false, error: Some(error), sent_bytes: 0 },
    }
}

#[tauri::command]
pub fn hid_read_feature(report_id: u8, state: State<'_, HidState>) -> HidReadFeatureResult {
    match request(&state, |reply| WorkerCommand::ReadFeature(report_id, 256, reply)).and_then(|result| result) {
        Ok(data) => HidReadFeatureResult { data: Some(data), error: None },
        Err(error) => HidReadFeatureResult { data: None, error: Some(error) },
    }
}

#[tauri::command]
pub fn hid_descriptors(state: State<'_, HidState>) -> HidDescriptorsResult {
    let hid_desc = request(&state, |reply| WorkerCommand::ReadFeature(0, 31, reply))
        .and_then(|result| result)
        .map(|data| data.into_iter().take(30).collect())
        .unwrap_or_default();
    let report_desc = request(&state, WorkerCommand::Descriptors)
        .and_then(|result| result)
        .unwrap_or_default();
    HidDescriptorsResult { hid_desc, report_desc }
}
