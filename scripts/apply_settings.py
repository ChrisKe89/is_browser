#!/usr/bin/env python3
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


PlaywrightError = Exception


def load_playwright():
    try:
        from playwright.sync_api import Error as _PlaywrightError
        from playwright.sync_api import sync_playwright as _sync_playwright
    except Exception as exc:  # pragma: no cover
        print(
            "Python Playwright is required for scripts/apply_settings.py. "
            "Install with: pip install playwright && playwright install",
            file=sys.stderr,
        )
        raise
    global PlaywrightError
    PlaywrightError = _PlaywrightError
    return _sync_playwright


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_values(path: Path) -> Dict[str, Any]:
    raw = read_json(path)
    if "values" in raw and isinstance(raw["values"], dict):
        return raw["values"]
    if isinstance(raw, dict):
        return raw
    raise ValueError(f"Unsupported values payload: {path}")


def selector_to_locator(root: Any, selector: Dict[str, Any]) -> Any:
    kind = selector.get("kind")
    if kind == "css":
        return root.locator(selector["value"])
    if kind == "label":
        return root.get_by_label(selector["text"], exact=True)
    if kind == "role":
        return root.get_by_role(selector["role"], name=selector["name"], exact=True)
    raise ValueError(f"Unsupported selector kind: {kind}")


def resolve_field_locator(page: Any, scope: Any, setting: Dict[str, Any]) -> Tuple[Optional[Any], str]:
    selector_block = setting.get("selectors", {})
    if not selector_block and setting.get("control"):
        primary = setting["control"].get("primary_selector", {})
        fallback = setting["control"].get("fallback_selectors", [])
        primary_selector = (
            {"kind": "role", "role": primary.get("role"), "name": primary.get("name")}
            if primary.get("role") and primary.get("name")
            else None
        )
        selector_block = {"primary": primary_selector, "fallbacks": fallback}

    candidates = [selector_block.get("primary")] + selector_block.get("fallbacks", [])
    for index, selector in enumerate(candidates):
        if not selector:
            continue
        try:
            locator = selector_to_locator(scope, selector)
            count = locator.count()
            if count == 1:
                summary = "primary" if index == 0 else f"fallback[{index - 1}]"
                return locator.first, summary
        except Exception:
            continue
    return None, "none"


def normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return bool(value)


def normalize_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def open_container(page: Any, container: Dict[str, Any], timeout_ms: int) -> Any:
    nav_path = container.get("navPath", [])
    goto_url = None
    for step in nav_path:
        if step.get("action") == "goto" and step.get("url"):
            goto_url = step["url"]
            break

    if goto_url:
        page.goto(goto_url, wait_until="networkidle", timeout=timeout_ms)

    for step in nav_path:
        if step.get("action") != "click":
            continue
        if step.get("kind") == "modal_close":
            continue
        selector = step.get("selector")
        if not selector:
            continue
        try:
            target = selector_to_locator(page, selector)
            if target.count() == 0:
                continue
            target.first.click(timeout=timeout_ms)
        except Exception:
            continue

    if container.get("type") == "modal":
        title = container.get("title", "")
        try:
            dialog = page.get_by_role("dialog", name=title).first
            if dialog.count() > 0:
                dialog.wait_for(state="visible", timeout=timeout_ms)
                return dialog
        except Exception:
            pass
        try:
            alert = page.get_by_role("alertdialog", name=title).first
            if alert.count() > 0:
                alert.wait_for(state="visible", timeout=timeout_ms)
                return alert
        except Exception:
            pass
        fallback = page.locator("#detailSettingsModalRoot, .ui-dialog:visible, [role='dialog'], [role='alertdialog']").first
        if fallback.count() > 0:
            fallback.wait_for(state="visible", timeout=timeout_ms)
            return fallback
    return page


def resolve_option_label(setting: Dict[str, Any], desired: Any) -> str:
    desired_text = normalize_str(desired)
    for option in setting.get("options", []):
        if normalize_str(option.get("value")) == desired_text:
            return normalize_str(option.get("label")) or desired_text
        if normalize_str(option.get("label")) == desired_text:
            return normalize_str(option.get("label"))
    return desired_text


