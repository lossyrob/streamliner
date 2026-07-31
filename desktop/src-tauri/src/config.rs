use serde::{Deserialize, Serialize};

const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:4319";
const DEFAULT_DASHBOARD_BASE_URL: &str = "http://127.0.0.1:5173";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub api_base_url: String,
    pub dashboard_base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientConfigResponse {
    dashboard_base_url: Option<String>,
}

pub async fn resolve_config(client: &reqwest::Client) -> DesktopConfig {
    let api_base_url = env_or_default("STREAMLINER_API_BASE_URL", DEFAULT_API_BASE_URL);
    let dashboard_base_url = match std::env::var("STREAMLINER_DASHBOARD_BASE_URL") {
        Ok(value) if !value.trim().is_empty() => value.trim().trim_end_matches('/').to_string(),
        _ => fetch_dashboard_base(client, &api_base_url)
            .await
            .unwrap_or_else(|| DEFAULT_DASHBOARD_BASE_URL.to_string()),
    };

    DesktopConfig {
        api_base_url,
        dashboard_base_url,
    }
}

fn env_or_default(name: &str, default_value: &str) -> String {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_value.to_string())
}

async fn fetch_dashboard_base(client: &reqwest::Client, api_base_url: &str) -> Option<String> {
    let url = format!("{}/api/client-config", api_base_url.trim_end_matches('/'));
    let response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    let config = response.json::<ClientConfigResponse>().await.ok()?;
    config
        .dashboard_base_url
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}
