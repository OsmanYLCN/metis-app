param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{0,62}$')][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$DatabaseHost,
    [string]$RootCertificate
)
$ErrorActionPreference = 'Stop'
$DatabaseHost = $DatabaseHost.Trim().ToLowerInvariant()
# Development only. User Secrets is outside Git, but is not encrypted storage.
if ($DatabaseHost -eq "db.$ProjectRef.supabase.co") {
    $databaseUser = 'metis_reader'
} elseif ($DatabaseHost -cmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$') {
    $databaseUser = "metis_reader.$ProjectRef"
} else { throw 'Use the exact Supabase direct or Session pooler host from Connect.' }
if ($RootCertificate) {
    $RootCertificate = (Resolve-Path -LiteralPath $RootCertificate).Path
}
$secret = Read-Host 'metis_reader password (hidden; never send it in chat)' -AsSecureString
if ($secret.Length -eq 0) { $secret.Dispose(); throw 'Password cannot be empty.' }
$pointer = [IntPtr]::Zero
$process = $null
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $settings = @{
        'CentralTasks:Provider' = 'PostgreSql'
        'CentralTasks:Host' = $DatabaseHost
        'CentralTasks:Port' = '5432'
        'CentralTasks:Database' = 'postgres'
        'CentralTasks:Username' = $databaseUser
        'CentralTasks:Password' = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        'CentralTasks:ProjectRef' = $ProjectRef
        'CentralTasks:AllowLocalDevelopment' = 'false'
        'CentralTasks:RootCertificate' = $(if ($RootCertificate) { $RootCertificate } else { '' })
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
    if (-not $process.Start()) { throw 'Could not start local configuration.' }
    # The password is piped over stdin, never placed in command arguments or printed.
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    # .NET Framework / Windows PowerShell 5.1 has no StandardInputEncoding property.
    # Write UTF-8 bytes directly so non-ASCII passwords survive on both PowerShell versions.
    $inputBytes = [System.Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress) + "`n")
    $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
    $process.StandardInput.BaseStream.Flush()
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Local configuration timed out.' }
    if ($process.ExitCode -ne 0) { throw 'Local configuration failed. Check the .NET SDK installation.' }
    Write-Host 'Saved outside the repository for this Windows user. Restart the local API to apply.'
} finally {
    if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    if ($settings) { $settings.Clear() }
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $secret.Dispose()
    if ($process) { $process.Dispose() }
}
