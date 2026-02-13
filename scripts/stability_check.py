#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_command(command: List[str], env: Dict[str, str] | None = None) -> None:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    result = subprocess.run(command, env=merged_env)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}")


def read_schema(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def schema_settings(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(schema.get("fieldRecords") or schema.get("settings") or [])


def setting_label(setting: Dict[str, Any]) -> str:
    if "label" in setting:
        return str(setting.get("label") or "")
    control = setting.get("control") or {}
    primary = control.get("primary_selector") or {}
    return str(primary.get("name") or "")


def setting_type(setting: Dict[str, Any]) -> str:
    return str(setting.get("type") or "")


def setting_id(setting: Dict[str, Any]) -> str:
    return str(setting.get("field_id") or setting.get("settingKey") or "")


def setting_signature(setting: Dict[str, Any]) -> str:
    if "field_id" in setting:
        control = setting.get("control") or {}
        group = setting.get("group") or {}
        container = setting.get("container") or {}
        context = setting.get("context") or {}
        return "|".join(
            [
                str(setting.get("page") or ""),
                "|".join((setting.get("breadcrumb") or [])),
                str(container.get("title") or ""),
                str(group.get("title") or ""),
                str(control.get("canonical_control_id") or ""),
                str(context.get("frame_url") or ""),
                str(context.get("modal_title") or ""),
                setting_type(setting),
            ]
        )
    return "|".join(
        [
            str(setting.get("containerKey") or ""),
            str(setting.get("groupTitle") or ""),
            setting_label(setting),
            setting_type(setting),
        ]
    )


def is_timestamp_field(setting: Dict[str, Any]) -> bool:
    label = setting_label(setting).lower()
    if "time" in label or "date" in label:
        return True
    value = ""
    if "value" in setting and isinstance(setting.get("value"), dict):
        value = str(setting["value"].get("current_value") or "")
    else:
        value = str(setting.get("currentValue") or "")
    return bool(
        value
        and (
            any(ch in value for ch in ["/", ":"])
            and any(ch.isdigit() for ch in value)
        )
    )


def dropdown_missing_options(settings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    failed: List[Dict[str, Any]] = []
    for item in settings:
        item_type = setting_type(item)
        if item_type not in {"dropdown_native", "dropdown_aria"}:
            continue
        options = item.get("options") or []
        if len(options) == 0:
            failed.append(
                {
                    "fieldId": setting_id(item),
                    "label": setting_label(item),
                    "reason": "dropdown has empty options[]",
                }
            )
    return failed


def radio_order_index(settings: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    index: Dict[str, List[str]] = {}
    for item in settings:
        if setting_type(item) != "radio_group":
            continue
        labels = [str(option.get("label") or option.get("value") or "") for option in (item.get("options") or [])]
        index[setting_signature(item)] = labels
    return index


def compare_schemas(first: Dict[str, Any], second: Dict[str, Any]) -> Dict[str, Any]:
    first_containers = {item["containerKey"]: item for item in first.get("containers", [])}
    second_containers = {item["containerKey"]: item for item in second.get("containers", [])}
    first_settings_list = schema_settings(first)
    second_settings_list = schema_settings(second)
    first_settings = {setting_id(item): item for item in first_settings_list if setting_id(item)}
    second_settings = {setting_id(item): item for item in second_settings_list if setting_id(item)}

    first_container_keys = set(first_containers.keys())
    second_container_keys = set(second_containers.keys())
    first_setting_keys = set(first_settings.keys())
    second_setting_keys = set(second_settings.keys())

    container_added = sorted(second_container_keys - first_container_keys)
    container_removed = sorted(first_container_keys - second_container_keys)
    setting_added = sorted(second_setting_keys - first_setting_keys)
    setting_removed = sorted(first_setting_keys - second_setting_keys)

    changed_labels_or_types: List[Dict[str, Any]] = []
    for key in sorted(first_setting_keys & second_setting_keys):
        first_item = first_settings[key]
        second_item = second_settings[key]
        first_label = setting_label(first_item)
        second_label = setting_label(second_item)
        first_type = setting_type(first_item)
        second_type = setting_type(second_item)
        if first_label != second_label or first_type != second_type:
            changed_labels_or_types.append(
                {
                    "settingKey": key,
                    "first": {"label": first_label, "type": first_type},
                    "second": {"label": second_label, "type": second_type},
                }
            )

    first_signature_map = {
        setting_signature(item): setting_id(item)
        for item in first_settings_list
        if setting_id(item) and not is_timestamp_field(item)
    }
    second_signature_map = {
        setting_signature(item): setting_id(item)
        for item in second_settings_list
        if setting_id(item) and not is_timestamp_field(item)
    }
    field_id_drift = []
    for signature in sorted(set(first_signature_map.keys()) & set(second_signature_map.keys())):
        if first_signature_map[signature] != second_signature_map[signature]:
            field_id_drift.append(
                {
                    "signature": signature,
                    "firstFieldId": first_signature_map[signature],
                    "secondFieldId": second_signature_map[signature],
                }
            )

    first_radio = radio_order_index(first_settings_list)
    second_radio = radio_order_index(second_settings_list)
    radio_ordering_changed = []
    for signature in sorted(set(first_radio.keys()) & set(second_radio.keys())):
        first_labels = first_radio[signature]
        second_labels = second_radio[signature]
        if first_labels == second_labels:
            continue
        if sorted(first_labels) == sorted(second_labels):
            radio_ordering_changed.append(
                {
                    "signature": signature,
                    "firstOrder": first_labels,
                    "secondOrder": second_labels,
                }
            )

    return {
        "containers": {
            "added": container_added,
            "removed": container_removed,
        },
        "settings": {
            "added": setting_added,
            "removed": setting_removed,
            "labelOrTypeChanged": changed_labels_or_types,
        },
        "fieldIdDrift": field_id_drift,
        "dropdownsMissingOptionsA": dropdown_missing_options(first_settings_list),
        "dropdownsMissingOptionsB": dropdown_missing_options(second_settings_list),
        "radioOrderingChangedWithoutLabelChange": radio_ordering_changed,
    }


def has_drift(diff: Dict[str, Any]) -> bool:
    return any(
        [
            bool(diff["containers"]["added"]),
            bool(diff["containers"]["removed"]),
            bool(diff["settings"]["added"]),
            bool(diff["settings"]["removed"]),
            bool(diff["settings"]["labelOrTypeChanged"]),
            bool(diff["fieldIdDrift"]),
            bool(diff["dropdownsMissingOptionsA"]),
            bool(diff["dropdownsMissingOptionsB"]),
            bool(diff["radioOrderingChangedWithoutLabelChange"]),
        ]
    )


def run_crawl_and_contract(run_root: Path, run_index: int) -> Path:
    run_dir = run_root / f"run-{run_index}"
    dist_dir = run_dir / "dist"
    map_path = run_dir / "printer-ui-map.json"
    run_dir.mkdir(parents=True, exist_ok=True)

    run_command(["make", "is-mapper-map"], env={"MAP_PATH": str(map_path)})
    run_command(["make", "is-mapper-contract"], env={"MAP_PATH": str(map_path), "DIST_DIR": str(dist_dir)})
    schema_path = dist_dir / "ui_schema.json"
    if not schema_path.exists():
        raise RuntimeError(f"Expected schema not found: {schema_path}")
    return schema_path


def resolve_schema_pair(args: argparse.Namespace) -> Tuple[Path, Path]:
    if args.run_crawl:
        temp_root = Path(tempfile.mkdtemp(prefix="ui-stability-"))
        first = run_crawl_and_contract(temp_root, 1)
        second = run_crawl_and_contract(temp_root, 2)
        return first, second

    if args.schema_a and args.schema_b:
        return Path(args.schema_a), Path(args.schema_b)

    default_a = Path("dist/ui_schema.baseline.json")
    default_b = Path("dist/ui_schema.json")
    if default_a.exists() and default_b.exists():
        return default_a, default_b

    raise RuntimeError(
        "Provide --schema-a/--schema-b, or use --run-crawl, or create dist/ui_schema.baseline.json + dist/ui_schema.json."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare two ui_schema captures and fail on field-id drift, empty dropdown options, or unstable radio option ordering."
    )
    parser.add_argument("--schema-a", help="First ui_schema.json path")
    parser.add_argument("--schema-b", help="Second ui_schema.json path")
    parser.add_argument(
        "--run-crawl",
        action="store_true",
        help="Run mapper crawl twice and compare resulting ui_schema outputs",
    )
    parser.add_argument(
        "--ui-changed",
        action="store_true",
        help="Allow drift without failing (still writes report)",
    )
    parser.add_argument(
        "--report",
        default="dist/stability_report.json",
        help="Output report path (default: dist/stability_report.json)",
    )
    args = parser.parse_args()

    first_path, second_path = resolve_schema_pair(args)
    first_schema = read_schema(first_path)
    second_schema = read_schema(second_path)
    diff = compare_schemas(first_schema, second_schema)
    drift = has_drift(diff)

    report = {
        "generatedAt": utc_now_iso(),
        "schemaA": str(first_path),
        "schemaB": str(second_path),
        "uiChangedFlag": bool(args.ui_changed),
        "driftDetected": drift,
        "diff": diff,
    }

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")

    print(f"Wrote {report_path}")
    if drift and not args.ui_changed:
        print("Stability check failed: key drift or label/type changes detected.")
        return 1

    print("Stability check passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
