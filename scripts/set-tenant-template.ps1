# Set Tenant Config Script
# Deploy via Intune per tenant device group
# Duplicate this file and change SITE_NAME for each tenant

$siteName = "testtenant1"  # <-- CHANGE THIS PER TENANT

$configDir = "C:\ProgramData\SmartSenior"
$configFile = "$configDir\config.json"

if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$config = @{
    site    = $siteName
    homeUrl = "https://kiosk.saidans.org?site=$siteName"
} | ConvertTo-Json

$config | Out-File -FilePath $configFile -Encoding UTF8
Write-Output "Tenant set to: $siteName"
