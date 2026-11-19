<#
One-time GCP setup that lets GitHub Actions deploy, through Workload Identity
Federation. No service-account key is created or stored anywhere.

Creates, in spotential-app:
  1. The Security Token Service API, which WIF exchanges GitHub's token through.
  2. Service account `github-deployer`, holding only the roles the CI jobs use:
       roles/run.admin                         deploy, tag and route Cloud Run
       roles/cloudbuild.builds.editor          submit and poll the image build
       roles/serviceusage.serviceUsageConsumer make API calls billed to the project
       roles/firebasehosting.admin             release Firebase Hosting
       roles/firebase.viewer                   read the Firebase project
       roles/iam.serviceAccountUser            on the compute account ONLY, which
                                               Cloud Run and Cloud Build run as
       roles/storage.admin                     on the Cloud Build source bucket ONLY
     Deliberately NOT project Viewer: that can read every Firestore document,
     vendors' booth applications included.
  3. Workload Identity pool `github` with OIDC provider `github`, which accepts
     a token ONLY from the repository HAIZ4D/spotential on refs/heads/main.
     A fork, a pull request or another branch gets nothing.

Run once, signed in to gcloud as a project owner:
  powershell -ExecutionPolicy Bypass -File scripts\setup-gcp-ci.ps1
Then run scripts\setup-github-ci.ps1 to give GitHub the matching secrets.
Safe to re-run: whatever already exists is left as it is.
#>
param(
  [string]$Project = "spotential-app",
  [string]$ProjectNumber = "388936868171",
  [string]$Repo = "HAIZ4D/spotential"
)

# NOT "Stop". In Windows PowerShell 5.1, a native command's redirected stderr
# becomes an error record, so "Stop" would abort on gcloud's ordinary progress
# messages and on the `describe` probes below that are EXPECTED to fail. Every
# step checks $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw "gcloud is not installed or not on PATH." }

$deployer = "github-deployer@$Project.iam.gserviceaccount.com"
$runtime = "$ProjectNumber-compute@developer.gserviceaccount.com"
$pool = "github"
$provider = "github"
$principalSet = "principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/$pool/attribute.repository/$Repo"

function Step([string]$text) { Write-Host ""; Write-Host "== $text" }
function Check([string]$what) { if ($LASTEXITCODE -ne 0) { throw "Failed: $what" } }

Step "Enable the Security Token Service API"
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com --project $Project
Check "enable APIs"

Step "Service account $deployer"
gcloud iam service-accounts describe $deployer --project $Project *> $null
if ($LASTEXITCODE -ne 0) {
  gcloud iam service-accounts create github-deployer --project $Project `
    --display-name "GitHub Actions deployer" `
    --description "Deploys Cloud Run and Firebase Hosting from CI on main, via Workload Identity Federation."
  Check "create service account"
} else { Write-Host "already exists" }

Step "Workload Identity pool '$pool'"
gcloud iam workload-identity-pools describe $pool --location global --project $Project *> $null
if ($LASTEXITCODE -ne 0) {
  gcloud iam workload-identity-pools create $pool --location global --project $Project `
    --display-name "GitHub Actions" --description "OIDC tokens from GitHub Actions for $Repo"
  Check "create pool"
} else { Write-Host "already exists" }

Step "OIDC provider '$provider' (only $Repo on refs/heads/main)"
gcloud iam workload-identity-pools providers describe $provider --workload-identity-pool $pool --location global --project $Project *> $null
if ($LASTEXITCODE -ne 0) {
  # A flags file rather than inline flags: PowerShell splits a comma-separated
  # argument on its way into gcloud, which is a recorded gotcha in this repo,
  # and the attribute mapping is exactly such a list.
  $flags = Join-Path $env:TEMP "spotential-wif-provider.yaml"
  @"
--issuer-uri: https://token.actions.githubusercontent.com
--attribute-mapping: google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref
--attribute-condition: assertion.repository == '$Repo' && assertion.ref == 'refs/heads/main'
"@ | Out-File -Encoding ascii $flags
  gcloud iam workload-identity-pools providers create-oidc $provider --workload-identity-pool $pool --location global --project $Project --display-name "GitHub" --flags-file $flags
  Check "create provider"
  Remove-Item $flags -Force
} else { Write-Host "already exists" }

Step "Let that provider act as the deployer"
gcloud iam service-accounts add-iam-policy-binding $deployer --project $Project `
  --role roles/iam.workloadIdentityUser --member $principalSet --condition None *> $null
Check "workloadIdentityUser binding"
Write-Host "ok"

Step "Project roles for the deployer"
foreach ($role in "roles/run.admin", "roles/cloudbuild.builds.editor", "roles/serviceusage.serviceUsageConsumer", "roles/firebasehosting.admin", "roles/firebase.viewer") {
  gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$deployer" --role $role --condition None --quiet *> $null
  Check "grant $role"
  Write-Host "granted $role"
}

Step "Act as the runtime account (Cloud Run and Cloud Build both run as it)"
gcloud iam service-accounts add-iam-policy-binding $runtime --project $Project `
  --member "serviceAccount:$deployer" --role roles/iam.serviceAccountUser --condition None *> $null
Check "serviceAccountUser on $runtime"
Write-Host "ok"

Step "Upload builds to the Cloud Build source bucket (that bucket only)"
gcloud storage buckets add-iam-policy-binding "gs://$($Project)_cloudbuild" `
  --member "serviceAccount:$deployer" --role roles/storage.admin *> $null
Check "bucket binding"
Write-Host "ok"

Step "Check"
$condition = gcloud iam workload-identity-pools providers describe $provider --workload-identity-pool $pool --location global --project $Project --format "value(attributeCondition)"
Write-Host "provider accepts only: $condition"
$roles = gcloud projects get-iam-policy $Project --flatten "bindings[].members" --filter "bindings.members:serviceAccount:$deployer" --format "value(bindings.role)"
Write-Host "deployer project roles: $($roles -join ' ')"

Write-Host ""
Write-Host "Done. Next: powershell -ExecutionPolicy Bypass -File scripts\setup-github-ci.ps1"
