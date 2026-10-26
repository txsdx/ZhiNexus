# Export exact Windows deliverables from one native build; the standalone executable respects the portable marker rule.
$ErrorActionPreference = 'Stop'
$version = (Get-Content versions.json -Raw | ConvertFrom-Json).platforms.windows
$prefix = "ZhiNexus_windows_x64_$version"
New-Item -ItemType Directory -Force 'release-files' | Out-Null
Copy-Item 'src-tauri/target/release/zhinexus.exe' "release-files/${prefix}_protable.exe"
$installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis' -Filter '*.exe' | Select-Object -First 1
if (!$installer) { throw 'NSIS setup executable is missing' }
Copy-Item $installer.FullName "release-files/${prefix}_setup.exe"
if (Test-Path "$($installer.FullName).sig") { Copy-Item "$($installer.FullName).sig" "release-files/${prefix}_setup.exe.sig" }
node scripts/sign-release-files.mjs release-files
if ($LASTEXITCODE -ne 0) { throw 'Release file signature generation failed' }