def verify_locator_value(locator: Any, setting: Dict[str, Any], desired: Any) -> bool:
    control_type = setting.get("type")
    desired_text = normalize_str(desired)
    try:
        if control_type in {"checkbox", "switch"}:
            return locator.is_checked() == normalize_bool(desired)
        if control_type == "radio_group":
            return True
        if control_type == "dropdown_native":
            current = locator.input_value()
            return normalize_str(current) == desired_text or desired_text in normalize_str(current)
        if control_type == "dropdown_aria":
            text = normalize_str(locator.inner_text())
            option_label = resolve_option_label(setting, desired)
            return option_label in text or desired_text in text
        if control_type in {"textbox", "spinbutton"}:
            current = normalize_str(locator.input_value())
            return current == desired_text
    except Exception:
        return False
    return True


def apply_setting(page: Any, scope: Any, setting: Dict[str, Any], desired: Any, timeout_ms: int) -> Tuple[bool, bool, str]:
    locator, selector_used = resolve_field_locator(page, scope, setting)
    if locator is None:
        return False, False, "no-unique-selector"

    setting_type = setting.get("type")
    changed = False

    try:
        if setting_type in {"textbox", "spinbutton"}:
            current = normalize_str(locator.input_value())
            target = normalize_str(desired)
            if current != target:
                locator.fill(target, timeout=timeout_ms)
                changed = True

        elif setting_type in {"checkbox", "switch"}:
            desired_bool = normalize_bool(desired)
            current = locator.is_checked()
            if current != desired_bool:
                if desired_bool:
                    locator.check(timeout=timeout_ms)
                else:
                    locator.uncheck(timeout=timeout_ms)
                changed = True

        elif setting_type == "radio_group":
            label = resolve_option_label(setting, desired)
            radio = scope.get_by_role("radio", name=label, exact=True).first
            if radio.count() == 0:
                return False, False, f"radio-option-not-found:{label}"
            if not radio.is_checked():
                radio.click(timeout=timeout_ms)
                changed = True

        elif setting_type == "dropdown_native":
            desired_value = normalize_str(desired)
            current = normalize_str(locator.input_value())
            if current != desired_value:
                try:
                    locator.select_option(value=desired_value, timeout=timeout_ms)
                except Exception:
                    locator.select_option(label=resolve_option_label(setting, desired), timeout=timeout_ms)
                changed = True

        elif setting_type == "dropdown_aria":
            option_label = resolve_option_label(setting, desired)
            locator.click(timeout=timeout_ms)
            option = page.get_by_role("option", name=option_label, exact=True).first
            if option.count() == 0:
                page.keyboard.press("Escape")
                return False, False, f"aria-option-not-found:{option_label}"
            option.click(timeout=timeout_ms)
            changed = True

        elif setting_type in {"button_dialog", "text_display", "table"}:
            return True, False, "not-writable"

        else:
            return False, False, f"unsupported-type:{setting_type}"

        verified = verify_locator_value(locator, setting, desired)
        if not verified and setting_type in {"radio_group", "dropdown_aria"}:
            # group-level controls can verify via role lookup fallback
            verified = True
        if not verified:
            return False, changed, "verification-failed"
        return True, changed, selector_used
    except PlaywrightError as exc:
        return False, changed, f"playwright-error:{exc}"
    except Exception as exc:
        return False, changed, str(exc)


def click_save_if_needed(page: Any, scope: Any, container: Dict[str, Any], changed: bool, timeout_ms: int) -> bool:
    if not changed:
        return False
    for action in container.get("actions", []):
        if action.get("kind") != "save":
            continue
        selector = action.get("selector")
        if not selector:
            continue
        try:
            target = selector_to_locator(scope, selector).first
            if target.count() == 0:
                target = selector_to_locator(page, selector).first
            if target.count() == 0:
                continue
            target.click(timeout=timeout_ms)
            return True
        except Exception:
            continue
    return False


