# Export the sole Windows executable; the portable marker selects data storage independently of its filename.
$ErrorActionPreference = 'Stop'
$version = (Get-Content versions.json -Raw | ConvertFrom-Json).platforms.windows
$prefix = "ZhiNexus_windows_x64_$version"
New-Item -ItemType Directory -Force 'release-files' | Out-Null
Copy-Item 'src-tauri/target/release-windows/zhinexus.exe' "release-files/${prefix}_protable.exe"
node scripts/sign-release-files.mjs release-files
if ($LASTEXITCODE -ne 0) { throw 'Release file signature generation failed' }
New-Item -ItemType Directory -Force 'native-test-results' | Out-Null
$executable = "release-files/${prefix}_protable.exe"
if ($env:GITHUB_ENV) { Add-Content -Path $env:GITHUB_ENV -Value "WINDOWS_SINGLE_EXE=$executable" }
$measurement = @{ profile = 'release-windows'; runtimePacking = $false; sizeBytes = (Get-Item $executable).Length; sha256 = (Get-FileHash $executable -Algorithm SHA256).Hash.ToLowerInvariant() }
$measurement | ConvertTo-Json | Set-Content 'native-test-results/windows-executable.json'
Write-Output "Windows single executable: $($measurement.sizeBytes) bytes (size-optimized compilation, no runtime unpacker)"
