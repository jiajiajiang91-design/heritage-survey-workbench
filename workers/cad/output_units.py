from __future__ import annotations

from decimal import Decimal
from typing import Any


OUTPUT_UNITS = {"mm": 1.0, "cm": 10.0, "m": 1000.0}
DXF_UNIT_CODES = {"mm": 4, "cm": 5, "m": 6}
IFC_UNIT_PREFIXES = {"mm": "MILLI", "cm": "CENTI", "m": None}


def output_unit(value: dict[str, Any]) -> str:
    unit = value.get("outputUnit", "mm")
    if not isinstance(unit, str) or unit not in OUTPUT_UNITS:
        raise ValueError("outputUnit must be mm, cm or m")
    return unit


def length_text(value_mm: float, unit: str) -> str:
    converted = Decimal(str(value_mm)) / Decimal(str(OUTPUT_UNITS[unit]))
    text = format(converted, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text
