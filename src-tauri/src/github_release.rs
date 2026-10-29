//! Repository-pinned public Release reads with optional build-time credentials for private repositories.
use futures_util::StreamExt;
use reqwest::{header, Client, Response, Url};
use serde::Deserialize;
use std::time::Duration;

const REPOSITORY: &str = "/repos/txsdx/ZhiNexus/";
const RELEASE_PATH: &str = "/txsdx/ZhiNexus/releases/download/";
const EMBEDDED_TOKEN: Option<&str> = option_env!("ZHINEXUS_GITHUB_UPDATE_TOKEN");
const JSON_LIMIT: usize = 2 * 1024 * 1024;

/// Minimal GitHub metadata; asset IDs are used to construct pinned API URLs ourselves.
#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

/// Published asset identity, never a URL that can choose where to send the credential.
#[derive(Deserialize)]
struct Asset {
    id: u64,
    name: String,
    size: u64,
    browser_download_url: String,
}

/// Keep every authenticated hop inside the project API; signed CDN URLs receive no credential.
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
        Some("api.github.com") if url.path().starts_with(REPOSITORY) && url.query().is_none() => {
            Ok(())
        }
        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => Ok(()),
        _ => Err("Untrusted GitHub update destination".into()),
    }
}

/// Mark the bearer sensitive and attach it only to the exact project's GitHub API requests.
fn request_headers(
    url: &Url,
    token: Option<&str>,
    accept: &str,
) -> Result<header::HeaderMap, String> {
    validate_request_url(url)?;
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        header::HeaderValue::from_str(accept).map_err(|_| "Invalid update media type")?,
    );
    if url.host_str() == Some("api.github.com") {
        if let Some(token) = token.filter(|value| !value.trim().is_empty()) {
            let mut authorization =
                header::HeaderValue::from_str(&format!("Bearer {}", token.trim()))
                    .map_err(|_| "Invalid embedded updater credential")?;
            authorization.set_sensitive(true);
            headers.insert(header::AUTHORIZATION, authorization);
        }
        headers.insert(
            "X-GitHub-Api-Version",
            header::HeaderValue::from_static("2022-11-28"),
        );
    }
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache"),
    );
    Ok(headers)
}

/// Only a failed API read may retry once with a configured credential; public downloads and CDN redirects remain anonymous.
fn retry_authenticated(url: &Url, status: reqwest::StatusCode, token: Option<&str>) -> bool {
    url.host_str() == Some("api.github.com")
        && matches!(status.as_u16(), 401 | 403 | 404)
        && token.is_some_and(|value| !value.trim().is_empty())
}

/// Read only this repository's canonical browser-download namespace, decoding path segments once.
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

/// Resolve one exact published asset; metadata cannot replace its name or browser-download URL.
fn find_asset<'a>(
    release: &'a Release,
    name: &str,
    expected_url: Option<&str>,
) -> Result<&'a Asset, String> {
    let matches: Vec<_> = release.assets.iter().filter(|a| a.name == name).collect();
    if matches.len() != 1 {
        return Err("Release 缺少或重复安装文件 / Release asset missing or ambiguous".into());
    }
    let asset = matches[0];
    if asset.id == 0
        || asset.size > 512 * 1024 * 1024
        || expected_url.is_some_and(|u| u != asset.browser_download_url)
    {
        return Err("Release asset metadata mismatch".into());
    }
    Ok(asset)
}

/// One native client follows the configured device proxy and retains system TLS validation.
pub struct ReleaseClient {
    client: Client,
}

