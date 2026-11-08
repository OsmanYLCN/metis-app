param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,62}$')][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$DatabaseHost,
    [Parameter(Mandatory = $true)][string]$RootCertificate
)
$ErrorActionPreference = 'Stop'
$DatabaseHost = $DatabaseHost.Trim().ToLowerInvariant()
if ($DatabaseHost -eq "db.$ProjectRef.supabase.co") {
    $databaseUser = 'metis_writer'
} elseif ($DatabaseHost -cmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$') {
    $databaseUser = "metis_writer.$ProjectRef"
} else { throw 'Use the exact Supabase direct or Session pooler host from Connect.' }
$RootCertificate = (Resolve-Path -LiteralPath $RootCertificate).Path
$secret = Read-Host 'metis_writer password (hidden; never send it in chat)' -AsSecureString
if ($secret.Length -eq 0) { $secret.Dispose(); throw 'Password cannot be empty.' }
$pointer = [IntPtr]::Zero
$process = $null
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $settings = @{
        'CentralTaskWriter:Provider' = 'PostgreSql'
        'CentralTaskWriter:Host' = $DatabaseHost
        'CentralTaskWriter:Port' = '5432'
        'CentralTaskWriter:Database' = 'postgres'
        'CentralTaskWriter:Username' = $databaseUser
        'CentralTaskWriter:Password' = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        'CentralTaskWriter:ProjectRef' = $ProjectRef
        'CentralTaskWriter:AllowLocalDevelopment' = 'false'
        'CentralTaskWriter:RootCertificate' = $RootCertificate
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = 'dotnet'
    $start.Arguments = 'user-secrets set --id metis-local-api'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'Could not start local writer configuration.' }
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    $inputBytes = [System.Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress) + "`n")
    $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
    $process.StandardInput.BaseStream.Flush()
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Local writer configuration timed out.' }
    if ($process.ExitCode -ne 0) { throw 'Local writer configuration failed. Check the .NET SDK installation.' }
    Write-Host 'Writer settings saved outside the repository. Restart the local API to apply.'
} finally {
    if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    if ($settings) { $settings.Clear() }
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $secret.Dispose()
    if ($process) { $process.Dispose() }
}
