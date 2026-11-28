param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$ConfigurationFile,
    [ValidatePattern('^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$')][string]$PublicOrigin,
    [string]$ProductionRoot = 'C:\valueinsight',
    [string]$ReleaseRoot = 'C:\valueinsight-releases',
    [string]$ServiceName = 'ValueInsight',
    [switch]$RecoverStoppedService
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProductionRoot = (Resolve-Path -LiteralPath $ProductionRoot).ProviderPath
$release = Join-Path ([IO.Path]::GetFullPath($ReleaseRoot)) $Commit
$registry = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
$old = Get-ItemProperty -LiteralPath $registry
$service = Get-Service -Name $ServiceName
$nssm = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").PathName.Trim('"')
if (!(Test-Path -LiteralPath $nssm -PathType Leaf)) { throw 'NSSM executable is unavailable' }
$wasRunning = $service.Status -eq 'Running'
if (!$wasRunning -and !($RecoverStoppedService -and $service.Status -eq 'Stopped')) {
    throw 'The current service must be running before deployment'
}
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Artifact checksum mismatch' }
if (Test-Path -LiteralPath $release) { throw 'This release directory already exists' }
foreach ($name in @('user.db', 'baseline.db')) {
    if (!(Test-Path -LiteralPath (Join-Path $ProductionRoot "prisma\$name") -PathType Leaf)) { throw 'Production database is missing' }
}
if (!(Test-Path -LiteralPath $ConfigurationFile -PathType Leaf)) { throw 'Private configuration is missing' }

