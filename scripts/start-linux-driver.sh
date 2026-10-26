#!/usr/bin/env bash
# Test the executable extracted from the actual DEB with an ordinary system WebKit runtime and an isolated virtual display.
set -euo pipefail
package_path=$(find src-tauri/target/release/bundle/deb -type f -name '*.deb' -print -quit)
test -n "$package_path"
package_root="$RUNNER_TEMP/zhinexus-deb-test"
mkdir -p "$package_root"
dpkg-deb --extract "$package_path" "$package_root"
application_path=$(find "$package_root/usr/bin" -type f -executable -print -quit)
test -n "$application_path"
echo "TAURI_APPLICATION=$application_path" >> "$GITHUB_ENV"
cargo install tauri-driver --locked
nohup xvfb-run -a --server-args='-screen 0 1600x1100x24' dbus-run-session -- tauri-driver --native-driver /usr/bin/WebKitWebDriver --port 4444 > "$RUNNER_TEMP/tauri-driver.log" 2>&1 &
