use serde_json::Value;
use std::{fs, path::PathBuf};

fn electron_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()?.join("Library/Application Support");
    #[cfg(target_os = "windows")]
    let base = dirs::config_dir()?;
    #[cfg(target_os = "linux")]
    let base = dirs::config_dir()?;

    Some(base.join("touchpad-tracker/config.json"))
}

fn extract_config(value: Value) -> Result<Value, String> {
    value
        .as_object()
        .and_then(|object| object.get("config"))
        .filter(|config| config.is_object())
        .cloned()
        .ok_or_else(|| "Electron config must contain an object-valued 'config' key".to_owned())
}

#[tauri::command]
pub fn import_electron_config() -> Result<Option<Value>, String> {
    let Some(path) = electron_config_path() else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let value: Value = serde_json::from_str(&contents)
        .map_err(|error| format!("invalid Electron config {}: {error}", path.display()))?;
    extract_config(value).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_electron_store_config_value() {
        assert_eq!(
            extract_config(json!({ "config": { "i2cAddress": 44 } })).unwrap(),
            json!({ "i2cAddress": 44 })
        );
    }

    #[test]
    fn rejects_missing_or_non_object_config() {
        assert!(extract_config(json!({})).is_err());
        assert!(extract_config(json!({ "config": null })).is_err());
    }
}
