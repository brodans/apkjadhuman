use std::collections::HashMap;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

const ABSENSI_API_URL: &str = "http://103.109.206.102:8089/Ponorogo-absensApi/index.php";
const ABSENSI_IMG_URL: &str = "http://103.109.206.102:8087";

fn default_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())
}

fn presensi_client(timeout: std::time::Duration) -> Result<reqwest::Client, String> {
    let direct_ip = "103.109.206.102:443"
        .parse::<SocketAddr>()
        .map_err(|e| e.to_string())?;

    reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(true)
        .resolve("presensi.ponorogo.go.id", direct_ip)
        .build()
        .map_err(|e| e.to_string())
}

fn normalize_log_filter(value: &str) -> &str {
    let value = value.trim();
    if value.is_empty() || value == "%25" || value.eq_ignore_ascii_case("null") {
        "null"
    } else {
        value
    }
}

#[derive(Serialize, Deserialize)]
pub struct MultipartFile {
    pub filename: Option<String>,
    pub base64: String,
    pub mime_type: Option<String>,
}

#[tauri::command]
async fn absensi_proxy(endpoint: String, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = default_client()?;
    let clean_endpoint = if endpoint.starts_with('/') { endpoint } else { format!("/{}", endpoint) };
    let target_url = format!("{}{}", ABSENSI_API_URL, clean_endpoint);

    let mut form_params: HashMap<String, String> = HashMap::new();
    if let serde_json::Value::Object(map) = payload {
        for (k, v) in map {
            if !v.is_null() {
                let str_val = match v {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                form_params.insert(k, str_val);
            }
        }
    }

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Dart/3.0 (dart:io)"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/x-www-form-urlencoded"));
    headers.insert("Authorization", HeaderValue::from_static("Bearer null"));

    let res = client
        .post(&target_url)
        .headers(headers)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi server absensi: {}", e))?;

    let text = res
        .text()
        .await
        .map_err(|e| format!("Gagal membaca respons: {}", e))?;

    serde_json::from_str(&text).or_else(|_| {
        Ok(serde_json::json!({
            "raw": text
        }))
    })
}

