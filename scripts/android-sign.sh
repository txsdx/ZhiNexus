#!/usr/bin/env bash
# Produce an installable APK: stable custom key when supplied, otherwise an explicitly labeled development key.
set -euo pipefail
apk_path=$(find src-tauri/gen/android -name '*-unsigned.apk' -print -quit)
if [ -z "$apk_path" ]; then echo 'No unsigned release APK was built' >&2; exit 1; fi
build_tools="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
mkdir -p release-files
keystore_path="$RUNNER_TEMP/zhinexus-signing.jks"
trap 'rm -f "$keystore_path"' EXIT
if [ -n "${KEYSTORE_BASE64:-}" ]; then
  test -n "${KEY_ALIAS:-}" && test -n "${KEYSTORE_PASSWORD:-}" && test -n "${KEY_PASSWORD:-}"
  printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$keystore_path"
  output_path="release-files/ZhiNexus_android_arm64_$(node -p 'require("./package.json").version').apk"
else
  # Development signing makes a preview installable; do not advertise seamless updates across independent CI runs.
  export KEY_ALIAS=zhinexus-development KEYSTORE_PASSWORD=android KEY_PASSWORD=android
  keytool -genkeypair -keystore "$keystore_path" -storepass:env KEYSTORE_PASSWORD -keypass:env KEY_PASSWORD -alias "$KEY_ALIAS" -keyalg RSA -keysize 3072 -validity 3650 -dname 'CN=ZhiNexus Development,O=ZhiNexus,C=CN' >/dev/null 2>&1
  output_path="release-files/ZhiNexus_android_arm64_$(node -p 'require("./package.json").version')_development.apk"
  echo 'No custom Android key configured: publishing an installable development-signed APK. Stable upgrades require a persistent release key.'
fi
"$build_tools/zipalign" -f 4 "$apk_path" "$RUNNER_TEMP/aligned.apk"
"$build_tools/apksigner" sign --ks "$keystore_path" --ks-key-alias "$KEY_ALIAS" --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD --out "$output_path" "$RUNNER_TEMP/aligned.apk"
"$build_tools/apksigner" verify "$output_path"
