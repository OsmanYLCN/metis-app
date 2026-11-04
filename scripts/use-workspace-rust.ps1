# Dot-source this file: . ./scripts/use-workspace-rust.ps1
$personalOsWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\work\rust'))
if (-not (Test-Path (Join-Path $personalOsWorkspace 'cargo\bin\cargo.exe'))) {
    throw 'Bu sohbetin yerel Rust araçları bulunamadı. Standart Rust MSVC kurulumu kullanın.'
}
$env:CARGO_HOME = Join-Path $personalOsWorkspace 'cargo'
$env:RUSTUP_HOME = Join-Path $personalOsWorkspace 'rustup'
$env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
Write-Host 'Yerel Rust araçları bu terminal oturumu için etkin.'
