param(
  [Parameter(Mandatory=$true)][string]$Workbook,
  [string]$BaseUrl = 'http://localhost:3100',
  [string]$Login = 'admin',
  [string]$Title = 'Demo Day',
  [switch]$Apply,
  [switch]$StartNewEvent
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Workbook))
function Read-Entry([string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
try {
  $strings = @()
  $raw = Read-Entry 'xl/sharedStrings.xml'
  if ($raw) {
    [xml]$shared = $raw
    $strings = @($shared.sst.si | ForEach-Object { $_.InnerText })
  }
  [xml]$sheet = Read-Entry 'xl/worksheets/sheet1.xml'
  if (-not $sheet) { throw 'The workbook has no first worksheet.' }
  $talks = @()
  foreach ($row in $sheet.worksheet.sheetData.row) {
    $cells = @{}
    foreach ($cell in $row.c) {
      $value = [string]$cell.v
      if ($cell.t -eq 's') { $value = $strings[[int]$cell.v] }
      elseif ($cell.t -eq 'inlineStr') { $value = $cell.is.InnerText }
      $column = $cell.r -replace '\d', ''
      $cells[$column] = ([string]$value).Trim()
    }
    # Only presentation rows have a named speaker; opening, break and closing do not.
    if ($row.r -eq '1' -or -not $cells['F'] -or -not $cells['E'] -or $cells['E'] -match '^[-\u2014\u2013]+$') { continue }
    $talks += @{ title = $cells['F']; speaker = $cells['E']; description = '' }
  }
} finally { $zip.Dispose() }
if (-not $talks.Count) { throw 'No presentations found; nothing was changed.' }
Write-Output "Presentations: $($talks.Count)"
if (-not $Apply) { $talks | ConvertTo-Json -Depth 5; return }
if (-not $env:VOTING_ADMIN_PASSWORD) { throw 'Set VOTING_ADMIN_PASSWORD before applying the import.' }
function Invoke-Voting([string]$route, [string]$method = 'GET', $payload = $null) {
  $args = @{ Uri = "$BaseUrl$route"; Method = $method; WebSession = $script:session }
  if ($null -ne $payload) {
    $args.ContentType = 'application/json; charset=utf-8'
    $args.Body = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 10 -Compress))
  }
  Invoke-RestMethod @args
}
$script:session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-Voting '/api/admin/login' 'POST' @{ login = $Login; password = $env:VOTING_ADMIN_PASSWORD }
$state = Invoke-Voting '/api/admin/state'
$source = (Get-FileHash -LiteralPath $Workbook -Algorithm SHA256).Hash
if ($state.event.importSource -eq $source) { Write-Output 'This workbook is already imported; no changes made.'; return }
if ($StartNewEvent) {
  $null = Invoke-Voting '/api/admin/events/complete' 'POST'
  $state = Invoke-Voting '/api/admin/events/new' 'POST' @{ title = $Title }
}
if ($state.allTalks.Count -or $state.votes.Count) { throw 'Import requires an empty event. Use -StartNewEvent to archive the current event first.' }
$result = Invoke-Voting '/api/admin/talks/import' 'POST' @{ talks = $talks; source = $source }
Write-Output "Imported: $($result.allTalks.Count). Archived events: $($result.history.Count)."
