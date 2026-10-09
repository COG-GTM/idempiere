<#
Sparse-clones only modernization/powerbi of COG-GTM/idempiere to C:\idempiere (the
DataFolder default in the semantic model), so Power BI Desktop opens with no prompts.

  powershell -ExecutionPolicy Bypass -File Get-R2R.ps1 -Branch master
#>
param([string]$Branch = 'master', [string]$Target = 'C:\idempiere')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path "$Target\.git")) {
  git clone --filter=blob:none --no-checkout --branch $Branch https://github.com/COG-GTM/idempiere.git $Target
  git -C $Target sparse-checkout set --no-cone /modernization/powerbi/
  git -C $Target checkout $Branch
} else {
  git -C $Target fetch origin $Branch
  git -C $Target checkout -B $Branch "origin/$Branch"
}
Write-Host "Open: $Target\modernization\powerbi\pbi\iDempiere R2R.pbip"
