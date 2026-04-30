# Render the six example videos via the renderer service (Docker on :5000)
# and copy them into client/public/examples/ where the landing page picks them up.
#
# Usage (from repo root):
#   pwsh examples/render-examples.ps1
#
# Prereqs:
#   - docker compose up renderer  (renderer must be reachable at http://localhost:5000)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptsDir = Join-Path $repoRoot 'examples\scripts'
$outputDir = Join-Path $repoRoot 'client\public\examples'
$rendererUrl = 'http://localhost:5000'

# Map: scene id (= filename used by the landing page) → script file
$videos = @(
    @{ id = 'pythagorean-theorem'; file = 'pythagorean_theorem.py' },
    @{ id = 'bubble-sort';         file = 'bubble_sort.py' },
    @{ id = 'pendulum-motion';     file = 'pendulum_motion.py' },
    @{ id = 'binary-search';       file = 'binary_search.py' },
    @{ id = 'fourier-series';      file = 'fourier_series.py' },
    @{ id = 'wave-interference';   file = 'wave_interference.py' }
)

Write-Host "==> Renderer: $rendererUrl"
Write-Host "==> Output:   $outputDir"
Write-Host ""

# Sanity check: renderer reachable?
try {
    Invoke-RestMethod "$rendererUrl/health" -TimeoutSec 5 | Out-Null
} catch {
    Write-Error "Renderer is not reachable at $rendererUrl. Start it first with 'docker compose up renderer'."
    exit 1
}

foreach ($v in $videos) {
    $scriptPath = Join-Path $scriptsDir $v.file
    $finalPath = Join-Path $outputDir "$($v.id).mp4"

    if (-not (Test-Path $scriptPath)) {
        Write-Warning "Skipping $($v.id): script $scriptPath not found"
        continue
    }

    Write-Host "==> Rendering $($v.id)..."
    $code = Get-Content $scriptPath -Raw

    $body = @{
        sceneId   = $v.id
        manimCode = $code
        # Use medium quality for landing-page videos (720p). Switch to 'high' if
        # you want 1080p; expect ~3x slower render time.
        quality   = 'medium'
    } | ConvertTo-Json -Depth 5 -Compress

    # Windows PowerShell 5.1's Invoke-RestMethod has documented quirks with
    # UTF-8 / multiline / large bodies. Write the JSON to a temp file with
    # explicit UTF-8-no-BOM encoding and POST via curl.exe — bulletproof.
    $tmpFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmpFile, $body, [System.Text.UTF8Encoding]::new($false))

    $respJson = $null
    try {
        $respJson = & curl.exe --silent --show-error `
            --max-time 600 `
            -X POST "$rendererUrl/render-code" `
            -H "Content-Type: application/json; charset=utf-8" `
            --data-binary "@$tmpFile" 2>&1
    } finally {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    }

    if (-not $respJson) {
        Write-Warning "Empty response from renderer for $($v.id)"
        continue
    }

    try {
        $resp = $respJson | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse renderer response for $($v.id):"
        Write-Warning $respJson
        continue
    }

    if (-not $resp.success) {
        Write-Warning "Render failed for $($v.id):"
        Write-Warning ($resp | ConvertTo-Json -Depth 5)
        continue
    }

    # Renderer wrote the file to storage/output/<id>.mp4 via the volume mount.
    $rendered = Join-Path $repoRoot "storage\output\$($v.id).mp4"
    if (-not (Test-Path $rendered)) {
        Write-Warning "Rendered file not found at $rendered (renderer may have stored it elsewhere)"
        continue
    }

    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }

    Move-Item -Path $rendered -Destination $finalPath -Force
    Write-Host "    OK -> $finalPath  ($([Math]::Round((Get-Item $finalPath).Length / 1KB)) KB, $($resp.duration)s)" -ForegroundColor Green
}

Write-Host ""
Write-Host "All done. Reload the landing page to see the videos." -ForegroundColor Green
