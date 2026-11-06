# Writes PLAY LINK.txt in the game's root folder with the local link and build details.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$proto = Split-Path -Parent $PSScriptRoot
$commit = 'unknown'
try { $commit = (& git -C $proto rev-parse --short HEAD 2>$null) } catch {}
if (-not $commit) { $commit = 'unknown' }
$dirty = ''
try { if (& git -C $proto status --porcelain 2>$null) { $dirty = ' (plus uncommitted changes)' } } catch {}
$date = Get-Date -Format 'd MMMM yyyy, HH:mm'
$text = @"
CHESS MASTERS - PLAY LINK

Local link:  http://localhost:4173

This link only works while "PLAY CHESS MASTERS.bat" is running (its black window must stay open).
Double-click the .bat to start the game; it opens this link in your browser for you.

ON A PHONE OR TABLET
1. Connect the phone to the same Wi-Fi as this computer.
2. Double-click "PLAY ON PHONE.bat". Its window shows an address like http://192.168.x.x:4174
3. Type that address into the phone's browser and turn the phone sideways.
The first time, Windows may ask whether Node.js can use the network: allow Private networks.

Build:  $date, commit $commit$dirty
"@
Set-Content -Path (Join-Path $root 'PLAY LINK.txt') -Value $text -Encoding UTF8
