param([string]$Address)

if (-not $Address) {
    $Address = node -e "const entries = Object.values(require('node:os').networkInterfaces()).flat(); console.log(entries.find(x => x.family === 'IPv4' && !x.internal)?.address ?? '')"
}
if (-not $Address) { throw 'Wi-Fi IPv4 address not found.' }
$bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$python = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { 'python' }
& $python (Join-Path $PSScriptRoot 'make-qr.py') "http://${Address}:8080/?view=student"
if ($LASTEXITCODE -ne 0) { throw 'QR generation requires Python with ReportLab.' }
node (Join-Path $PSScriptRoot 'server.mjs') --demo
