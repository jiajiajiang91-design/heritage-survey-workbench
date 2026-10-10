from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from .contracts import ContractError, geometry_spec_input_hash, validate_geometry_spec
from .kernel import build_geometry_package
from .test_project_geometry import box, spec_a
from .verify_job import verify_geometry_package

import ifcopenshell
import numpy as np
import trimesh


def unit_spec(unit: str | None = None) -> dict:
    source = spec_a()
    source["objects"] = [box("单位转换测试墙体", [250.25, 450.5, 1500], ["6100.5", "1200.25", "3000"], "wall")]
    source["interfaces"] = []
    source["unknowns"] = []
    if unit is not None:
        source["outputUnit"] = unit
    source["inputHash"] = geometry_spec_input_hash(source)
    return source


def rehash_asset(output: Path, kind: str) -> None:
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    asset = next(item for item in manifest["assets"] if item["kind"] == kind)
    path = output / asset["fileName"]
    asset["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    asset["byteLength"] = path.stat().st_size
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding="utf-8")


class GeometryOutputUnitTests(unittest.TestCase):
    def test_optional_unit_preserves_old_hash_and_validates_finite_values(self) -> None:
        source = unit_spec()
        previous = copy.deepcopy(source)
        self.assertIs(validate_geometry_spec(source), source)
        self.assertEqual(source, previous)
        self.assertNotIn("outputUnit", source)
        self.assertEqual(geometry_spec_input_hash(source), previous["inputHash"])
        for invalid_unit in ("inch", "MM", "", None, 1, {}):
            invalid = copy.deepcopy(source)
            invalid["outputUnit"] = invalid_unit
            invalid["inputHash"] = geometry_spec_input_hash(invalid)
            with self.assertRaises(ContractError):
                validate_geometry_spec(invalid)

    def test_ifc_physical_vertices_and_glb_metres_for_three_units(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            entities = []
            glb_files = []
            for unit, prefix, divisor in (("mm", "MILLI", 1), ("cm", "CENTI", 10), ("m", None, 1000)):
                source = unit_spec(unit)
                previous = copy.deepcopy(source)
                output = Path(temporary) / unit
                manifest = build_geometry_package(source, output)
                self.assertEqual(source, previous)
                report = verify_geometry_package(source, output)
                self.assertEqual(report["failedChecks"], 0, report)
                model = ifcopenshell.open(output / "model.ifc")
                length_unit = model.by_type("IfcSIUnit")[0]
                self.assertEqual(length_unit.Prefix, prefix)
                self.assertEqual(length_unit.Name, "METRE")
                vertices = np.asarray(model.by_type("IfcCartesianPointList3D")[0].CoordList)
                self.assertAlmostEqual(float(np.ptp(vertices[:, 0])), 6100.5 / divisor, places=8)
                self.assertTrue(np.allclose(vertices.min(axis=0) * divisor, [-2800, -149.625, 0], atol=1e-6))
                glb = trimesh.load(output / "model.glb", force="scene", process=False)
                mesh = next(iter(glb.geometry.values()))
                self.assertAlmostEqual(float(np.ptp(mesh.vertices[:, 0])), 6.1005, places=6)
                entities.append(manifest["entities"])
                glb_files.append((output / "model.glb").read_bytes())
            self.assertEqual(entities[0], entities[1])
            self.assertEqual(entities[1], entities[2])
            self.assertEqual(glb_files[0], glb_files[1])
            self.assertEqual(glb_files[1], glb_files[2])

    def test_independent_ifc_verifier_rejects_each_unit_and_vertex_tamper_after_rehash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "cm"
            source = unit_spec("cm")
            build_geometry_package(source, output)
            path = output / "model.ifc"
            original = path.read_bytes()
            for mutation in ("unit", "vertex"):
                model = ifcopenshell.open(path)
                if mutation == "unit":
                    model.by_type("IfcSIUnit")[0].Prefix = "MILLI"
                else:
                    point_list = model.by_type("IfcCartesianPointList3D")[0]
                    points = [list(point) for point in point_list.CoordList]
                    points[0][0] += 1
                    point_list.CoordList = points
                model.write(str(path))
                rehash_asset(output, "ifc")
                result = verify_geometry_package(source, output)
                self.assertGreater(result["failedChecks"], 0, mutation)
                self.assertTrue(any("IFC" in failure for failure in result["failures"]), mutation)
                path.write_bytes(original)
                rehash_asset(output, "ifc")
                self.assertEqual(verify_geometry_package(source, output)["failedChecks"], 0, mutation)


if __name__ == "__main__":
    unittest.main()