New-Item -ItemType Directory -Path $release -Force | Out-Null
& icacls.exe $release /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-18:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect release directory' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name -match '(^|/)\.env[^/]*$|\.(db|sqlite|sqlite3)(-|$)' -or
            $name -match '(^|/)\.\.(/|$)|^/|:') { throw 'Unsafe artifact entry' }
    }
} finally { $zip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($Archive, $release)
foreach ($name in @('server.js', 'runtime\node.exe', 'release.json',
        'src\generated\prisma\query_engine-windows.dll.node')) {
    if (!(Test-Path -LiteralPath (Join-Path $release $name) -PathType Leaf)) { throw 'Incomplete release artifact' }
}
$metadata = Get-Content -LiteralPath (Join-Path $release 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($metadata.buildDirectory -notmatch '^\.next(?:[-_][A-Za-z0-9]+)*$') { throw 'Invalid build directory' }
$buildId = (Get-Content -LiteralPath (Join-Path $release ($metadata.buildDirectory + '\BUILD_ID')) -Raw).Trim()
if ($metadata.commit -ne $Commit -or $metadata.buildId -ne $buildId) { throw 'Release metadata mismatch' }
$node = Join-Path $release 'runtime\node.exe'
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'Portable runtime failed' }

# Keep provider credentials in a protected server-side file. SQLite paths stay absolute.
$configuration = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ConfigurationFile).ProviderPath)
$productionDatabases = @{
    DATABASE_URL = 'file:' + $ProductionRoot.Replace('\', '/') + '/prisma/user.db'
    BASELINE_DATABASE_URL = 'file:' + $ProductionRoot.Replace('\', '/') + '/prisma/baseline.db?mode=ro'
}
foreach ($name in $productionDatabases.Keys) {
    $expected = '(?m)^\s*' + $name + '\s*=\s*["'']?' + [regex]::Escape($productionDatabases[$name]) + '["'']?\s*$'
    if (![regex]::IsMatch($configuration, $expected)) { throw 'Configuration must explicitly reference the production databases' }
}
$allowedOrigins = @('http://127.0.0.1:3103')
if ($PublicOrigin) { $allowedOrigins += $PublicOrigin }
$settings = @{
    DATABASE_URL = 'file:' + $ProductionRoot.Replace('\', '/') + '/prisma/user.db'
    BASELINE_DATABASE_URL = 'file:' + $ProductionRoot.Replace('\', '/') + '/prisma/baseline.db?mode=ro'
    PORT = '3000'
    HOSTNAME = '127.0.0.1'
    CORS_ORIGIN = $allowedOrigins -join ','
    RELEASE_COMMIT = $Commit
}
foreach ($name in $settings.Keys) {
    $pattern = '(?m)^\s*' + [regex]::Escape($name) + '=.*$'
    $line = $name + '="' + $settings[$name] + '"'
    if ([regex]::IsMatch($configuration, $pattern)) {
        $configuration = [regex]::Replace($configuration, $pattern, $line)
    } else { $configuration += "`r`n$line`r`n" }
}
$envFile = Join-Path $release '.env.local'
[IO.File]::WriteAllText($envFile, $configuration, [Text.UTF8Encoding]::new($false))
& icacls.exe $envFile /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect private configuration' }

$state = Join-Path $release 'deployment-state'
New-Item -ItemType Directory -Path $state | Out-Null
$registryBackup = Join-Path $state 'service-parameters.reg'
& reg.exe export "HKLM\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters" $registryBackup /y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to back up service parameters' }
[pscustomobject]@{ application = $old.Application; directory = $old.AppDirectory; parameters = $old.AppParameters } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'previous-service.json') -Encoding UTF8

$snapshot = @'
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
(async () => {
  const [source, destination] = process.argv.slice(2);
  const summary = {};
  const files = [];
  const readCounts = (db, tables) => Object.fromEntries(tables.map(table =>
    [table, db.prepare('SELECT COUNT(*) count FROM "' + table + '"').get().count]));
  for (const name of ['user', 'baseline']) {
    const db = new DatabaseSync(path.join(source, 'prisma', name + '.db'), { readOnly: true });
    const filename = name + '.db';
    const output = path.join(destination, filename);
    try {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Database integrity failed');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
      summary[name] = readCounts(db, ['Company', 'Assumption', 'ValuationReport'].filter(table => tables.includes(table)));
      await backup(db, output);
    } finally {
      db.close();
    }
    const copy = new DatabaseSync(output, { readOnly: true });
    try {
      const copyCounts = readCounts(copy, Object.keys(summary[name]));
      if (copy.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
          JSON.stringify(copyCounts) !== JSON.stringify(summary[name])) throw Error('Backup integrity failed');
    } finally {
      copy.close();
    }
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(output)) hash.update(chunk);
    const bytes = fs.statSync(output).size;
    if (!bytes) throw Error('Backup is empty');
    files.push({ filename, bytes, sha256: hash.digest('hex') });
  }
  fs.writeFileSync(path.join(destination, 'database-counts.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(destination, 'backup-manifest.json'),
    JSON.stringify({ verifiedAt: new Date().toISOString(), files }, null, 2));
})().catch(() => { console.error('DATABASE_BACKUP_FAILED'); process.exitCode = 1; });
'@
$health = @'
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const env = parseEnv(fs.readFileSync('.env.local', 'utf8'));
const expected = JSON.parse(fs.readFileSync('deployment-state/database-counts.json', 'utf8'));
const baseUrl = 'http://127.0.0.1:3000';
const healthEmail = (env.HEALTHCHECK_EMAIL ?? '').trim();
const healthPassword = env.HEALTHCHECK_PASSWORD ?? '';
let headers = {};
let authenticated = false;
let accountRole = null;
let companies = null;
let newsCount = null;
let newsSources = [];
let checkedValuation = false;
(async () => {
  try {
    if (Boolean(healthEmail) !== Boolean(healthPassword)) throw Error('Health check credentials are incomplete');
    if (healthEmail) {
      let login;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          login = await fetch(baseUrl + '/api/auth/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: healthEmail, password: healthPassword }),
            signal: AbortSignal.timeout(2000),
          });
          if (login.ok) break;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const cookie = login?.headers.get('set-cookie')?.split(';')[0];
      const account = login?.ok ? await login.json() : null;
      if (!login?.ok || !cookie?.startsWith('vi_session=') || !account?.user?.id) throw Error('Session login failed');
      headers = { cookie };
      authenticated = true;
      accountRole = account.user.role;
    }
    let response;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        response = await fetch(baseUrl + '/api/companies', { headers, signal: AbortSignal.timeout(2000) });
        if (authenticated ? response.ok : response.status === 401) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (authenticated) {
      if (!response?.ok) throw Error('Authenticated API failed');
      companies = (await response.json()).companies;
      if (!Array.isArray(companies) || (accountRole === 'admin' && companies.length !== expected.user.Company))
        throw Error('Database count mismatch');
      const anonymous = await fetch(baseUrl + '/api/companies');
      if (anonymous.status !== 401) throw Error('Authentication failed');
      const quoteApi = baseUrl + '/api/market-quotes?tickers=';
      const privateQuotes = await fetch(quoteApi + '603786.SH', { signal: AbortSignal.timeout(5000) });
      const invalidQuotes = await fetch(quoteApi + '%21', { headers, signal: AbortSignal.timeout(5000) });
      if (privateQuotes.status !== 401 || invalidQuotes.status !== 422) throw Error('Market quotes access check failed');
      const routes = ['/dashboard', '/agent', '/announcements', '/valuation/new', '/valuation/board', '/settings'];
      const company = companies[0];
      if (company) {
        const report = '/company/' + encodeURIComponent(company.ticker);
        routes.push(report, report + '/sensitivity', report + '/ai-attribution', report + '/notes');
      }
      for (const route of routes) {
        const page = await fetch(baseUrl + route, { headers, signal: AbortSignal.timeout(10000) });
        if (!page.ok) throw Error('Page check failed');
        await page.arrayBuffer();
      }
      const news = await fetch(baseUrl + '/api/market-news', { headers, signal: AbortSignal.timeout(10000) });
      if (!news.ok) throw Error('Market news feed failed');
      const feed = await news.json();
      const sources = new Set(feed.items?.map(item => item.source));
      if (feed.stale || !Array.isArray(feed.items) || feed.items.length <= 13 ||
          !sources.has('eastmoney') || !sources.has('sina') ||
          feed.items.some(item => !item.title || !item.url?.startsWith('https://')))
        throw Error('Market news feed is incomplete');
      newsCount = feed.items.length;
      newsSources = [...sources];
      const invalidCheck = await fetch(baseUrl + '/api/settings/data-check?ticker=%40%21', { headers, signal: AbortSignal.timeout(5000) });
      if (invalidCheck.status !== 422) throw Error('Settings input validation failed');
      const industries = await fetch(baseUrl + '/api/settings/industry-multiples', { headers, signal: AbortSignal.timeout(10000) });
      if (!industries.ok || ((await industries.json()).groups?.length ?? 0) < 8)
        throw Error('Industry directory unavailable');
      const checkTicker = companies.some(company => company.ticker === '603786.SH') ? '603786.SH' : null;
      if (checkTicker) {
        const latest = await fetch(quoteApi + checkTicker, { headers, signal: AbortSignal.timeout(13000) });
        if (!latest.ok || !latest.headers.get('cache-control')?.includes('no-store')) throw Error('Market quote request failed');
        const quote = (await latest.json()).quotes?.[checkTicker];
        if (!quote || !(quote.price > 0) || !quote.date || !['ifind', 'eastmoney'].includes(quote.source))
          throw Error('Verified market quote unavailable');
        const checked = await fetch(baseUrl + '/api/settings/data-check?ticker=' + checkTicker, { headers, signal: AbortSignal.timeout(55000) });
        if (!checked.ok) throw Error('Valuation diagnostics failed');
        const value = await checked.json();
        if (!value.quote?.date || !value.finance?.cashFlowVerified ||
            !value.valuation?.result?.priceMatches || !value.valuation?.result?.reconciliation?.passed)
          throw Error('Published DCF or data verification failed');
        checkedValuation = true;
        const companyId = companies.find(company => company.ticker === checkTicker).id;
        const companyApi = baseUrl + '/api/companies/' + encodeURIComponent(companyId);
        const prices = await fetch(companyApi + '/prices?range=24m', { headers, signal: AbortSignal.timeout(20000) });
        if (!prices.ok || !(await prices.json()).prices?.some(bar =>
          bar.open > 0 && bar.high >= Math.max(bar.open, bar.close) && bar.low > 0 && bar.low <= Math.min(bar.open, bar.close)))
          throw Error('OHLC history unavailable');
        const simulated = await fetch(companyApi + '/simulation', { headers, signal: AbortSignal.timeout(10000) });
        if (!simulated.ok) throw Error('Simulation endpoint failed');
        const { revision, simulation } = await simulated.json();
        if (revision !== value.valuation.publication.revision ||
            (simulation && ('workbook' in simulation || !simulation.coherent ||
              simulation.coherent.samples + simulation.rejected !== simulation.config.samples ||
              simulation.coherent.p5 > simulation.coherent.median || simulation.coherent.median > simulation.coherent.p95)))
          throw Error('Published simulation failed validation');
        const heatmap = await fetch(companyApi + '/sensitivity', { headers, signal: AbortSignal.timeout(10000) });
        if (!heatmap.ok) throw Error('Sensitivity endpoint failed');
        const { sensitivity } = await heatmap.json();
        if (sensitivity?.kind !== 'operating' || 'workbookMatrix' in sensitivity || sensitivity.rateLabel !== 'WACC' ||
            sensitivity.base.price !== value.valuation.publication.price ||
            !sensitivity.matrix?.some(cell =>
              cell.wacc === sensitivity.base.wacc && cell.g === sensitivity.base.g &&
              cell.targetPrice !== null && Math.abs(cell.targetPrice - sensitivity.base.price) < 1e-8))
          throw Error('Sensitivity baseline failed reconciliation');
        const attribution = await fetch(baseUrl + '/api/validation/attribution?companyId=' + encodeURIComponent(companyId), { headers, signal: AbortSignal.timeout(10000) });
        if (!attribution.ok) throw Error('Attribution evidence endpoint failed');
        const { evidence } = await attribution.json();
        if (evidence?.primary?.kind !== 'operating' || evidence.primary.price !== value.valuation.publication.price ||
            evidence.reconciliation !== 'passed' || !evidence.model?.sensitivity?.length ||
            !['aligned', 'reference', 'unavailable'].includes(evidence.comparison?.mode) ||
            (evidence.comparison.mode !== 'aligned' && evidence.comparison.differencePct !== null))
          throw Error('Attribution evidence did not match the verified publication');
      }
    } else {
      if (response?.status !== 401) throw Error('Authentication failed');
      const signIn = await fetch(baseUrl + '/sign-in', { signal: AbortSignal.timeout(5000) });
      if (!signIn.ok) throw Error('Sign-in page failed');
      await signIn.arrayBuffer();
    }
    const dashboard = await fetch(baseUrl + '/dashboard', { redirect: 'manual' });
    const loginDestination = new URL(dashboard.headers.get('location') ?? '/', baseUrl);
    if (![303, 307, 308].includes(dashboard.status) || loginDestination.pathname !== '/sign-in' ||
        loginDestination.searchParams.get('next') !== '/dashboard') throw Error('Login redirect failed');
    console.log(JSON.stringify({ authenticatedApi: authenticated, accountRole, anonymousStatus: 401,
      companyCount: authenticated ? companies.length : null, pages: true, newsCount, newsSources, checkedValuation }));
  } finally {
    if (headers.cookie) {
      try {
        await fetch(baseUrl + '/api/auth/signout', { method: 'POST', headers, signal: AbortSignal.timeout(2000) });
      } catch {}
    }
  }
})().catch(() => { console.error('RELEASE_HEALTH_FAILED'); process.exitCode = 1; });
'@
[IO.File]::WriteAllText((Join-Path $state 'snapshot.cjs'), $snapshot, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $release 'release-health.cjs'), $health, [Text.UTF8Encoding]::new($false))

if ($wasRunning) { Stop-Service -Name $ServiceName }
(Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
try {
    & $node (Join-Path $state 'snapshot.cjs') $ProductionRoot $state
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
    $backupManifest = Join-Path $state 'backup-manifest.json'
    $backup = Get-Content -LiteralPath $backupManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($backup.files.Count -ne 2 -or !$backup.verifiedAt) { throw 'Database backup manifest is incomplete' }
    foreach ($name in @('user.db', 'baseline.db')) {
        $entry = @($backup.files | Where-Object { $_.filename -eq $name })
        $backupFile = Join-Path $state $name
        if ($entry.Count -ne 1 -or $entry[0].bytes -le 0 -or
            $entry[0].sha256 -notmatch '^[a-f0-9]{64}$' -or
            (Get-Item -LiteralPath $backupFile).Length -ne [int64]$entry[0].bytes -or
            (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry[0].sha256) {
            throw 'Database backup verification failed'
        }
    }
    $nssmSettings = @{
        Application = $node
        AppDirectory = $release
        AppParameters = '--max-old-space-size=192 "' + (Join-Path $release 'server.js') + '"'
        AppStdout = Join-Path $release 'service.stdout.log'
        AppStderr = Join-Path $release 'service.stderr.log'
    }
    foreach ($name in $nssmSettings.Keys) {
        & $nssm set $ServiceName $name $nssmSettings[$name] | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'NSSM configuration failed' }
    }
    & $nssm set $ServiceName AppEnvironmentExtra 'NODE_ENV=production' 'PORT=3000' 'HOSTNAME=127.0.0.1' 'NEXT_TELEMETRY_DISABLED=1' "PRISMA_QUERY_ENGINE_LIBRARY=$release\src\generated\prisma\query_engine-windows.dll.node" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'NSSM environment failed' }
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    Push-Location -LiteralPath $release
    try { & $node (Join-Path $release 'release-health.cjs'); $healthy = $LASTEXITCODE -eq 0 }
    finally { Pop-Location }
    if (!$healthy) { throw 'Release health check failed' }
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort 3000)
    if ($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1') { throw 'Unexpected application listener' }
    $result = [pscustomobject]@{ commit=$Commit; buildId=$buildId; release=$release; service=(Get-Service -Name $ServiceName).Status.ToString(); bind='127.0.0.1:3000'; backups=$state; backupManifest=$backupManifest } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $state 'deployment-result.json'), $result, [Text.UTF8Encoding]::new($false))
    Write-Output $result
} catch {
    $failure = $_
    Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
    (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    & reg.exe import $registryBackup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Automatic service rollback failed; restore the saved registry parameters' }
    if ($wasRunning) {
        Start-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
    throw $failure
}
