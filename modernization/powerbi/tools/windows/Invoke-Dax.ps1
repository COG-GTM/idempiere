<#
Runs a DAX query against the model open in Power BI Desktop and writes the result as CSV.
Used for parity: dax/<report>.dax -> parity/actual/<report>.csv, then `python -m r2r compare <report>`.

  powershell -ExecutionPolicy Bypass -File tools\windows\Invoke-Dax.ps1 -DaxFile dax\gl_period_balance.dax -OutCsv parity\actual\gl_period_balance.csv
#>
param(
  [Parameter(Mandatory = $true)][string]$DaxFile,
  [Parameter(Mandatory = $true)][string]$OutCsv
)
$ErrorActionPreference = 'Stop'

# Power BI Desktop hosts a local Analysis Services instance on a random port.
$roots = @("$env:LOCALAPPDATA\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces",
           "$env:USERPROFILE\Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces") | Where-Object { Test-Path $_ }
$portFile = Get-ChildItem $roots -Recurse -Filter msmdsrv.port.txt -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $portFile) { throw "No running Power BI Desktop model found. Open the .pbip and refresh first." }
$port = (Get-Content $portFile.FullName -Raw -Encoding Unicode).Trim([char]0, ' ', "`r", "`n")

# ADOMD client: Power BI Desktop ships one; fall back to the NuGet package.
$dll = Get-ChildItem "$env:ProgramFiles\Microsoft Power BI Desktop\bin", "$env:ProgramFiles\WindowsApps" -Recurse `
  -Filter Microsoft.PowerBI.AdomdClient.dll -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $dll) {
  $pkg = Join-Path $env:TEMP 'adomd'
  if (-not (Test-Path $pkg)) {
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.AnalysisServices.AdomdClient.retail.amd64' -OutFile "$pkg.zip"
    Expand-Archive "$pkg.zip" $pkg
  }
  $dll = Get-ChildItem $pkg -Recurse -Filter Microsoft.AnalysisServices.AdomdClient.dll | Select-Object -First 1
}
Add-Type -Path $dll.FullName

$conn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port")
$conn.Open()
try {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = Get-Content $DaxFile -Raw
  $reader = $cmd.ExecuteReader()
  $cols = 0..($reader.FieldCount - 1) | ForEach-Object { $reader.GetName($_) }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add(($cols | ForEach-Object { '"' + $_.Replace('"', '""') + '"' }) -join ',')
  while ($reader.Read()) {
    $vals = 0..($reader.FieldCount - 1) | ForEach-Object {
      $v = $reader.GetValue($_)
      if ($v -is [DBNull]) { '' }
      elseif ($v -is [datetime]) { $v.ToString('yyyy-MM-dd') }
      elseif ($v -is [IFormattable]) { '"' + $v.ToString($null, $inv) + '"' }
      else { '"' + "$v".Replace('"', '""') + '"' }
    }
    $lines.Add($vals -join ',')
  }
  $reader.Close()
  New-Item -ItemType Directory -Force -Path (Split-Path $OutCsv) | Out-Null
  [IO.File]::WriteAllLines((Resolve-Path -LiteralPath (Split-Path $OutCsv)).Path + '\' + (Split-Path $OutCsv -Leaf), $lines)
  Write-Host "Wrote $($lines.Count - 1) rows to $OutCsv (port $port)"
} finally { $conn.Close() }
