$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath 'apps/workbench/src/draft-geometry.ts').Path
$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
$sourceText = [IO.File]::ReadAllText($sourcePath)
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$faults = @(
  @{ Name = 'candidate-list'; Target = 'quantityKind: row.quantityKind ?? "unspecified", ...(row.region ? { region: row.region } : {})'; Wrong = 'quantityKind: row.quantityKind ?? "unspecified"' },
  @{ Name = 'candidate-source'; Target = 'locationText: row.locationZh, selection, ...(row.region ? { region: row.region } : {})'; Wrong = 'locationText: row.locationZh, selection' },
  @{ Name = 'adopted-source'; Target = 'locationText: value.original.locationZh, ...(value.original.region ? { region: value.original.region } : {})'; Wrong = 'locationText: value.original.locationZh' }
)
try {
  foreach ($fault in $faults) {
    $faultText = $sourceText.Replace($fault.Target, $fault.Wrong)
    if ($faultText -eq $sourceText) { throw "区域故障未命中 $($fault.Name)" }
    [IO.File]::WriteAllText($sourcePath, $faultText, [Text.UTF8Encoding]::new($false))
    pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts -t '原件标注区域' 2>&1 | Tee-Object -FilePath ".tmp/unit24-data-region-$($fault.Name)-fault.log"
    if ($LASTEXITCODE -eq 0) { throw "区域回归未检出 $($fault.Name)" }
    [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
  }
} finally {
  [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
  $restoredHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  "original=$sourceHash restored=$restoredHash equal=$($sourceHash -eq $restoredHash)" | Tee-Object -FilePath '.tmp/unit24-data-region-restoration.log'
  if ($sourceHash -ne $restoredHash) { throw '源码恢复哈希不一致' }
}
