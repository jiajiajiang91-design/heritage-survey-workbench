import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComponentList } from './ComponentList';
import { componentCandidateFixture } from '../test/component-candidate-fixture';
import type { EvidencePane } from '../workbench/useEvidencePane';
vi.mock('../DraftGeometryViewer',()=>({DraftGeometryViewer:({component,onSelect}:{component:{stableKey:string};onSelect:(key:string)=>void})=><button type="button" onClick={()=>onSelect(component.stableKey)}>选择临时形体</button>}));
vi.mock('../shell/EvidencePane',()=>({EvidencePane:({location}:{location:unknown})=><output data-testid="source-region">{JSON.stringify(location)}</output>}));
afterEach(cleanup);
it('参数标注区域与构件候选区域分别定位，选形体后恢复构件区域',async()=>{
  const test=await componentCandidateFixture();
  const snapshot=structuredClone(test.head.snapshot);
  const candidate=snapshot.candidates.find(c=>c.id===test.candidate.id)!;
  if(candidate.structured?.kind!=='measurementTranscription') throw new Error('fixture');
  candidate.structured.dimensions[1]!.region={x:.2,y:.3,width:.1,height:.1};
  const pane={activeEvidenceId:snapshot.evidences[0]!.id,setActiveEvidenceId:vi.fn(),setImageSelection:vi.fn()} as unknown as EvidencePane;
  render(<ComponentList snapshot={snapshot} objects={[]} unknowns={[]} pane={pane} typeLabel={value=>value}
    selectedObjectId={null} onSelectObject={vi.fn()} onOpenInModel={vi.fn()} signedOff={false} onSaveComponent={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'完善识别构件：内部墙体'}));
  fireEvent.change(screen.getByLabelText('X 向长度来源'),{target:{value:'candidate:'+candidate.id+':1'}});
  fireEvent.change(screen.getByLabelText('Y 向长度（mm）'),{target:{value:'240'}});
  fireEvent.change(screen.getByLabelText('Z 向长度（mm）'),{target:{value:'3000'}});
  for(const [label,value] of [['X 坐标','3000'],['Y 坐标','120'],['Z 坐标','1500']]) fireEvent.change(screen.getByLabelText(label!),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'预览待核对形体'}));
  fireEvent.click(screen.getAllByRole('button',{name:'查看参数原件：内部测试尺寸.txt'})[0]!);
  expect(JSON.parse(screen.getByTestId('source-region').textContent!)).toEqual(candidate.structured.dimensions[1]!.region);
  fireEvent.click(screen.getByRole('button',{name:'选择临时形体'}));
  expect(JSON.parse(screen.getByTestId('source-region').textContent!)).toEqual({x:.1,y:.1,width:.4,height:.5});
});
