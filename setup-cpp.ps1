# setup-cpp.ps1 — bundles portable g++ into project/tools (no admin, no PATH)
# Usage: powershell -ExecutionPolicy Bypass -File setup-cpp.ps1
$ErrorActionPreference = "Stop"
$tools = Join-Path $PSScriptRoot "tools"
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$zip = Join-Path $env:TEMP "winlibs.zip"
# Try winlibs (zip, ~180MB) — most reliable on Windows
$latest = $null
try {
  $latest = Invoke-RestMethod https://api.github.com/repos/brechtsanders/winlibs_mingw/releases/latest -UseBasicParsing
} catch {}
$asset = $null
if ($latest) {
  $asset = $latest.assets | Where-Object { $_.name -like "winlibs-x86_64-posix-seh-gcc-*.zip" } | Select-Object -First 1
  # fallback to any x86_64 zip
  if (-not $asset) { $asset = $latest.assets | Where-Object { $_.name -like "*x86_64*.zip" } | Select-Object -First 1 }
}
if ($asset) {
  Write-Host "Downloading $($asset.name) (~180MB, one-time)..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
} else {
  # fallback direct URL (known version)
  $url = "https://github.com/brechtsanders/winlibs_mingw/releases/download/14.2.0posix-19.1.7-12.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-14.2.0-mingw-w64ucrt-12.0.0-r2.zip"
  Write-Host "Downloading fallback $url ..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
Write-Host "Extracting to $tools (may take 1-2 mins)..."
Expand-Archive -Path $zip -DestinationPath $tools -Force
# winlibs extracts to mingw64/ folder
$gcc = Get-ChildItem -Path $tools -Recurse -Filter "g++.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($gcc) {
  Write-Host "OK: bundled g++ at $($gcc.FullName)"
  & $gcc.FullName --version | Select-Object -First 1
  Write-Host "Server will auto-detect at tools/mingw64/bin/g++.exe — restart: node server.js -> C++ will now work without system install."
} else {
  Write-Error "Failed to find g++.exe after extract. Check $tools"
  Get-ChildItem $tools -Recurse | Select-Object -First 20 FullName
}
