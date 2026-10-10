# 单元24数据与原子提交记录

纯预览、来源校验和尺寸与构件原子保存已实现，最终定向50条测试通过，17条新增数据测试有对应红灯证据。

2026-10-02，所有权仅 component-input.ts及测试、geometry-fact-service.ts、新draft-geometry.ts及测试。补充授权允许dimension-review.ts用途判断的临时故障注入，审查撤回后保留该文件原生产语义。未修改前端worker、领域、仓储或文档文件。

- 已读取单元24三件套、架构1.6和界面6.1，并向主线程复述。
- ComponentDraft仅增加约定的可选candidateBindings、candidateReason，预览草稿稳定键、形体、坐标和来源由当前快照派生。
- candidateDimensions仅列当前项目可读可用且未核对的有效正长度。relativeElevation、拒绝、替代、无效及失效来源禁用；缺quantityKind用unspecified保留类型未定标记。
- 预览按draft.lengths产生形体。候选、已采用和直接输入分别保留原文、来源资料及定位；同字段双来源、同候选重复字段使用不同修正值均检出。
- 候选列表及参数来源增加可选region，候选使用row.region，已采用使用original.region，直接输入不推断区域，便于前端定位原件标注。
- 主线程确认具体长度字段选择已声明用途，类型未定不新增说明门槛；修正、不确定值及同名异值沿用现有尺寸核对说明规则。
- 空材料和明确未知统一为materialCode=unknown，自动材料未知说明及所需材料调查记录，保留其他未知项且重复编辑不累加。
- 待核对预览仅允许human/measured位置，缺有限坐标及明确资料位置时不能显示。不将二维原件区域转换为三维位置。
- 提取buildGeometryFacts供既有commitGeometryFacts和新草稿保存共用，保持既有提交语义。
- 保存以同一commandId构造quantityKind=length的尺寸采用事实、虚拟快照校验引用、构件事实，再一次CommitFacts提交。成功读回失败返回head=null，命令不重复。
- 实仓储确认尺寸与构件两类事实一次写入，版本冲突和命令失败不会留下半成功。ZIP在独立IndexedDB恢复采用引用、稳定键、未知材料与真实原资料字节，无GeometryRevision产生。

五类故障：A遗漏预览错误和候选筛选4条失败；B将候选误标人工、遗漏尺寸采用及错误轴向8条失败；C遗漏未知材料3条失败；D自动取新版本覆盖旧编辑1条失败；E预览写快照状态1条失败。新增14条均至少失败一次。finally恢复并核对两份源码SHA256一致。

证据：unit24-data-green.log、unit24-data-fault-a.log至fault-e.log、unit24-data-restoration.log、unit24-data-restored-green.log。正则与自有文件diff检查通过。

补充实际保存回归：合法省略quantityKind的确定正数原值，无candidateReason时一次命令成功保存并记quantityKind=length，保留无类型的原行且corrected=false；同样缺类型的uncertain原值仍要求说明，失败零写入。dimension-review.ts生产规则没有放宽。

补充故障证据：错误将合法缺类型视为修正，用途回归1条失败；遗漏uncertain说明门槛，待核实回归1条失败。源码SHA256原字节恢复，日志unit24-data-purpose-fault.log、uncertain-fault.log、purpose-restoration.log。区域候选列表、候选参数和采用参数分别遗漏region，区域用例三次独立红灯，日志unit24-data-region-*-fault.log、region-restoration.log，源码SHA256原字节恢复。

最终恢复验证：unit24-data-reviewed-green.log中draft-geometry16、component-input19、component-package1、既有dimension-review14共50条全通过。unit24-data-reviewed-typecheck.log工作台类型检查通过。自有文件git diff --check通过，最初正则检查通过。没有未恢复故障，新增17条均有红灯证据。

最近额度剩余主窗口35%、周窗口28%，尚未触及小于等于3%停止阈值。整体浏览器检查、独立复查、完整质量检查与文档收口由主线程负责。无外部模型调用、无真实资料外传、无提交发布。
