//! Persistent per-device proxy configuration for native update downloads and the shared frontend fetch policy.
use std::{fs, io::Write, time::Duration};
use tauri::Manager;
/// Proxy credentials stay in the selected local data root and are never written to replicated plaintext settings.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub mode: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub bypass: String,
}
impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            mode: "system".into(),
            url: String::new(),
            username: String::new(),
            password: String::new(),
            bypass: "localhost,127.0.0.1,::1".into(),
        }
    }
}
impl ProxySettings {
    /// Validate the same explicit modes as the UI, without interpolating credentials into errors.
    pub fn validate(&self) -> Result<(), String> {
        if self.mode == "system" {
            return Ok(());
        }
        let url = reqwest::Url::parse(&self.url).map_err(|_| "Invalid proxy URL")?;
        let schemes: &[&str] = match self.mode.as_str() {
            "http" => &["http", "https"],
            "socks5" => &["socks5", "socks5h"],
            _ => return Err("Invalid proxy mode".into()),
        };
        if !schemes.contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !["", "/"].contains(&url.path())
        {
            return Err("Invalid proxy address; supply credentials separately".into());
        }
        if self.username.len() > 4096 || self.password.len() > 4096 || self.bypass.len() > 8192 {
            return Err("Proxy configuration exceeds limits".into());
        }
        Ok(())
    }
}
/// Persist only an application-owned file; callers cannot choose a filesystem destination.
#[tauri::command]
pub fn configure_network(app: tauri::AppHandle, settings: ProxySettings) -> Result<(), String> {
    settings.validate()?;
    let root = &app.state::<crate::paths::StorageLocation>().root;
    let pending = root.join(format!(".network-{}", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(pending, root.join("network.json")).map_err(|e| e.to_string())
}
/// Apply the configured proxy to native clients, retaining system certificate trust and explicit redirect policies.
pub fn client(app: &tauri::AppHandle, timeout: Duration) -> Result<reqwest::ClientBuilder, String> {
    let path = app
        .state::<crate::paths::StorageLocation>()
        .root
        .join("network.json");
    let settings: ProxySettings = if path.exists() {
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid saved network settings")?
    } else {
        ProxySettings::default()
    };
    settings.validate()?;
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("ZhiNexus/", env!("CARGO_PKG_VERSION")));
    if settings.mode != "system" {
        let mut proxy =
            reqwest::Proxy::all(&settings.url).map_err(|_| "Unable to configure proxy")?;
        if !settings.username.is_empty() || !settings.password.is_empty() {
            proxy = proxy.basic_auth(&settings.username, &settings.password);
        }
        proxy = proxy.no_proxy(reqwest::NoProxy::from_string(&settings.bypass));
        builder = builder.proxy(proxy);
    }
    Ok(builder)
}

/// Exercise the HTTP plugin's URLPattern engine against custom-port provider and DAV URLs.
#[cfg(test)]
mod scope_tests {
    #[test]
    fn user_network_scope_includes_custom_ports_without_other_schemes() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let entries: Vec<urlpattern::UrlPattern> = config["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["identifier"] == "http:default")
            .unwrap()["allow"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                urlpattern::UrlPattern::parse(
                    urlpattern::UrlPatternInit::parse_constructor_string::<regex::Regex>(
                        v["url"].as_str().unwrap(),
                        None,
                    )
                    .unwrap(),
                    Default::default(),
                )
                .unwrap()
            })
            .collect();
        for target in [
            "https://microx.abrdns.com:12010/models",
            "https://microx.abrdns.com:15822/ZhiNexus/",
            "https://api.example.com/v1/models",
            "http://127.0.0.1:43219/models",
        ] {
            let url: reqwest::Url = target.parse().unwrap();
            assert!(
                entries.iter().any(|e| e
                    .test(urlpattern::UrlPatternMatchInput::Url(url.clone()))
                    .unwrap()),
                "{target}"
            );
        }
        for target in ["file:///etc/passwd", "ftp://example.com/file"] {
            let url: reqwest::Url = target.parse().unwrap();
            assert!(!entries.iter().any(|e| e
                .test(urlpattern::UrlPatternMatchInput::Url(url.clone()))
                .unwrap()));
        }
    }
}
