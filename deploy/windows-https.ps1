param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$PublicIp,
    [Parameter(Mandatory = $true)][string]$Binary,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [string]$ServiceName = 'ValueInsightEdge'
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$parsedIp=[System.Net.IPAddress]::Parse($PublicIp)
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    [System.Net.IPAddress]::IsLoopback($parsedIp)) { throw 'A public IPv4 address is required' }
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'Choose a dedicated installation directory' }
if (Test-Path -LiteralPath $root) { throw 'Installation directory already exists; inspect before changing it' }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw 'HTTPS service already exists' }
if ((Get-FileHash -LiteralPath $Binary).Hash -ine $ExpectedSha256) { throw 'HTTPS binary checksum mismatch' }
if (Get-NetTCPConnection -State Listen -LocalPort 80,443 -ErrorAction SilentlyContinue) { throw 'HTTPS ports are already occupied' }
$app=Get-CimInstance Win32_Service -Filter "Name='ValueInsight'"
if ($app.State -ne 'Running') { throw 'Application service is not running' }
$nssm=$app.PathName.Trim('"')
if (!(Test-Path -LiteralPath $nssm -PathType Leaf)) { throw 'Existing service manager is unavailable' }
New-Item -ItemType Directory -Path $root,(Join-Path $root 'data'),(Join-Path $root 'logs') | Out-Null
& icacls.exe $root /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-18:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect HTTPS storage' }
$executable=Join-Path $root 'caddy.exe'
Copy-Item -LiteralPath $Binary -Destination $executable
$configuration=Join-Path $root 'Caddyfile'
$forwardRoot=$root.Replace('\','/')
$caddyfile=@"
{
    admin off
    default_sni $PublicIp
    persist_config off
    storage file_system {
        root "$forwardRoot/data"
    }
    log {
        output file "$forwardRoot/logs/caddy.json" {
            roll_size 10MiB
            roll_keep 3
        }
    }
}
https://$PublicIp {
    tls {
        issuer acme https://acme-v02.api.letsencrypt.org/directory {
            profile shortlived
        }
    }
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
"@
[IO.File]::WriteAllText($configuration,$caddyfile,[Text.UTF8Encoding]::new($false))
& $executable validate --config $configuration --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'HTTPS configuration validation failed' }
$created=$false
try {
    & $nssm install $ServiceName $executable
    if ($LASTEXITCODE -ne 0) { throw 'Unable to register HTTPS service' }
    $created=$true
    $parameters=@{
        AppDirectory=$root
        AppParameters='run --config "'+$configuration+'" --adapter caddyfile'
        Start='SERVICE_AUTO_START'
        AppExit='Restart'
        AppRestartDelay='5000'
        AppStdout=(Join-Path $root 'logs\service.stdout.log')
        AppStderr=(Join-Path $root 'logs\service.stderr.log')
        AppRotateFiles='1'
        AppRotateBytes='10485760'
    }
    foreach($name in $parameters.Keys) {
        if ($name -eq 'AppExit') { & $nssm set $ServiceName AppExit Default $parameters[$name] | Out-Null }
        else { & $nssm set $ServiceName $name $parameters[$name] | Out-Null }
        if ($LASTEXITCODE -ne 0) { throw "Unable to configure service option $name" }
    }
    foreach($port in @(80,443)) {
        New-NetFirewallRule -Name "ValueInsightEdge-TCP-$port" -DisplayName "ValueInsight HTTPS TCP $port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any | Out-Null
    }
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
    [pscustomobject]@{service=$ServiceName;status='Running';startup='Automatic';url="https://$PublicIp/dashboard";root=$root;certificateRenewal='Caddy automatic ACME shortlived'} | ConvertTo-Json -Compress
} catch {
    if ($created) { Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue; & $nssm remove $ServiceName confirm | Out-Null }
    throw
}
