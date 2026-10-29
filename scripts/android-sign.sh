#!/usr/bin/env bash
# Always reuse the pinned release key; never generate a fresh development key during CI.
set -euo pipefail
for signing_name in KEYSTORE_BASE64 KEY_ALIAS KEYSTORE_PASSWORD KEY_PASSWORD; do
  if [ -z "${!signing_name:-}" ]; then echo "Missing fixed Android signing configuration: $signing_name" >&2; exit 1; fi
done
# The dedicated PKCS12 identity was created with a single store/private-key password.
if [ "$KEY_PASSWORD" != "$KEYSTORE_PASSWORD" ]; then echo 'Fixed PKCS12 signing requires matching store and key passwords' >&2; exit 1; fi
umask 077
signing_dir=$(mktemp -d "${RUNNER_TEMP:?}/zhinexus-signing.XXXXXX")
keystore_path="$signing_dir/release.p12"
certificate_path="$signing_dir/release.der"
trap 'rm -rf "$signing_dir"' EXIT
printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$keystore_path"
keytool -exportcert -keystore "$keystore_path" -storepass:env KEYSTORE_PASSWORD -alias "$KEY_ALIAS" > "$certificate_path"
expected_certificate=$(tr -d '[:space:]' < src-tauri/mobile/android/release-certificate.sha256)
actual_certificate=$(sha256sum "$certificate_path" | cut -d ' ' -f 1)
if [ "$actual_certificate" != "$expected_certificate" ]; then echo 'Android signing certificate differs from the pinned release certificate; refusing to rotate the application identity' >&2; exit 1; fi
# A certificate export alone does not unlock the private key. Verify both passwords before expensive builds.
keytool -certreq -keystore "$keystore_path" -storepass:env KEYSTORE_PASSWORD -keypass:env KEY_PASSWORD -alias "$KEY_ALIAS" -file "$signing_dir/check.csr" > /dev/null
if [ "${1:-}" = '--check' ]; then echo "Fixed Android signing certificate validated: $actual_certificate"; exit 0; fi
apk_path=$(find src-tauri/gen/android -name '*-unsigned.apk' -print -quit)
if [ -z "$apk_path" ]; then echo 'No unsigned release APK was built' >&2; exit 1; fi
build_tools="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
mkdir -p release-files
output_path="release-files/ZhiNexus_android_arm64_$(node -p 'require("./package.json").version').apk"
"$build_tools/zipalign" -f 4 "$apk_path" "$RUNNER_TEMP/aligned.apk"
"$build_tools/apksigner" sign --ks "$keystore_path" --ks-key-alias "$KEY_ALIAS" --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD --out "$output_path" "$RUNNER_TEMP/aligned.apk"
"$build_tools/apksigner" verify --verbose --print-certs "$output_path" > "$RUNNER_TEMP/android-certificate-report.txt"
signed_certificate=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$RUNNER_TEMP/android-certificate-report.txt" | tr '[:upper:]' '[:lower:]')
if [ "$signed_certificate" != "$expected_certificate" ]; then echo 'The APK signer differs from the pinned certificate' >&2; exit 1; fi
echo "Verified fixed Android APK certificate: $signed_certificate"
