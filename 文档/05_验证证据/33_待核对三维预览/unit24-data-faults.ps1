$ErrorActionPreference = 'Stop'
$draftPath = Join-Path (Get-Location) 'apps/workbench/src/draft-geometry.ts'
$componentPath = Join-Path (Get-Location) 'apps/workbench/src/component-input.ts'
$draftOriginal = [System.IO.File]::ReadAllText($draftPath)
$componentOriginal = [System.IO.File]::ReadAllText($componentPath)
$draftHash = (Get-FileHash -LiteralPath $draftPath -Algorithm SHA256).Hash
$componentHash = (Get-FileHash -LiteralPath $componentPath -Algorithm SHA256).Hash
$encoding = [System.Text.UTF8Encoding]::new($false)
try {
  $faultDraft = $draftOriginal.Replace('  const merged = { ...built.errors, ...errors };', '  const merged = {};')
  $faultDraft = $faultDraft.Replace('  return snapshot.candidates.flatMap', '  return []; return snapshot.candidates.flatMap')
  [System.IO.File]::WriteAllText($draftPath, $faultDraft, $encoding)
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-fault-a.log'
  if ($LASTEXITCODE -eq 0) { throw 'fault A was not detected' }
  [System.IO.File]::WriteAllText($draftPath, $draftOriginal, $encoding)

  $faultDraft = $draftOriginal.Replace('sources.push({ field, kind: "candidate"', 'sources.push({ field, kind: "manual"')
  $faultDraft = $faultDraft.Replace('  const component = built.value;', '  const component = built.value; if (component.solid.kind !== "box") component.solid.axis = "z";')
  [System.IO.File]::WriteAllText($draftPath, $faultDraft, $encoding)
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-fault-b.log'
  if ($LASTEXITCODE -eq 0) { throw 'fault B was not detected' }
  [System.IO.File]::WriteAllText($draftPath, $draftOriginal, $encoding)

  $faultComponent = $componentOriginal.Replace('if (materialUnknown && !unknowns.some', 'if (false && materialUnknown && !unknowns.some')
  [System.IO.File]::WriteAllText($componentPath, $faultComponent, $encoding)
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts src/component-input.test.ts 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-fault-c.log'
  if ($LASTEXITCODE -eq 0) { throw 'fault C was not detected' }
  [System.IO.File]::WriteAllText($componentPath, $componentOriginal, $encoding)

  $faultDraft = $draftOriginal.Replace('expectedRevisionId: input.head.revisionId,', 'expectedRevisionId: (await input.repository.getProjectHead(input.head.projectId))!.revisionId,')
  [System.IO.File]::WriteAllText($draftPath, $faultDraft, $encoding)
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts -t '项目版本改变' 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-fault-d.log'
  if ($LASTEXITCODE -eq 0) { throw 'fault D was not detected' }
  [System.IO.File]::WriteAllText($draftPath, $draftOriginal, $encoding)

  $faultDraft = $draftOriginal.Replace('  const errors: Record<string, string> = {};', '  snapshot.adoptedRecordRefs.push("fault-preview-write"); const errors: Record<string, string> = {};')
  [System.IO.File]::WriteAllText($draftPath, $faultDraft, $encoding)
  pnpm --filter @gujian/workbench exec vitest run src/draft-geometry.test.ts -t '纯预览使用' 2>&1 | Tee-Object -FilePath '.tmp/unit24-data-fault-e.log'
  if ($LASTEXITCODE -eq 0) { throw 'fault E was not detected' }
} finally {
  [System.IO.File]::WriteAllText($draftPath, $draftOriginal, $encoding)
  [System.IO.File]::WriteAllText($componentPath, $componentOriginal, $encoding)
}
if ((Get-FileHash -LiteralPath $draftPath -Algorithm SHA256).Hash -ne $draftHash -or (Get-FileHash -LiteralPath $componentPath -Algorithm SHA256).Hash -ne $componentHash) { throw 'restored source hash mismatch' }
'五类故障均被检出，两份源码 SHA256 与注入前一致。' | Tee-Object -FilePath '.tmp/unit24-data-restoration.log'
