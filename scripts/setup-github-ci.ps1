<#
Sets every GitHub Actions secret and variable that .github/workflows/ci.yml
reads, so CI can deploy. Prints NAMES only, never values.

Where each value comes from:
  - The root .env: the Maps, Firebase and reCAPTCHA browser values. They ship
    in the web bundle anyway, so they are repository VARIABLES, not secrets.
  - Secret Manager: SMOKE_KEY, read with your own gcloud login.
  - Fixed: the Workload Identity provider, the deployer service account, the
    allowed origins and the API URL.

Needs the GitHub CLI, signed in to an account that can administer the repo:
  winget install --id GitHub.cli -e
  gh auth login
Then, from the repo root:
  powershell -ExecutionPolicy Bypass -File scripts\setup-github-ci.ps1

Safe to re-run: every value is overwritten with the current one.
#>
param(
  [string]$Repo = "HAIZ4D/spotential",
  [string]$Project = "spotential-app"
)

# NOT "Stop". In Windows PowerShell 5.1, a native command's redirected stderr
# becomes an error record, and `gh auth status` reports SUCCESS on stderr, so
# "Stop" would abort on a correctly signed-in CLI. Exit codes are checked.
$ErrorActionPreference = "Continue"

# A terminal opened before an install keeps its old PATH, so a freshly
# installed gh (or gcloud) is "not recognized" until this refresh.
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "The GitHub CLI is not installed. Run: winget install --id GitHub.cli -e   then: gh auth login"
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "The GitHub CLI is not signed in. Run: gh auth login" }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw "gcloud is not installed or not on PATH." }

$envFile = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envFile)) { throw "No .env at the repo root ($envFile)." }
$dotenv = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
    $dotenv[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}

$variables = [ordered]@{
  ALLOWED_ORIGINS      = "https://spotential-app.web.app,https://spotential-app.firebaseapp.com,http://localhost:5173,http://localhost:4173"
  SIMULATOR_URL        = "https://simulator-388936868171.asia-southeast1.run.app"
  GOOGLE_MAPS_API_KEY  = $dotenv["VITE_GOOGLE_MAPS_API_KEY"]
  FIREBASE_API_KEY     = $dotenv["VITE_FIREBASE_API_KEY"]
  FIREBASE_AUTH_DOMAIN = $dotenv["VITE_FIREBASE_AUTH_DOMAIN"]
  FIREBASE_PROJECT_ID  = $dotenv["VITE_FIREBASE_PROJECT_ID"]
  FIREBASE_APP_ID      = $dotenv["VITE_FIREBASE_APP_ID"]
  FIREBASE_SENDER_ID   = $dotenv["VITE_FIREBASE_SENDER_ID"]
  RECAPTCHA_SITE_KEY   = $dotenv["VITE_RECAPTCHA_SITE_KEY"]
}

$smokeKey = (gcloud secrets versions access latest --secret=smoke-key --project $Project 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $smokeKey) { throw "Could not read smoke-key from Secret Manager. Is gcloud signed in to $Project?" }

$secrets = [ordered]@{
  GCP_WIF_PROVIDER = "projects/388936868171/locations/global/workloadIdentityPools/github/providers/github"
  GCP_DEPLOY_SA    = "github-deployer@spotential-app.iam.gserviceaccount.com"
  SMOKE_KEY        = ($smokeKey | Out-String).Trim()
}

# Refuse to set anything if any value is missing, rather than leaving the repo
# half-configured, which the workflow's `config` job would only catch later.
$empty = @($variables.Keys | Where-Object { -not $variables[$_] }) + @($secrets.Keys | Where-Object { -not $secrets[$_] })
if ($empty.Count -gt 0) { throw "Missing values for: $($empty -join ', '). Check the root .env." }

foreach ($name in $variables.Keys) {
  gh variable set $name --repo $Repo --body $variables[$name] *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not set variable $name on $Repo." }
  Write-Host "variable  $name"
}
foreach ($name in $secrets.Keys) {
  gh secret set $name --repo $Repo --body $secrets[$name] *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not set secret $name on $Repo." }
  Write-Host "secret    $name"
}

Write-Host ""
Write-Host "Done: $($variables.Count) variables and $($secrets.Count) secrets set on $Repo."
Write-Host "The next push to main runs the full pipeline, deploy included."
