import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceList } from "./EvidenceList";
import { ProjectSnapshotSchema } from "@gujian/domain";
import type { EvidencePane } from "../workbench/useEvidencePane";
afterEach(cleanup);
function props() {
  const projectId=crypto.randomUUID(),buildingId=crypto.randomUUID(),evidenceId=crypto.randomUUID(),assetId=crypto.randomUUID(),now=new Date().toISOString();
  const snapshot = ProjectSnapshotSchema.parse({schemaVersion:"3.0",project:{id:projectId,name:"内部测试",status:"active",locationText:null,createdAt:now},buildings:[{id:buildingId,projectId,name:"测试建筑",periodText:null,addressText:null,status:"existing"}],taskDefinitions:[{id:crypto.randomUUID(),name:"内部预览测试",scope:["内部交互测试"],regulationRefs:[],deliverables:["平面"],responsibilities:[{role:"surveyor",actorId:crypto.randomUUID()}],automationPolicyRef:null,confirmedAt:now,productionSetup:{buildingId,purpose:"existingSurvey",outputUnit:"mm",targets:["floorPlan"],projectGroup:"内部测试"}}],evidences:[{id:evidenceId,projectId,assetId,evidenceType:"drawing",title:"原图.tif",rightsDeclaration:null,intendedUse:null,recordedAt:null,relatedEntityRefs:[buildingId],dataStatus:"available"}],parseRecords:[{id:crypto.randomUUID(),projectId,assetId,evidenceId,parser:"test",parserVersion:"1.0.0",status:"pending",extractedText:null,warnings:[],createdAt:now}],entities:[],exclusionRecords:[],relations:[],observations:[],measurements:[],facts:[],candidates:[],issues:[],dependencyEdges:[],geometrySpecs:[],geometryRevisions:[],reviewSignoffs:[],adoptedRecordRefs:[]});
  const source = snapshot.evidences[0]!;
  const parse = snapshot.parseRecords[0]!;
  snapshot.evidences = [{ ...source, preparationLevel:"required",title:"图纸.tif" }, { ...source,id:crypto.randomUUID(),title:"失败图.tif",preparationLevel:"additional" }];
  snapshot.parseRecords = [{...parse,id:crypto.randomUUID(),evidenceId:source.id,readability:"readable",readableAs:"image",status:"metadataOnly",extractedText:null,warnings:[]}, {...parse,id:crypto.randomUUID(),evidenceId:snapshot.evidences[1]!.id,readability:"failed",status:"failed",extractedText:null,warnings:["本机服务未连接，请重试。"]}];
  const pane = {activeEvidenceId:null,setActiveEvidenceId:vi.fn(),activeEvidenceTitle:null,evidencePreview:null,imageSelection:null,setImageSelection:vi.fn(),downloadEvidence:vi.fn()} as EvidencePane;
  return {snapshot,pane,readableDrawingCount:1,modelRunning:false,onUpload:vi.fn().mockResolvedValue(undefined),onRetry:vi.fn().mockResolvedValue(undefined),processingEvidenceId:null as string|null,uploading:false,selectedIds:[source.id],onSelectionChange:vi.fn(),onTranscribe:vi.fn(),onGoToIssues:vi.fn()};
}
describe("资料处理页面",()=>{
  it("按最新记录显示结果、层级与具体失败，重试同一资料",()=>{
    const p=props();render(<EvidenceList {...p}/>);
    expect(screen.getByText("可读")).toBeInTheDocument();expect(screen.getByText("失败")).toBeInTheDocument();expect(screen.getByText("本机服务未连接，请重试。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"重试读取 失败图.tif"}));expect(p.onRetry).toHaveBeenCalledWith(p.snapshot.evidences[1]!.id);
    fireEvent.click(screen.getByRole("button",{name:"生成预览"}));expect(p.onTranscribe).toHaveBeenCalledWith([p.snapshot.evidences[0]!.id]);
    fireEvent.click(screen.getByLabelText("用于本次读取 图纸.tif")); expect(p.onSelectionChange).toHaveBeenCalledWith([]);
  });
  it("上传记录所选资料层级，清空文件控件且处理期间禁止重复",async()=>{
    const p=props();const {rerender}=render(<EvidenceList {...p}/>);
    fireEvent.change(screen.getByLabelText("资料层级"),{target:{value:"recommended"}});
    const file=new File(["note"],"资料.txt",{type:"text/plain"});fireEvent.change(screen.getByLabelText("上传原始资料文件"),{target:{files:[file]}});
    await waitFor(()=>expect(p.onUpload).toHaveBeenCalledWith([file],"recommended"));
    rerender(<EvidenceList {...p} processingEvidenceId={p.snapshot.evidences[1]!.id}/>);
    expect(screen.getByText("正在处理")).toBeInTheDocument();expect(screen.getByRole("button",{name:"重试读取 失败图.tif"})).toBeDisabled();expect(screen.getByRole("button",{name:"上传原始资料"})).toBeDisabled();
  });
});