impl ReleaseClient {
    /// Optional build-time credentials stay native; public Release reads require no credential or device setting.
    pub fn new(app: &tauri::AppHandle, timeout: Duration) -> Result<Self, String> {
        Ok(Self {
            client: crate::network::client(app, timeout)?
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.without_url().to_string())?,
        })
    }

    /// Follow bounded validated redirects, rebuilding headers to prevent bearer forwarding to signed CDNs.
    async fn get(&self, mut url: Url, accept: &str) -> Result<Response, String> {
        for hop in 0..=8 {
            let headers = request_headers(&url, None, accept)?;
            let response = self
                .client
                .get(url.clone())
                .headers(headers)
                .send()
                .await
                .map_err(|e| e.without_url().to_string())?;
            let response = if retry_authenticated(&url, response.status(), EMBEDDED_TOKEN) {
                self.client
                    .get(url.clone())
                    .headers(request_headers(&url, EMBEDDED_TOKEN, accept)?)
                    .send()
                    .await
                    .map_err(|e| e.without_url().to_string())?
            } else {
                response
            };
            if response.status().is_redirection() {
                if hop == 8 {
                    return Err("Too many GitHub update redirects".into());
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or("GitHub update redirect missing location")?;
                url = url
                    .join(location)
                    .map_err(|_| "Invalid GitHub update redirect")?;
                continue;
            }
            if !response.status().is_success() {
                return Err(match response.status().as_u16() {
                    401 => "GitHub 更新凭证已失效 / Updater credential expired".into(),
                    403 => "GitHub 更新访问被拒绝或达到限额 / Update access denied or rate limited".into(),
                    404 => "GitHub Release 或文件不存在，或凭证无权读取 / Release unavailable or credential lacks access".into(),
                    status => format!("GitHub update HTTP {status}"),
                });
            }
            return Ok(response);
        }
        Err("Too many GitHub update redirects".into())
    }

    /// Bound both release metadata and latest.json before deserializing provider data.
    async fn json<T: serde::de::DeserializeOwned>(&self, response: Response) -> Result<T, String> {
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
        serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub update metadata".into())
    }

    /// Resolve the latest Release anonymously when public, or with an optional native credential when private.
    pub async fn latest_manifest(&self) -> Result<serde_json::Value, String> {
        let url =
            Url::parse("https://api.github.com/repos/txsdx/ZhiNexus/releases/latest").unwrap();
        let release: Release = self
            .json(self.get(url, "application/vnd.github+json").await?)
            .await?;
        let asset = find_asset(&release, "latest.json", None)?;
        self.json(self.asset_response(asset.id).await?).await
    }

    /// Resolve an installer's pinned tag/name to its private asset ID before returning a streaming download.
    pub async fn download(&self, browser_url: &str) -> Result<Response, String> {
        let (tag, name) = asset_path(browser_url)?;
        let mut url = Url::parse("https://api.github.com").unwrap();
        url.path_segments_mut()
            .map_err(|_| "Invalid GitHub API base")?
            .extend(["repos", "txsdx", "ZhiNexus", "releases", "tags", &tag]);
        let release: Release = self
            .json(self.get(url, "application/vnd.github+json").await?)
            .await?;
        let asset = find_asset(&release, &name, Some(browser_url))?;
        self.asset_response(asset.id).await
    }

    /// Construct the exact repository asset endpoint rather than trusting a URL returned by metadata.
    async fn asset_response(&self, id: u64) -> Result<Response, String> {
        let url = Url::parse(&format!(
            "https://api.github.com/repos/txsdx/ZhiNexus/releases/assets/{id}"
        ))
        .unwrap();
        self.get(url, "application/octet-stream").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_is_sensitive_and_not_forwarded_to_asset_hosts() {
        let api =
            Url::parse("https://api.github.com/repos/txsdx/ZhiNexus/releases/latest").unwrap();
        let headers =
            request_headers(&api, Some("fixture-github-token"), "application/json").unwrap();
        assert_eq!(
            headers[header::AUTHORIZATION],
            "Bearer fixture-github-token"
        );
        assert!(headers[header::AUTHORIZATION].is_sensitive());
        assert!(!format!("{headers:?}").contains("fixture-github-token"));
        for url in [
            "https://release-assets.githubusercontent.com/file?sig=fixture",
            "https://objects.githubusercontent.com/file",
        ] {
            let headers = request_headers(
                &Url::parse(url).unwrap(),
                Some("fixture-github-token"),
                "application/octet-stream",
            )
            .unwrap();
            assert!(!headers.contains_key(header::AUTHORIZATION));
        }
    }

    #[test]
    fn public_reads_do_not_send_an_embedded_or_expired_credential() {
        let api =
            Url::parse("https://api.github.com/repos/txsdx/ZhiNexus/releases/latest").unwrap();
        let headers = request_headers(&api, None, "application/json").unwrap();
        assert!(!headers.contains_key(header::AUTHORIZATION));
        assert_eq!(headers["X-GitHub-Api-Version"], "2022-11-28");
        assert!(!retry_authenticated(
            &api,
            reqwest::StatusCode::OK,
            Some("expired-fixture")
        ));
        assert!(!retry_authenticated(
            &api,
            reqwest::StatusCode::FOUND,
            Some("expired-fixture")
        ));
    }

    #[test]
    fn private_or_rate_limited_api_reads_retry_only_with_a_configured_credential() {
        let api =
            Url::parse("https://api.github.com/repos/txsdx/ZhiNexus/releases/latest").unwrap();
        for status in [401, 403, 404] {
            let status = reqwest::StatusCode::from_u16(status).unwrap();
            assert!(retry_authenticated(&api, status, Some("fixture")));
            assert!(!retry_authenticated(&api, status, None));
            assert!(!retry_authenticated(&api, status, Some("  ")));
        }
        assert!(!retry_authenticated(
            &api,
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            Some("fixture")
        ));
        let cdn =
            Url::parse("https://release-assets.githubusercontent.com/file?sig=fixture").unwrap();
        assert!(!retry_authenticated(
            &cdn,
            reqwest::StatusCode::FORBIDDEN,
            Some("fixture")
        ));
    }

    #[test]
    fn redirects_cannot_move_authenticated_requests_outside_the_repository() {
        for url in [
            "http://api.github.com/repos/txsdx/ZhiNexus/releases/latest",
            "https://api.github.com/repos/other/project/releases/latest",
            "https://api.github.com/user",
            "https://api.github.com/repos/txsdx/ZhiNexus/releases/latest?token=bad",
            "https://api.github.com.attacker.example/repos/txsdx/ZhiNexus/releases/latest",
            "https://name:password@api.github.com/repos/txsdx/ZhiNexus/releases/latest",
            "https://release-assets.githubusercontent.com:444/file",
            "https://attacker.example/file",
        ] {
            assert!(
                request_headers(
                    &Url::parse(url).unwrap(),
                    Some("fixture"),
                    "application/json"
                )
                .is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn release_paths_decode_names_once_and_reject_traversal_or_other_repositories() {
        assert_eq!(
            asset_path(
                "https://github.com/txsdx/ZhiNexus/releases/download/v0.14.0/app%20setup.exe"
            )
            .unwrap(),
            ("v0.14.0".into(), "app setup.exe".into())
        );
        for url in [
            "https://github.com/other/project/releases/download/v1/app.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/a/b.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/a%2Fb.exe",
            "https://github.com/txsdx/ZhiNexus/releases/download/v1/app.exe?token=bad",
        ] {
            assert!(asset_path(url).is_err());
        }
    }

    #[test]
    fn asset_identity_must_match_and_be_unique() {
        let input = serde_json::json!({"assets":[{"id":7,"name":"app.exe","size":1024,"browser_download_url":"https://github.com/txsdx/ZhiNexus/releases/download/v1/app.exe"}]});
        let mut release: Release = serde_json::from_value(input).unwrap();
        assert_eq!(
            find_asset(
                &release,
                "app.exe",
                Some(&release.assets[0].browser_download_url)
            )
            .unwrap()
            .id,
            7
        );
        assert!(find_asset(&release, "latest.json", None).is_err());
        assert!(find_asset(
            &release,
            "app.exe",
            Some("https://github.com/txsdx/ZhiNexus/releases/download/v2/app.exe")
        )
        .is_err());
        release.assets[0].id = 0;
        assert!(find_asset(&release, "app.exe", None).is_err());
        release.assets.push(Asset {
            id: 8,
            name: "app.exe".into(),
            size: 1,
            browser_download_url: "other".into(),
        });
        assert!(find_asset(&release, "app.exe", None).is_err());
    }
}
