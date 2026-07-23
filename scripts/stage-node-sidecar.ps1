param(
  [string]$Version = "22.16.0",
  [string]$Sha256 = "21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd",
  [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"
if (-not $TargetTriple) {
  $TargetTriple = ((rustc -vV | Select-String '^host: ').ToString() -replace '^host: ', '')
}
$target = "$PSScriptRoot\..\src-tauri\binaries\node-$TargetTriple.exe"
$url = "https://nodejs.org/dist/v$Version/node-v$Version-win-x64.zip"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "jsongui-node-$Version.zip"
$unpack = Join-Path ([System.IO.Path]::GetTempPath()) "jsongui-node-$Version"

if ($TargetTriple -notmatch 'windows') { throw "This staging script supports Windows targets only: $TargetTriple" }
Invoke-WebRequest -Uri $url -OutFile $temp
if ($Sha256) {
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { $actual = ([System.BitConverter]::ToString($hash.ComputeHash([System.IO.File]::ReadAllBytes($temp)))).Replace("-", "").ToLowerInvariant() }
  finally { $hash.Dispose() }
  if ($actual -ne $Sha256.ToLowerInvariant()) { throw "Node SHA-256 mismatch: $actual" }
}
New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
Expand-Archive -Path $temp -DestinationPath $unpack -Force
Copy-Item "$unpack\node-v$Version-win-x64\node.exe" $target -Force
