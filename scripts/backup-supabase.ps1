param(
  [string]$OutputRoot = "backups"
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw 'Chybí proměnná prostředí SUPABASE_DB_URL s přímým nebo Session Pooler connection stringem.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $OutputRoot $stamp
New-Item -ItemType Directory -Path $target -Force | Out-Null

$rolesFile = Join-Path $target 'roles.sql'
$schemaFile = Join-Path $target 'schema.sql'
$dataFile = Join-Path $target 'data.sql'

Write-Host "Záloha rolí..."
& supabase db dump --db-url $env:SUPABASE_DB_URL -f $rolesFile --role-only
if ($LASTEXITCODE -ne 0) { throw 'Záloha rolí selhala.' }

Write-Host "Záloha schématu..."
& supabase db dump --db-url $env:SUPABASE_DB_URL -f $schemaFile
if ($LASTEXITCODE -ne 0) { throw 'Záloha schématu selhala.' }

Write-Host "Záloha dat..."
& supabase db dump --db-url $env:SUPABASE_DB_URL -f $dataFile --data-only --use-copy -x 'storage.buckets_vectors' -x 'storage.vector_indexes'
if ($LASTEXITCODE -ne 0) { throw 'Záloha dat selhala.' }

$hashFile = Join-Path $target 'SHA256SUMS.txt'
$hashes = Get-FileHash -Algorithm SHA256 $rolesFile, $schemaFile, $dataFile
$hashes | ForEach-Object {
  "{0}  {1}" -f $_.Hash.ToLowerInvariant(), (Split-Path $_.Path -Leaf)
} | Set-Content -Encoding UTF8 $hashFile

Write-Host "Hotovo: $target"
Write-Host 'Adresář backups/ je v .gitignore. Uchovej kopii mimo tento počítač a mimo veřejný GitHub repozitář.'
