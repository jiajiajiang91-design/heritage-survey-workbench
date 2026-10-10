# 单元 24 前端交接

前端编辑、内存预览和 Three.js 临时网格已完成，最后源文件恢复后未再修改。

## 文件

- apps/workbench/src/screens/GeometryComponentEditor.tsx、.css、.test.tsx：候选尺寸选择与修正、原子保存入口、预览与原件参数关联、草稿保留、来源变化失效。
- apps/workbench/src/draft-geometry-mesh.ts、.test.ts：CAD 毫米参数转视口米；长方体、三轴圆柱、三轴轮廓挤出；stableKey 身份。
- apps/workbench/src/DraftGeometryViewer.tsx、.css、.test.tsx：Three.js 场景、相机、选择、错误恢复、资源释放。

## 检查命令

仓库根目录，使用现有 Node 与依赖，无安装：

```powershell
node node_modules/vitest/vitest.mjs run src/DraftGeometryViewer.test.tsx src/draft-geometry-mesh.test.ts src/screens/GeometryComponentEditor.test.tsx --root apps/workbench --configLoader runner --maxWorkers 1 --no-file-parallelism
node node_modules/typescript/bin/tsc -p apps/workbench/tsconfig.app.json --noEmit --incremental false --composite false --pretty false
```

测试包括 Editor 13、实际 Three 几何 8、viewer 生命周期 4，共 25 项，全部通过。最终结果见 unit24-ui-final-tests.log；类型检查通过，见 unit24-ui-final-typecheck.log。

## 真实故障证据

故障已恢复，日志记录了断言失败：

1. unit24-ui-fault-parse-records.log：仅追加解析失败或 unsupported 记录，事实、候选和资料集合不变，原候选与采用尺寸旧形体仍显示，两个用例失败。补 parseRecords 失效键后 unit24-ui-parse-records-restored.log 两项通过。
2. unit24-ui-fault-axis-y.log：Y 挤出旋转符号反转，实际包围盒 0.2 m 与预期 1.2 m 不符。恢复正旋转。
3. unit24-ui-fault-geometry-disposal.log：移除几何 dispose，期望两次释放实际零次。恢复清理代码。
4. unit24-ui-fault-candidate-source.log：构件来自 A 图区域、X 参数来自 B 表时，形体点击错误选择 B 表；重开已保存输入没有恢复候选区域。两个新用例在修复前实际断言失败。修复后最终测试全部通过。

实际几何断言保留毫米只换算一次、中心位置、三轴挤出原点，以及两个对象独立身份。6100.5 mm 的长方体测试视口 X 长 6.1005 m。

## 责任与限制

编辑预览不调用 CAD、不写项目、不生成成果和 GeometryRevision。只有核对保存调用主线程原子提交入口。类型未定候选明确用于长度字段即可；修正、不确定或冲突的说明仍由共享数据核对规则决定。

UI 测试 mock WebGLRenderer，但几何包围盒、中心、raycaster、对象身份及几何资源释放使用实际 Three.js 对象。真实 WebGL、1280px 布局与整链保存由主线程浏览器验证，不能用本记录替代。

parseRecords 及跨资料选择修复后前端源文件已停止修改，主线程可重新录制浏览器证据。onShowEvidence 支持第二个可选区域参数，参数原件和候选原件保留尺寸标注区域；形体选择与重开恢复 candidateSource 原构件图。未改其他 worker 代码、正式文档或主线程测试。
