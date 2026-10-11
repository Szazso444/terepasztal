$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageRoot = (Resolve-Path 'assets/source/current-grid-regeneration-v2/handoff').Path
$archiveRoot = Join-Path (Split-Path $packageRoot -Parent) 'handoff-archives'
New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Raw | ConvertFrom-Json
$inventory = @()
foreach ($asset in $manifest.assets) {
  $tasks = @($manifest.tasks | Where-Object { $_.key -eq $asset.key })
  $archivePath = Join-Path $archiveRoot ($asset.key + '.zip')
  $stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
  $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = @('MASTER-PROMPT.txt', 'START-HERE.md', 'geometry/game-iso.ts', $asset.original) + @($asset.existingFacings)
    foreach ($task in $tasks) { $files += @($task.referencePaths); $files += ('prompts/' + $task.key + '-' + $task.rotation + '.txt') }
    foreach ($relative in ($files | Select-Object -Unique)) {
      $sourceFile = Join-Path $packageRoot $relative
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $sourceFile, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $entry = $zip.CreateEntry('manifest.json')
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write((@{ projection = $manifest.projection; assets = @($asset); tasks = $tasks; scope = 'This archive contains one building subset of the full 26-building handoff.' } | ConvertTo-Json -Depth 20)) } finally { $writer.Dispose() }
    $entry = $zip.CreateEntry('THIS-PACK.txt')
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write("This is the $($asset.key) subset: one building, four facing prompts. START-HERE.md describes the full project's goals; only generate this manifest's subset when using this archive alone. Original images are authoritative for identity, not camera. Current camera is 2:1 dimetric (45 degree azimuth, 30 degree elevation, ground slopes +/-0.5). The assigned footprint is $($asset.tiles) tile(s). Read manifest.json for reference order.") } finally { $writer.Dispose() }
  } finally { $zip.Dispose(); $stream.Dispose() }
  $size = (Get-Item -LiteralPath $archivePath).Length
  if ($size -gt 25MB) { throw "Archive exceeds portable 25MB budget: $archivePath" }
  $inventory += @{ asset = $asset.key; file = ($asset.key + '.zip'); bytes = $size }
}
$inventory | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $archiveRoot 'archive-index.json')
@" 
Each zip contains a single building's original reference, all previous facings when available, current-grid geometry guides, four complete prompts and a self-contained manifest. Use one pack at a time in another session. These archives deliberately exclude newly generated candidates; current progress and new images are alongside handoff/ in the repository. Prefer letting the next session read that repo directly to avoid uploading images into chat.
"@ | Set-Content -LiteralPath (Join-Path $archiveRoot 'README.txt')
[PSCustomObject]@{ archives = $inventory.Count; largestMB = [Math]::Round((($inventory | Measure-Object -Property bytes -Maximum).Maximum / 1MB), 2) } | ConvertTo-Json -Compress
