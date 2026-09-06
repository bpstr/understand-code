"""Validate the JSON Schema subset used by the bundled, closed input contracts.

No remote schema retrieval or executable schema extensions are supported.
"""
from importlib.resources import files
import json
import re


def check(value, schema: dict, location: str = "finding") -> None:
    kind = schema.get("type")
    types = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool}
    if kind and (not isinstance(value, types[kind]) or kind == "integer" and isinstance(value, bool)):
        raise ValueError(f"{location}: expected {kind}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{location}: value outside allowed vocabulary")
    if "const" in schema and (value != schema["const"] or type(value) is not type(schema["const"])):
        raise ValueError(f"{location}: unexpected constant")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 10**9):
            raise ValueError(f"{location}: string length outside contract")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise ValueError(f"{location}: invalid string format")
    if type(value) is int and value < schema.get("minimum", value):
        raise ValueError(f"{location}: below minimum")
    if isinstance(value, list):
        if len(value) > schema.get("maxItems", 10**9):
            raise ValueError(f"{location}: too many items")
        if schema.get("uniqueItems") and len({json.dumps(x, sort_keys=True) for x in value}) != len(value):
            raise ValueError(f"{location}: duplicate items")
        for i, item in enumerate(value):
            check(item, schema.get("items", {}), f"{location}[{i}]")
    if isinstance(value, dict):
        missing = set(schema.get("required", [])) - value.keys()
        if missing:
            raise ValueError(f"{location}: missing {sorted(missing)}")
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            if key in properties:
                check(item, properties[key], f"{location}.{key}")
            elif additional is False:
                raise ValueError(f"{location}: unsupported field {key}")
            elif isinstance(additional, dict):
                check(item, additional, f"{location}.{key}")


def validate_finding(value) -> None:
    schema = json.loads(files("understand_code").joinpath("resources/finding.schema.json").read_text())
    check(value, schema)
