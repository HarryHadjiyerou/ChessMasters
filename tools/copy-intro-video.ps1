# Copies the intro video from the "INTRO VIDEO" folder (next to PLAY CHESS MASTERS.bat) into
# public/assets/video/ as intro.mp4 or intro.webm. The newest .mp4/.webm there wins. Removing
# every video from the folder removes the intro, but only one this script put there (marker
# file), so a video that came with the project (e.g. cloned from GitHub) is never deleted.
# Exit code 10 = something changed (rebuild).
$proto = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $proto
$drop = Join-Path $root 'INTRO VIDEO'
$dest = Join-Path $proto 'public\assets\video'

if (-not (Test-Path $drop)) {
  New-Item -ItemType Directory -Path $drop | Out-Null
  @"
INTRO VIDEO

Put your intro video in this folder, then start the game with PLAY CHESS MASTERS.bat.
It plays after "Click to start" (with sound) and can be skipped. Settings has an on/off
switch and a Watch button.

- Format: .mp4 (H.264 video + AAC audio, the usual export) or .webm
- Shape: landscape, 16:9 such as 1920x1080 or 1280x720. It is always shown whole, never
  cropped; other shapes get black bars.
- Size: under about 30 MB so it starts quickly (phones on Wi-Fi especially).
- If there are several videos here, the newest one is used.
- Only use music and footage you have the rights to.
"@ | Set-Content -Path (Join-Path $drop 'README.txt') -Encoding UTF8
}

$marker = Join-Path $dest '.from-drop-folder'
$src = Get-ChildItem -Path $drop -File | Where-Object { $_.Extension -in '.mp4', '.webm' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$changed = $false
foreach ($ext in '.mp4', '.webm') {
  $target = Join-Path $dest "intro$ext"
  $wanted = $src -and $src.Extension -eq $ext
  if (-not $wanted) {
    if ((Test-Path $target) -and (Test-Path $marker) -and ($src -or (Get-Content $marker) -eq $ext)) {
      Remove-Item $target -Force; $changed = $true; Write-Host 'Intro video removed.'
    }
    continue
  }
  $same = (Test-Path $target) -and ((Get-FileHash $target).Hash -eq (Get-FileHash $src.FullName).Hash)
  if (-not $same) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item $src.FullName $target -Force
    (Get-Item $target).LastWriteTime = Get-Date # so the launcher sees a change and rebuilds
    $changed = $true
    Write-Host "Intro video: $($src.Name)"
  }
  Set-Content -Path $marker -Value $ext -Encoding ASCII # this video came from the drop folder
}
if (-not $src -and (Test-Path $marker) -and -not (Get-ChildItem $dest -Filter 'intro.*' -ErrorAction SilentlyContinue)) { Remove-Item $marker -Force }
if ($changed) { exit 10 } else { exit 0 }
