import type { ProjectHead } from "@gujian/application";
import type { ArtifactRecord, CheckRun, GeometryRevision, ProjectDrivenGeometrySpec } from "@gujian/domain";
import { describe, expect, it } from "vitest";

import { collectDeliveryBlockerDetails } from "./delivery-service.js";

describe("delivery blocker propagation", () => {
  it("传播 open issue、结构化 unknown 和 blocked check，并区分仅正式资格阻断", () => {
    const projectId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const geometrySpecId = crypto.randomUUID();
    const geometryId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const unknownId = crypto.randomUUID();
    const issueId = crypto.randomUUID();
    const checkId = crypto.randomUUID();
    const spec = {
      schemaVersion: "2.0", id: geometrySpecId, projectId, projectRevisionId: revisionId, buildingId: crypto.randomUUID(), inputHash: "1".repeat(64),
      coordinateSystem: { name: "local", axisOrder: "XYZ", upAxis: "Z", lengthUnit: "mm", origin: [0, 0, 0] }, tolerances: { modellingMm: 0.5, interfaceMm: 0.5, tessellationMm: 1 },
      objects: [{ id: objectId, stableKey: "wall", parentId: null, componentType: "wall", displayNameZh: "墙", materialCode: "documented", solid: { kind: "box", sizeX: "1", sizeY: "1", sizeZ: "1", centerMm: [0, 0, 0] }, parameters: [], producer: { producerType: "rule", ruleRunId: crypto.randomUUID() }, factRefs: [], evidenceRefs: [], unknownRefs: [unknownId] }],
      interfaces: [], unknowns: [{ id: unknownId, subjectRef: objectId, reasonCode: "WALL_SECTION_MISSING", description: "墙身构造缺失。", requiredEvidence: ["墙身详图"], affectedRefs: [objectId], evidenceRefs: [], blocksProxyOutcome: true, blocksFormalEligibility: true }],
      createdAt: "2026-08-14T00:00:00Z",
    } as ProjectDrivenGeometrySpec;
    const head = {
      projectId, revisionId, auditEventId: crypto.randomUUID(),
      snapshot: {
        geometrySpecs: [spec],
        reviewSignoffs: [],
        issues: [{ id: issueId, projectId, issueType: "ruleConflict", subjectRefs: [objectId], description: "开口定位冲突。", sourceRef: "rule:opening", status: "open", impactRefs: [geometryId], blocksProxyOutcome: true, blocksFormalEligibility: true, producer: { producerType: "rule", ruleRunId: crypto.randomUUID() }, createdAt: "2026-08-14T00:00:00Z", resolvedAt: null }],
      },
    } as unknown as ProjectHead;
    const geometry = { id: geometryId, geometrySpecId } as GeometryRevision;
    const checkRun = {
      id: checkId,
      results: [
        { code: "GEOMETRY_SOURCE_CLOSURE_FAILED", outcome: "blocked", message: "来源闭包失败。", sourceRefs: [geometryId] },
        { code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked", message: "需专业复核。", sourceRefs: [geometryId] },
      ],
    } as CheckRun;
    const artifact = { id: crypto.randomUUID(), fileName: "drawing.dxf", blockers: ["FORMAL_SIGNOFF_UNAVAILABLE"] } as ArtifactRecord;
    const details = collectDeliveryBlockerDetails(head, geometry, [artifact], checkRun);
    expect(details.some((item) => item.sourceType === "unknown" && item.blocksProxyOutcome)).toBe(true);
    expect(details.some((item) => item.sourceType === "issue" && item.blocksProxyOutcome)).toBe(true);
    expect(details.some((item) => item.code === "CHECK_BLOCKED:GEOMETRY_SOURCE_CLOSURE_FAILED" && item.blocksProxyOutcome)).toBe(true);
    expect(details.find((item) => item.code === "CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED")?.blocksProxyOutcome).toBe(false);
    expect(details.find((item) => item.code === "FORMAL_SIGNOFF_UNAVAILABLE")?.blocksProxyOutcome).toBe(false);
  });

  // 实施单元 09：正式环境的复核签发记录解除未经复核与本机不能签发两条阻断，
  // 检查记录里对应的阻断结果与成果上的阻断码一并解除；L1 只在记录认定时解除。
  it("有复核签发记录时，正式资格阻断随记录解除，其余阻断照旧", () => {
    const projectId = crypto.randomUUID();
    const geometryId = crypto.randomUUID();
    const geometrySpecId = crypto.randomUUID();
    const issueId = crypto.randomUUID();
    const base = {
      projectId, revisionId: crypto.randomUUID(), auditEventId: crypto.randomUUID(),
      snapshot: {
        geometrySpecs: [{ id: geometrySpecId, unknowns: [] }],
        issues: [{ id: issueId, issueType: "ruleConflict", description: "尺寸冲突。", status: "open", blocksProxyOutcome: false }],
        reviewSignoffs: [] as unknown[],
      },
    };
    const geometry = { id: geometryId, geometrySpecId } as GeometryRevision;
    const checkRun = {
      id: crypto.randomUUID(),
      results: [{ code: "PROFESSIONAL_REVIEW_REQUIRED", outcome: "blocked", message: "需专业复核。", sourceRefs: [geometryId] }],
    } as CheckRun;
    const artifact = { id: crypto.randomUUID(), fileName: "drawing.dxf", blockers: ["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE"] } as ArtifactRecord;

    const before = collectDeliveryBlockerDetails(base as unknown as ProjectHead, geometry, [artifact], checkRun);
    expect(before.map((item) => item.code)).toEqual(expect.arrayContaining(["PROFESSIONAL_REVIEW_REQUIRED", "FORMAL_SIGNOFF_UNAVAILABLE", "L1_ELIGIBILITY_FALSE", "CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED"]));

    const signed = {
      ...base,
      snapshot: {
        ...base.snapshot,
        reviewSignoffs: [{
          id: crypto.randomUUID(), projectId, projectRevisionId: base.revisionId, deliveryDraftId: crypto.randomUUID(), geometryRevisionId: geometryId,
          reviewerRole: "professionalReviewer", reviewerActorId: crypto.randomUUID(), reviewedAt: "2026-08-20T00:00:00Z", signedAt: "2026-08-20T00:00:00Z",
          issuingEnvironment: "formal", l1Eligible: false, statementZh: "复核通过。",
        }],
      },
    };
    const after = collectDeliveryBlockerDetails(signed as unknown as ProjectHead, geometry, [artifact], checkRun);
    const codes = after.map((item) => item.code);
    expect(codes).not.toContain("PROFESSIONAL_REVIEW_REQUIRED");
    expect(codes).not.toContain("FORMAL_SIGNOFF_UNAVAILABLE");
    expect(codes).not.toContain("CHECK_BLOCKED:PROFESSIONAL_REVIEW_REQUIRED");
    // L1 未认定，仍在；只阻断正式资格的问题随签发视为已复核接受，不再是阻断
    expect(codes).toContain("L1_ELIGIBILITY_FALSE");
    expect(after.some((item) => item.sourceType === "issue")).toBe(false);

    // 阻断代理成果本身的硬错误不受签发影响
    const hard = { ...signed, snapshot: { ...signed.snapshot, issues: [{ id: issueId, issueType: "ruleConflict", description: "尺寸冲突。", status: "open", blocksProxyOutcome: true }] } };
    expect(collectDeliveryBlockerDetails(hard as unknown as ProjectHead, geometry, [artifact], checkRun).some((item) => item.sourceType === "issue")).toBe(true);

    const l1 = { ...signed, snapshot: { ...signed.snapshot, reviewSignoffs: [{ ...(signed.snapshot.reviewSignoffs[0] as Record<string, unknown>), l1Eligible: true }] } };
    expect(collectDeliveryBlockerDetails(l1 as unknown as ProjectHead, geometry, [artifact], checkRun).map((item) => item.code)).not.toContain("L1_ELIGIBILITY_FALSE");
  });
});
