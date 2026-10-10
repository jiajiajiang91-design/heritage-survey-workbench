import contextlib,hashlib,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
from workers.cad.project_geometry import test_output_units as geometry_tests
from workers.cad.project_drawings import test_output_units as drawing_tests
root=Path('.tmp/unit23-python-evidence')
events=[]
real_geometry=geometry_tests.verify_geometry_package
real_drawing=drawing_tests.verify

def capture_geometry(*args,**kwargs):
 result=real_geometry(*args,**kwargs)
 events.append({'format':'IFC','failedChecks':result['failedChecks'],'failures':result['failures']})
 return result

def capture_drawing(*args,**kwargs):
 result=real_drawing(*args,**kwargs)
 events.append({'format':'drawing','failedChecks':result['failedCheckCount'],'failures':[c['id'] for c in result['checks'] if not c['passed']]})
 return result
geometry_tests.verify_geometry_package=capture_geometry
drawing_tests.verify=capture_drawing
suite=unittest.TestSuite([
 geometry_tests.GeometryOutputUnitTests('test_independent_ifc_verifier_rejects_each_unit_and_vertex_tamper_after_rehash'),
 drawing_tests.DrawingOutputUnitTests('test_rehashed_single_file_tampers_are_rejected_and_restored')])
with (root/'tamper-tests.log').open('w',encoding='utf-8') as log:
 with contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):
  result=unittest.TextTestRunner(stream=log,verbosity=2).run(suite)
names=['IFC单独单位声明','IFC单个顶点','DXF单独单位声明','DXF单条原生结构线坐标','DIMENSION实际显示文字','DIMENSION有效测量倍率','SVG长度文字','PNG长度文字像素','PDF纸面比例变换']
assert result.wasSuccessful()
assert len(events)==len(names)*2,(len(events),events)
rows=[]
for index,name in enumerate(names):
 failed,restored=events[index*2:index*2+2]
 assert failed['failedChecks']>0 and restored['failedChecks']==0
 rows.append({'篡改项':name,'篡改回读':failed,'原文件恢复后回读':restored})
(root/'tamper-restoration.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'tamperCases':len(rows),'allRejected':True,'allRestoredPassed':True},ensure_ascii=False))

