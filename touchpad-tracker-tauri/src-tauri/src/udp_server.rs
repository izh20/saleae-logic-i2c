use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;

#[derive(Deserialize)]
struct IncomingMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: Option<IncomingData>,
}

#[derive(Deserialize)]
struct IncomingData {
    addr: Option<Value>,
    rw: Option<Value>,
    data: Option<Vec<Value>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct I2cRawFrame {
    pub timestamp: u64,
    pub i2c_address: u16,
    pub is_read: bool,
    pub register: Option<u16>,
    pub raw_bytes: Vec<u8>,
    pub source: &'static str,
}

fn parse_number(value: &Value) -> Option<u16> {
    if let Some(number) = value.as_u64() {
        return u16::try_from(number).ok();
    }
    let text = value.as_str()?.trim();
    let (radix, digits) = if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        (16, hex)
    } else {
        (10, text)
    };
    u16::from_str_radix(digits, radix).ok()
}

fn normalize(message: IncomingMessage) -> Option<I2cRawFrame> {
    if message.message_type != "TX" {
        return None;
    }
    let data = message.data?;
    let raw_bytes: Vec<u8> = data
        .data
        .unwrap_or_default()
        .iter()
        .filter_map(parse_number)
        .filter_map(|value| u8::try_from(value).ok())
        .collect();
    let direction = data.rw.and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
    let is_read = matches!(direction.trim().to_ascii_uppercase().as_str(), "R" | "READ");
    let register = (!is_read && raw_bytes.len() == 2)
        .then(|| u16::from_le_bytes([raw_bytes[0], raw_bytes[1]]));

    Some(I2cRawFrame {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        i2c_address: data.addr.as_ref().and_then(parse_number).unwrap_or(0),
        is_read,
        register,
        raw_bytes,
        source: "udp",
    })
}

pub async fn run(app: AppHandle) {
    let socket = match UdpSocket::bind("127.0.0.1:50000").await {
        Ok(socket) => socket,
        Err(error) => {
            eprintln!("failed to bind UDP 127.0.0.1:50000: {error}");
            return;
        }
    };
    let mut buffer = vec![0u8; 65_535];
    loop {
        let (length, _) = match socket.recv_from(&mut buffer).await {
            Ok(value) => value,
            Err(error) => {
                eprintln!("UDP receive error: {error}");
                continue;
            }
        };
        let Ok(message) = serde_json::from_slice::<IncomingMessage>(&buffer[..length]) else {
            continue;
        };
        if let Some(frame) = normalize(message) {
            let _ = app.emit("raw-frame", frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_hex_write_and_register() {
        let message: IncomingMessage = serde_json::from_value(json!({
            "type": "TX",
            "data": { "addr": "0x2c", "rw": "W", "data": ["0x34", "0x12"] }
        })).unwrap();

        let frame = normalize(message).unwrap();
        assert_eq!(frame.i2c_address, 0x2c);
        assert!(!frame.is_read);
        assert_eq!(frame.register, Some(0x1234));
        assert_eq!(frame.raw_bytes, vec![0x34, 0x12]);
    }

    #[test]
    fn normalizes_decimal_read_without_register() {
        let message: IncomingMessage = serde_json::from_value(json!({
            "type": "TX",
            "data": { "addr": 44, "rw": " read ", "data": [1, 2, 3] }
        })).unwrap();

        let frame = normalize(message).unwrap();
        assert!(frame.is_read);
        assert_eq!(frame.register, None);
        assert_eq!(frame.raw_bytes, vec![1, 2, 3]);
    }

    #[test]
    fn ignores_non_tx_messages() {
        let message: IncomingMessage = serde_json::from_value(json!({
            "type": "START",
            "data": { "addr": "0x2c", "rw": "W", "data": [] }
        })).unwrap();

        assert!(normalize(message).is_none());
    }
}