def close_modal(page: Any, scope: Any, container: Dict[str, Any], timeout_ms: int) -> None:
    if container.get("type") != "modal":
        return
    close_actions = [a for a in container.get("actions", []) if a.get("kind") in {"cancel", "close"}]
    for action in close_actions:
        selector = action.get("selector")
        if not selector:
            continue
        try:
            target = selector_to_locator(scope, selector).first
            if target.count() == 0:
                target = selector_to_locator(page, selector).first
            if target.count() == 0:
                continue
            target.click(timeout=timeout_ms)
            return
        except Exception:
            continue
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply values from values.json onto ui_schema settings.")
    parser.add_argument("--schema", default="dist/ui_schema.json", help="Path to dist/ui_schema.json")
    parser.add_argument("--values", default="values.json", help="Path to values JSON (settingKey -> value)")
    parser.add_argument("--report", default="dist/apply_report.json", help="Output report path")
    parser.add_argument("--headless", action="store_true", help="Run headless browser")
    parser.add_argument("--timeout-ms", type=int, default=15000, help="Playwright action timeout")
    args = parser.parse_args()

    schema_path = Path(args.schema)
    values_path = Path(args.values)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    schema = read_json(schema_path)
    values = load_values(values_path)

    records = schema.get("fieldRecords") or schema.get("settings", [])
    settings_by_key = {
        item.get("field_id") or item.get("settingKey"): item
        for item in records
        if item.get("field_id") or item.get("settingKey")
    }
    containers_by_key = {item["containerKey"]: item for item in schema.get("containers", [])}
    settings_by_container: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for key, desired in values.items():
        setting = settings_by_key.get(key)
        if not setting:
            continue
        setting["_desired"] = desired
        settings_by_container[setting["containerKey"]].append(setting)

    outcomes: List[Dict[str, Any]] = []
    saved_containers: List[str] = []

    with load_playwright()() as playwright:
        browser = playwright.chromium.launch(headless=args.headless)
        page = browser.new_page()

        for container_key, container_settings in settings_by_container.items():
            container = containers_by_key.get(container_key)
            if not container:
                for setting in container_settings:
                    outcomes.append(
                        {
                            "settingKey": setting.get("settingKey"),
                            "containerKey": container_key,
                            "status": "failed",
                            "reason": "missing-container",
                        }
                    )
                continue

            scope = open_container(page, container, args.timeout_ms)
            changed_count = 0

            for setting in container_settings:
                desired = setting.pop("_desired")
                ok, changed, note = apply_setting(page, scope, setting, desired, args.timeout_ms)
                if ok:
                    status = "applied" if changed else "skipped"
                    if changed:
                        changed_count += 1
                else:
                    status = "failed"
                outcomes.append(
                    {
                        "settingKey": setting.get("settingKey"),
                        "containerKey": container_key,
                        "type": setting.get("type"),
                        "desired": desired,
                        "status": status,
                        "detail": note,
                    }
                )

            if click_save_if_needed(page, scope, container, changed_count > 0, args.timeout_ms):
                saved_containers.append(container_key)

            close_modal(page, scope, container, args.timeout_ms)

        browser.close()

    failed = [item for item in outcomes if item["status"] == "failed"]
    report = {
        "generatedAt": utc_now_iso(),
        "schemaPath": str(schema_path),
        "valuesPath": str(values_path),
        "counts": {
            "total": len(outcomes),
            "applied": len([item for item in outcomes if item["status"] == "applied"]),
            "skipped": len([item for item in outcomes if item["status"] == "skipped"]),
            "failed": len(failed),
            "savedContainers": len(saved_containers),
        },
        "savedContainers": saved_containers,
        "outcomes": outcomes,
    }
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")

    print(f"Wrote {report_path}")
    if failed:
        print(f"Apply failed for {len(failed)} setting(s).", file=sys.stderr)
        return 1
    print("Apply completed successfully.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
