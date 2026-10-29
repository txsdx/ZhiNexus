//! Anonymous, repository-pinned public Release downloads without GitHub API or updater credentials.
use futures_util::StreamExt;
use reqwest::{header, Client, Response, Url};
use std::time::Duration;

const RELEASE_PATH: &str = "/txsdx/ZhiNexus/releases/download/";
const LATEST_MANIFEST_URL: &str =
    "https://github.com/txsdx/ZhiNexus/releases/latest/download/latest.json";
const JSON_LIMIT: usize = 2 * 1024 * 1024;

/// Accept exactly the public manifest, project release files and their HTTPS CDN redirects.
fn validate_request_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port().is_some_and(|p| p != 443)
    {
        return Err("Untrusted GitHub update destination".into());
    }
    match url.host_str() {
        Some("github.com") if url.as_str() == LATEST_MANIFEST_URL => Ok(()),
        Some("github.com") => asset_path(url.as_str()).map(|_| ()),
        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => Ok(()),
        _ => Err("Untrusted GitHub update destination".into()),
    }
}

/// Public downloads carry no authorization, token or API version header, including on every redirect.
fn request_headers(url: &Url, accept: &str) -> Result<header::HeaderMap, String> {
    validate_request_url(url)?;
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        header::HeaderValue::from_str(accept).map_err(|_| "Invalid update media type")?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache"),
    );
    Ok(headers)
}

/// Decode only this repository's canonical release tag/file segments and reject path traversal or credentials.
fn asset_path(input: &str) -> Result<(String, String), String> {
    let url = Url::parse(input).map_err(|_| "Invalid update asset URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().starts_with(RELEASE_PATH)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Untrusted update asset".into());
    }
    let parts: Vec<_> = url.path()[RELEASE_PATH.len()..].split('/').collect();
    if parts.len() != 2 {
        return Err("Invalid release asset path".into());
    }
    let decode = |value: &str| -> Result<String, String> {
        let text = percent_encoding::percent_decode_str(value)
            .decode_utf8()
            .map_err(|_| "Invalid release asset encoding")?;
        if text.is_empty() || text.contains(['/', '\\', '\0']) || text == "." || text == ".." {
            return Err("Invalid release asset segment".into());
        }
        Ok(text.into_owned())
    };
    Ok((decode(parts[0])?, decode(parts[1])?))
}

/// One native public-download client retains the device proxy, system TLS validation and bounded redirects.
pub struct ReleaseClient {
    client: Client,
}

impl ReleaseClient {
    /// Use no updater credential or GitHub API, so public updates are independent of anonymous API quotas.
    pub fn new(app: &tauri::AppHandle, timeout: Duration) -> Result<Self, String> {
        Ok(Self {
            client: crate::network::client(app, timeout)?
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.without_url().to_string())?,
        })
    }

    /// Revalidate each redirect before sending its anonymous GET; error strings never expose signed CDN query values.
    async fn get(&self, mut url: Url, accept: &str) -> Result<Response, String> {
        for hop in 0..=8 {
            let response = self
                .client
                .get(url.clone())
                .headers(request_headers(&url, accept)?)
                .send()
                .await
                .map_err(|e| e.without_url().to_string())?;
            if response.status().is_redirection() {
                if hop == 8 {
                    return Err("Too many GitHub update redirects".into());
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or("GitHub update redirect missing location")?;
                url = url
                    .join(location)
                    .map_err(|_| "Invalid GitHub update redirect")?;
                continue;
            }
            if !response.status().is_success() {
                return Err(match response.status().as_u16() {
                    401 | 403 => "公开更新文件访问被拒绝 / Public update access denied".into(),
                    404 => "公开Release或文件不存在 / Public release or file unavailable".into(),
                    status => format!("GitHub public download HTTP {status}"),
                });
            }
            return Ok(response);
        }
        Err("Too many GitHub update redirects".into())
    }

    /// Bound the public manifest before decoding it; payload checksum and platform validation remain in the update pipeline.
    pub async fn latest_manifest(&self) -> Result<serde_json::Value, String> {
        let response = self
            .get(Url::parse(LATEST_MANIFEST_URL).unwrap(), "application/json")
            .await?;
        if response.content_length().unwrap_or(0) > JSON_LIMIT as u64 {
            return Err("Update metadata exceeds size limit".into());
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.without_url().to_string())?;
            if bytes.len() + chunk.len() > JSON_LIMIT {
                return Err("Update metadata exceeds size limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "Invalid public update manifest".into())
    }

    /// Download only the exact public project release URL; the caller enforces size, digest and publisher signatures.
    pub async fn download(&self, browser_url: &str) -> Result<Response, String> {
        asset_path(browser_url)?;
        self.get(
            Url::parse(browser_url).map_err(|_| "Invalid update URL")?,
            "application/octet-stream",
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_manifest_and_files_and_cdn_never_have_authentication_headers() {
        for input in [
            LATEST_MANIFEST_URL,
            "https://github.com/txsdx/ZhiNexus/releases/download/v0.22.0/app%20file.exe",
            "https://release-assets.githubusercontent.com/file?sig=fixture",
            "https://objects.githubusercontent.com/file",
        ] {
            let headers =
                request_headers(&Url::parse(input).unwrap(), "application/octet-stream").unwrap();
            assert!(!headers.contains_key(header::AUTHORIZATION));
            assert!(!headers.contains_key("X-GitHub-Api-Version"));
            assert_eq!(headers.len(), 2);
        }
    }
    #[test]
    fn api_and_other_namespaces_and_untrusted_redirects_are_rejected() {
        for input in [
            "https://api.github.com/repos/txsdx/ZhiNexus/releases/latest",
            "http://github.com/txsdx/ZhiNexus/releases/download/v1/app.exe",
            "https://github.com/other/project/releases/latest/download/latest.json",
            "https://github.com/txsdx/ZhiNexus/releases/latest/download/other.json",
            "https://github.com/txsdx/ZhiNexus/login",
            "https://github.com/txsdx/ZhiNexus/releases/latest/download/latest.json?token=bad",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/app.exe?token=bad",
            "https://github.com.attacker.example/txsdx/ZhiNexus/releases/download/v1/app.exe",
            "https://name:password@github.com/txsdx/ZhiNexus/releases/download/v1/app.exe",
            "https://release-assets.githubusercontent.com:444/file",
            "https://attacker.example/file",
        ] {
            assert!(
                request_headers(&Url::parse(input).unwrap(), "application/json").is_err(),
                "{input}"
            );
        }
    }
    #[test]
    fn release_paths_decode_once_and_reject_traversal_and_extra_segments() {
        assert_eq!(
            asset_path(
                "https://github.com/txsdx/ZhiNexus/releases/download/v0.22.0/app%20file.exe"
            )
            .unwrap(),
            ("v0.22.0".into(), "app file.exe".into())
        );
        for input in [
            "https://github.com/other/project/releases/download/v1/app.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/a/b.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/a%2Fb.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/a%5Cb.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/%00.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/%2E%2E",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/",
        ] {
            assert!(asset_path(input).is_err(), "{input}");
        }
    }
}
