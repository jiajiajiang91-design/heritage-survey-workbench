from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import ezdxf
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import FloatObject

from workers.cad.output_units import length_text
from workers.cad.project_geometry.kernel import build_geometry_package
from workers.cad.project_geometry.test_output_units import unit_spec

from .build_package import build_package
from .contracts import DrawingContractError, validate_artifact_matrix
from .test_project_drawings import FONT, matrix
from .verify_package import SVG_NS, verify


def unit_matrix(source: dict, manifest: dict, unit: str | None = None) -> dict:
    requirement = matrix(source, manifest, "one-sheet")
    view = requirement["views"][1]
    view["scaleDenominator"] = 50
    view["viewportRectMm"] = [20, 80, 540, 280]
    view["annotationPlan"] = {
        "axes": [{"along": "u", "label": label, "positionMm": position, "basisZh": "单位转换合成测试", "sourceEntityIds": [source["objects"][0]["id"]]} for label, position in (("1", -2800), ("2", 3300.5))],
        "levels": [{"label": "测试标高", "elevationMm": 1500.5, "basisZh": "单位转换合成测试", "sourceEntityIds": [source["objects"][0]["id"]]}],
    }
    requirement["views"] = [view]
    requirement["sheets"][0]["viewIds"] = [view["id"]]
    requirement["sheets"][0]["pageMm"] = [594, 420]
    if unit is not None:
        requirement["outputUnit"] = unit
    return requirement


