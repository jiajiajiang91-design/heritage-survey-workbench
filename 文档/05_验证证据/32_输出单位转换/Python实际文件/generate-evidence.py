import json,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
from workers.cad.project_geometry.test_output_units import unit_spec
from workers.cad.project_geometry.kernel import build_geometry_package
from workers.cad.project_geometry.verify_job import verify_geometry_package
from workers.cad.project_drawings.test_output_units import unit_matrix
from workers.cad.project_drawings.test_project_drawings import FONT
from workers.cad.project_drawings.build_package import build_package
from workers.cad.project_drawings.verify_package import verify,_expected_dimensions
import ezdxf
root=Path('.tmp/unit23-python-evidence')
for unit in ('mm','cm','m'):
 target=root/unit
 spec=unit_spec(unit)
 geometry=target/'geometry'
 if not geometry.exists():
  manifest=build_geometry_package(spec,geometry)
 else:
  manifest=json.loads((geometry/'manifest.json').read_text(encoding='utf-8'))
 requirement=unit_matrix(spec,manifest,unit)
 sp=target/'spec.json';mp=target/'matrix.json'
 sp.write_text(json.dumps(spec,ensure_ascii=False,sort_keys=True,indent=2),encoding='utf-8')
 mp.write_text(json.dumps(requirement,ensure_ascii=False,sort_keys=True,indent=2),encoding='utf-8')
 build_package(requirement,geometry,FONT,target/'drawings')
 gr=verify_geometry_package(spec,geometry)
 dr=verify(mp,geometry,target/'drawings',FONT)
 (target/'geometry-verification.json').write_text(json.dumps(gr,ensure_ascii=False,indent=2),encoding='utf-8')
 (target/'drawing-verification.json').write_text(json.dumps(dr,ensure_ascii=False,indent=2),encoding='utf-8')
 doc=ezdxf.readfile(target/'drawings/drawings.dxf')
 print(unit,'failures',[c['id'] for c in dr['checks'] if not c['passed']])
 for dim in doc.modelspace().query('DIMENSION'):
  print('measurement',dim.get_measurement(),'text',dim.dxf.text,'effective',[dim.override().get(a) for a in ('dimlfac','dimrnd','dimpost')],'rendered',[e.plain_text() for e in dim.virtual_entities() if e.dxftype()=='MTEXT'])
 print('expect',_expected_dimensions(requirement,json.loads((target/'drawings/drawing-ir.json').read_text(encoding='utf-8'))))
