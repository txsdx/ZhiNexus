# Match EdgeDriver to the hosted runner's WebView2 Runtime for real native Tauri UI testing.
$ErrorActionPreference = 'Stop'
$runtimeRoot = "${env:ProgramFiles(x86)}/Microsoft/EdgeWebView/Application"
$runtime = Get-ChildItem $runtimeRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$runtime) {
  $bootstrap = "$env:RUNNER_TEMP/WebView2Setup.exe"
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
  Start-Process $bootstrap -ArgumentList '/silent','/install' -Wait
  $runtime = Get-ChildItem $runtimeRoot -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
}
if (!$runtime) { throw 'WebView2 Runtime is unavailable' }
$version = $runtime.Name
$archive = "$env:RUNNER_TEMP/edgedriver.zip"
try { Invoke-WebRequest "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $archive }
catch {
  $major = $version.Split('.')[0]
  $response = (Invoke-WebRequest "https://msedgedriver.microsoft.com/LATEST_RELEASE_${major}_WINDOWS").Content
  if ($response -is [byte[]]) { $response = [Text.Encoding]::Unicode.GetString($response) }
  $version = [regex]::Match(($response -replace "`0",''),'\d+\.\d+\.\d+\.\d+').Value
  if (!$version) { throw 'Unable to resolve a matching official EdgeDriver' }
  Invoke-WebRequest "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $archive
}
$driverRoot = "$env:RUNNER_TEMP/edgedriver"
Expand-Archive -Force $archive $driverRoot
cargo install tauri-driver --locked
if ($LASTEXITCODE -ne 0) { throw 'tauri-driver installation failed' }
"TAURI_NATIVE_DRIVER=$driverRoot/msedgedriver.exe" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV
$app = (Get-ChildItem 'release-files/*_protable.exe' | Select-Object -First 1).FullName
"TAURI_APPLICATION=$app" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV
