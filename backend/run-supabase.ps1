# Starts the backend against Supabase instead of the local Docker Postgres.
# Reads DB_URL / DB_USER / DB_PASSWORD / DB_POOL_SIZE from supabase.env (git-ignored).
$envFile = Join-Path $PSScriptRoot "supabase.env"
if (-not (Test-Path $envFile)) {
    Write-Host "supabase.env not found. Copy supabase.env.example to supabase.env and fill it in." -ForegroundColor Red
    exit 1
}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    $name = $t.Substring(0, $i).Trim()
    $value = $t.Substring($i + 1).Trim()
    Set-Item -Path "Env:$name" -Value $value
}
Write-Host "Using database: $($env:DB_URL -replace '\?.*$', '')" -ForegroundColor Cyan
Set-Location $PSScriptRoot
.\mvnw.cmd spring-boot:run
