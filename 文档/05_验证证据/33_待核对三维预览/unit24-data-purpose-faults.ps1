$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath 'apps/workbench/src/dimension-review.ts').Path
$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
$sourceText = [IO.File]::ReadAllText($sourcePath)
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
try {
  $wrongPurpose = $sourceText.Replace('quantityKind !== (row.quantityKind ?? "length")', 'quantityKind !== (row.quantityKind ?? "unspecified")')
  if ($wrongPurpose -eq $sourceText) { throw '用途故障注入未命中' }
  [IO.File]::WriteAllText($sourcePath, $wrongPurpose, [Text.UTF8Encoding]::new($false))
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts -t '合法省略标注类型' 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-purpose-fault.log'
  if ($LASTEXITCODE -eq 0) { throw '用途回归未检出故障' }
  [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
  $missingUncertain = $sourceText.Replace('row.certainty === "uncertain" || changed || conflict', 'changed || conflict')
  if ($missingUncertain -eq $sourceText) { throw '待核实故障注入未命中' }
  [IO.File]::WriteAllText($sourcePath, $missingUncertain, [Text.UTF8Encoding]::new($false))
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts -t '待核实候选仍需说明' 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-uncertain-fault.log'
  if ($LASTEXITCODE -eq 0) { throw '待核实回归未检出故障' }
} finally {
  [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
  $restoredHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  "original=$sourceHash restored=$restoredHash equal=$($sourceHash -eq $restoredHash)" | Tee-Object -FilePath '.tmp/unit24-data-purpose-restoration.log'
  if ($sourceHash -ne $restoredHash) { throw '源码恢复哈希不一致' }
}