#[tauri::command]
async fn absensi_multipart(
    endpoint: String,
    fields: serde_json::Value,
    file: Option<MultipartFile>,
) -> Result<serde_json::Value, String> {
    let client = default_client()?;
    let clean_endpoint = if endpoint.starts_with('/') { endpoint } else { format!("/{}", endpoint) };
    let target_url = format!("{}{}", ABSENSI_API_URL, clean_endpoint);

    let mut form = reqwest::multipart::Form::new();

    if let serde_json::Value::Object(map) = fields {
        for (k, v) in map {
            if !v.is_null() {
                let str_val = match v {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                form = form.text(k, str_val);
            }
        }
    }

    if let Some(f) = file {
        if let Ok(bytes) = BASE64.decode(&f.base64) {
            let fname = f.filename.unwrap_or_else(|| "lampiran.jpg".to_string());
            let mime = f.mime_type.unwrap_or_else(|| "image/jpeg".to_string());
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(fname)
                .mime_str(&mime)
                .map_err(|e| e.to_string())?;
            form = form.part("lampiran", part);
        }
    }

    let res = client
        .post(&target_url)
        .header(USER_AGENT, "Dart/3.0 (dart:io)")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Gagal kirim multipart: {}", e))?;

    let text = res
        .text()
        .await
        .map_err(|e| format!("Gagal membaca respons: {}", e))?;

    serde_json::from_str(&text).or_else(|_| {
        Ok(serde_json::json!({
            "raw": text
        }))
    })
}

#[tauri::command]
async fn absensi_log_proxy(
    unor: String,
    start: String,
    end: String,
    nama: String,
    nip: String,
    page: u32,
    size: u32,
) -> Result<serde_json::Value, String> {
    let client = presensi_client(std::time::Duration::from_secs(30))?;
    let unor_val = normalize_log_filter(&unor);
    let nama_val = normalize_log_filter(&nama);
    let nip_val = normalize_log_filter(&nip);
    let page = page.max(1);
    let size = size.clamp(1, 100);
    let mut url = reqwest::Url::parse("https://presensi.ponorogo.go.id/api/absensi-log/unor/")
        .map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "URL log presensi tidak valid".to_string())?
        .extend([unor_val, start.trim(), end.trim(), nama_val, nip_val]);
    url.query_pairs_mut()
        .append_pair("page.page", &page.to_string())
        .append_pair("page.size", &size.to_string())
        .append_pair("page", &page.to_string())
        .append_pair("size", &size.to_string());

    let res = client
        .get(url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Referer", "https://presensi.ponorogo.go.id/")
        .header("Origin", "https://presensi.ponorogo.go.id")
        .header(ACCEPT, "application/json, text/plain, */*")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("Gagal fetch log presensi: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail: String = text.chars().take(300).collect();
        return Err(format!("Server log presensi HTTP {}: {}", status, detail));
    }
    serde_json::from_str(&text).map_err(|_| text)
}

#[tauri::command]
async fn absensi_report_proxy(
    report_type: String,
    idp: String,
    idu: String,
    t1: String,
    t2: String,
    status: String,
    format: String,
) -> Result<String, String> {
    let file_ext = if format == "xls" { "xls" } else { "pdf" };
    let (group, report_name, instansi_report) = match report_type.as_str() {
        "per-pegawai" => ("sby", "per-pegawai", false),
        "per-pegawai-aktivitas" => ("prg", "per-pegawai-aktivitas", false),
        "rekap-instansi" => ("sby", "rekap-instansi", true),
        "skor-per-instansi" => ("sby", "skor-per-instansi2026-new", true),
        "aktivitas-per-instansi" => ("prg", "aktivitas-per-instansi2026-new", true),
        "rekap-tpp-aktivitas" => ("prg", "rekap-tpp-aktivitas2026-new", true),
        _ => return Err(format!("Jenis laporan tidak didukung: {}", report_type)),
    };

    let mut url = reqwest::Url::parse(&format!(
        "https://presensi.ponorogo.go.id/api/report/absensi/{}/{}.{}",
        group, report_name, file_ext
    ))
    .map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        if !idp.is_empty() {
            query.append_pair("idp", &idp);
        }
        if !idu.is_empty() {
            query.append_pair("idu", &idu);
        }
        query
            .append_pair("t1", &t1)
            .append_pair("t2", &t2);
        if instansi_report {
            let default_status = if report_type == "rekap-instansi" { "all" } else { "pns" };
            query.append_pair("status", if status.is_empty() { default_status } else { &status });
        }
        let include_request_context = matches!(report_type.as_str(), "per-pegawai" | "per-pegawai-aktivitas")
            || (file_ext == "pdf" && report_type != "rekap-instansi");
        if include_request_context {
            query
                .append_pair("protocol", "https:")
                .append_pair("host", "presensi.ponorogo.go.id")
                .append_pair("pathname", "/")
                .append_pair("origin", "https://presensi.ponorogo.go.id");
        }
    }

    let client = presensi_client(std::time::Duration::from_secs(60))?;

    let res = client
        .get(url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://presensi.ponorogo.go.id/")
        .header("Origin", "https://presensi.ponorogo.go.id")
        .header(ACCEPT, if file_ext == "xls" {
            "application/vnd.ms-excel, application/octet-stream, */*"
        } else {
            "application/pdf, application/octet-stream, */*"
        })
        .send()
        .await
        .map_err(|e| format!("Gagal unduh report: {}", e))?;

    let response_status = res.status();
    if !response_status.is_success() {
        let body = res.text().await.unwrap_or_default();
        let detail: String = body.chars().take(300).collect();
        return Err(format!(
            "Server report HTTP {}: {}",
            response_status,
            detail
        ));
    }

    let content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if content_type.contains("text/html") {
        let body = String::from_utf8_lossy(&bytes);
        let detail: String = body.chars().take(300).collect();
        return Err(format!("Server report mengirim HTML: {}", detail));
    }
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
async fn absensi_image_proxy(path: String, use_base_url: Option<bool>) -> Result<String, String> {
    let client = default_client()?;
    let clean = if path.starts_with('/') { path } else { format!("/{}", path) };

    let primary_url = if use_base_url == Some(true) {
        format!("https://presensi.ponorogo.go.id{}", clean)
    } else {
        format!("{}{}", ABSENSI_IMG_URL, clean)
    };
    let fallback_url = if use_base_url == Some(true) {
        format!("{}{}", ABSENSI_IMG_URL, clean)
    } else {
        format!("https://presensi.ponorogo.go.id{}", clean)
    };

    let mut res = client
        .get(&primary_url)
        .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36")
        .header(ACCEPT, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .send()
        .await;
    if res.is_err() || (res.as_ref().is_ok() && !res.as_ref().unwrap().status().is_success()) {
        res = client
            .get(&fallback_url)
            .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36")
            .header(ACCEPT, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            .send()
            .await;
    }

    let response = res.map_err(|e| format!("Gagal memuat gambar: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Status HTTP: {}", response.status()));
    }

    let mime = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            absensi_proxy,
            absensi_multipart,
            absensi_log_proxy,
            absensi_report_proxy,
            absensi_image_proxy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jadhuman");
}