def rehash_drawing_asset(output: Path, file_name: str) -> None:
    path = output / file_name
    record_path = output / "drawing-build-record.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    asset = next(item for item in record["assets"] if item["fileName"] == file_name)
    asset["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    asset["byteLength"] = path.stat().st_size
    record_path.write_text(json.dumps(record, ensure_ascii=False, sort_keys=True), encoding="utf-8")


class DrawingOutputUnitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.packages = {}
        for unit in ("mm", "cm", "m"):
            target = cls.root / unit
            source = unit_spec(unit)
            manifest = build_geometry_package(source, target / "geometry")
            requirement = unit_matrix(source, manifest, unit)
            matrix_path = target / "matrix.json"
            matrix_path.write_text(json.dumps(requirement, ensure_ascii=False), encoding="utf-8")
            build_package(requirement, target / "geometry", FONT, target / "drawings")
            cls.packages[unit] = target

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_three_native_units_dimensions_text_and_paper_scale(self) -> None:
        for unit, unit_code, divisor in (("mm", 4, 1), ("cm", 5, 10), ("m", 6, 1000)):
            target = self.packages[unit]
            output = target / "drawings"
            result = verify(target / "matrix.json", target / "geometry", output, FONT)
            self.assertEqual(result["failedCheckCount"], 0, result["checks"])
            doc = ezdxf.readfile(output / "drawings.dxf")
            self.assertEqual(doc.header["$INSUNITS"], unit_code)
            dimension = next(iter(doc.modelspace().query("DIMENSION")))
            self.assertAlmostEqual(dimension.get_measurement(), 6100.5 / divisor, places=8)
            self.assertEqual([item.plain_text() for item in dimension.virtual_entities() if item.dxftype() == "MTEXT"], [f"{length_text(6100.5, unit)} {unit}"])
            layout = doc.layouts.get("P-01")
            viewport = next(item for item in layout.query("VIEWPORT") if item.dxf.id > 1)
            self.assertAlmostEqual(dimension.get_measurement() * viewport.dxf.height / viewport.dxf.view_height, 122.01, places=6)
            svg_root = ET.parse(output / "P-01.svg").getroot()
            svg_texts = ["".join(item.itertext()) for item in svg_root.iter(f"{SVG_NS}text")]
            expected = f"图形总宽 {length_text(6100.5, unit)} {unit}"
            self.assertIn(expected, svg_texts)
            self.assertIn("测试标高 1.500 m", svg_texts)
            self.assertIn(expected, PdfReader(output / "drawings.pdf").pages[0].extract_text())

    def test_optional_matrix_unit_is_not_injected_and_invalid_values_fail(self) -> None:
        source = unit_spec()
        manifest = json.loads((self.packages["mm"] / "geometry/manifest.json").read_text(encoding="utf-8"))
        requirement = unit_matrix(source, manifest)
        original = copy.deepcopy(requirement)
        validate_artifact_matrix(requirement, manifest)
        self.assertEqual(requirement, original)
        for invalid_unit in ("inch", None, 1, {}):
            requirement["outputUnit"] = invalid_unit
            with self.assertRaises(DrawingContractError):
                validate_artifact_matrix(requirement, manifest)
        for value, expected in ((6100.5, "610.05"), (1000, "100"), (0, "0")):
            self.assertEqual(length_text(value, "cm"), expected)

    def test_rehashed_single_file_tampers_are_rejected_and_restored(self) -> None:
        target = self.packages["cm"]
        output = target / "drawings"
        mutations = (("unit", "native-dxf-baseline"), ("coordinate", "native-output-coordinates"), ("dimension-display", "native-dimension-display"), ("dimension-factor", "native-dimension-display"), ("svg-text", "cross-format-text"), ("png-text", "png-dimension-text"), ("pdf-scale", "pdf-paper-scale"))
        for mutation, expected_check in mutations:
            file_name = "P-01.svg" if mutation == "svg-text" else "P-01.png" if mutation == "png-text" else "drawings.pdf" if mutation == "pdf-scale" else "drawings.dxf"
            path = output / file_name
            original = path.read_bytes()
            try:
                if mutation in {"unit", "coordinate", "dimension-display", "dimension-factor"}:
                    doc = ezdxf.readfile(path)
                    if mutation == "unit":
                        doc.header["$INSUNITS"] = 4
                    elif mutation == "coordinate":
                        entity = next(iter(doc.modelspace().query('LINE[layer=="GJ-OUTLINE"]')))
                        entity.dxf.end = entity.dxf.end + (1, 0, 0)
                    elif mutation == "dimension-factor":
                        dimension = next(iter(doc.modelspace().query("DIMENSION")))
                        overrides = dimension.override()
                        overrides.update({"dimlfac": 10})
                        overrides.commit()
                    else:
                        dimension = next(iter(doc.modelspace().query("DIMENSION")))
                        text = next(item for item in doc.blocks[dimension.dxf.geometry] if item.dxftype() == "MTEXT")
                        text.text = "6100.5 cm"
                    doc.saveas(path)
                elif mutation == "svg-text":
                    path.write_text(path.read_text(encoding="utf-8").replace("图形总宽 610.05 cm", "图形总宽 6100.5 cm"), encoding="utf-8")
                elif mutation == "pdf-scale":
                    reader = PdfReader(path)
                    page = reader.pages[0]
                    content = page.get_contents()
                    operands = next(values for values, operator in content.operations if operator == b"cm")
                    operands[0] = FloatObject(float(operands[0]) * 0.9)
                    operands[3] = FloatObject(float(operands[3]) * 0.9)
                    page.replace_contents(content)
                    writer = PdfWriter()
                    writer.add_page(page)
                    with path.open("wb") as stream:
                        writer.write(stream)
                else:
                    root = ET.parse(output / "P-01.svg").getroot()
                    node = next(item for item in root.iter(f"{SVG_NS}text") if "".join(item.itertext()) == "图形总宽 610.05 cm")
                    with Image.open(path) as source:
                        image = source.copy()
                    x, y = float(node.attrib["x"]) * 300 / 25.4, float(node.attrib["y"]) * 300 / 25.4
                    ImageDraw.Draw(image).rectangle((x - 1000, y - 120, x + 1000, y + 40), fill="white")
                    image.save(path, dpi=(300, 300))
                rehash_drawing_asset(output, file_name)
                result = verify(target / "matrix.json", target / "geometry", output, FONT)
                self.assertTrue(any(item["id"] == expected_check and not item["passed"] for item in result["checks"]), mutation)
                self.assertTrue(next(item for item in result["checks"] if item["id"] == "asset-closure")["passed"], mutation)
            finally:
                path.write_bytes(original)
                rehash_drawing_asset(output, file_name)
            self.assertEqual(verify(target / "matrix.json", target / "geometry", output, FONT)["failedCheckCount"], 0, mutation)


if __name__ == "__main__":
    unittest.main()
