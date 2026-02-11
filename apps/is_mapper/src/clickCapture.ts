import { type Page } from "playwright";

export type CapturedClickKind =
  | "tab"
  | "link"
  | "button"
  | "menu"
  | "row"
  | "icon"
  | "radio_select"
  | "dropdown_trigger"
  | "combobox"
  | "modal_open"
  | "modal_close"
  | "dismiss_alert"
  | "system_alert"
  | "unknown";

export type CapturedClick = {
  timestamp: string;
  target: string;
  kind?: CapturedClickKind;
  selectors: Array<{ kind: "role" | "label" | "css"; role?: string; name?: string; value?: string }>;
  urlBefore: string;
  frameUrl?: string;
  frameName?: string;
  inFrame?: boolean;
  elementId?: string;
};

type ClickBinding = (payload: CapturedClick) => void;

declare global {
  interface Window {
    __isMapperRecordClick?: (payload: CapturedClick) => void;
  }
  interface Document {
    __isMapperClickInstalled?: boolean;
  }
}

const CAPTURE_SCRIPT = `
(() => {
  if (document.__isMapperClickInstalled) return;
  document.__isMapperClickInstalled = true;

  const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();

  const cssPath = (element) => {
    const parts = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === Node.ELEMENT_NODE && depth < 4; depth += 1) {
      const tag = node.tagName.toLowerCase();
      const id = node.getAttribute("id");
      if (id) {
        parts.unshift(\`#\${String(id).replace(/"/g, '\\\\"')}\`);
        break;
      }
      const className = normalize(node.className).split(" ").filter(Boolean)[0];
      parts.unshift(className ? \`\${tag}.\${className}\` : tag);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const summarizeTarget = (element) => {
    const text = normalize(
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("title")
    );
    if (text) return text.slice(0, 200);
    return normalize(element.tagName.toLowerCase());
  };

  const selectorsFor = (element) => {
    const selectors = [];
    const inferImplicitRole = () => {
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "option") return "option";
      if (tag === "input" && type === "radio") return "radio";
      if (tag === "input" && type === "checkbox") return "checkbox";
      if (tag === "input" || tag === "textarea") return "textbox";
      return "";
    };

    const role = (element.getAttribute("role") || inferImplicitRole() || "").toLowerCase();
    const name = normalize(
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("title")
    );
    if (role && name) {
      selectors.push({ kind: "role", role: role.toLowerCase(), name: name.slice(0, 200) });
    }

    const label = normalize(element.getAttribute("aria-label"));
    if (label) {
      selectors.push({ kind: "label", value: label.slice(0, 200) });
    }

    const css = cssPath(element);
    if (css) {
      selectors.push({ kind: "css", value: css });
    }

    return selectors;
  };

  const inferKind = (element) => {
    const text = normalize(
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("title")
    ).toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();

    const alertRoot = element.closest("[id*='securityalert' i], [class*='securityalert' i], [data-testid*='securityalert' i], [role='alertdialog']");
    const alertProbe = normalize(
      alertRoot?.getAttribute("id") ||
      alertRoot?.getAttribute("class") ||
      alertRoot?.textContent ||
      ""
    ).toLowerCase();
    if (alertRoot && (alertProbe.includes("securityalert") || alertProbe.includes("security") || alertProbe.includes("certificate"))) {
      return "system_alert";
    }

    if (role === "radio" || (tag === "input" && type === "radio")) return "radio_select";
    if (role === "combobox" || tag === "select") return "combobox";
    if (role === "option") return "dropdown_trigger";
    if (role === "tab") return "tab";
    if (role === "menuitem") return "menu";
    if (role === "link" || tag === "a") return "link";
    if (text && /^(cancel|close|done|ok)$/i.test(text)) return "modal_close";
    if (text && /(details|advanced|settings|summary|edit)/i.test(text) && (role === "button" || tag === "button" || role === "link" || tag === "a")) {
      return "modal_open";
    }
    if (role === "button" || tag === "button") return "button";
    if (tag === "tr" || role === "row") return "row";
    return "unknown";
  };

  document.addEventListener("click", (event) => {
    const rawTarget = event.target;
    const target =
      rawTarget instanceof Element
        ? rawTarget
        : rawTarget instanceof Node
          ? rawTarget.parentElement
          : null;
    if (!target) return;
    const interactive =
      target.closest(
        "button, a, input, select, textarea, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [role='combobox'], [role='checkbox'], [role='radio']"
      ) || target;
    if (typeof window.__isMapperRecordClick !== "function") return;

    window.__isMapperRecordClick({
      timestamp: new Date().toISOString(),
      target: summarizeTarget(interactive),
      kind: inferKind(interactive),
      selectors: selectorsFor(interactive),
      urlBefore: window.location.href,
      frameUrl: window.location.href,
      frameName: window.name || undefined,
      inFrame: window.self !== window.top,
      elementId: interactive.getAttribute("id") || undefined
    });
  }, true);
})();
`;

export class ClickCaptureQueue {
  private queue: CapturedClick[] = [];

  poll(): CapturedClick | undefined {
    return this.queue.shift();
  }

  size(): number {
    return this.queue.length;
  }

  push(click: CapturedClick): void {
    this.queue.push(click);
  }

  unshift(click: CapturedClick): void {
    this.queue.unshift(click);
  }
}

export async function installClickCapture(page: Page, onClick: ClickBinding): Promise<void> {
  const installInFrame = async (frame: import("playwright").Frame): Promise<void> => {
    await frame.evaluate((script: string) => {
      // eslint-disable-next-line no-eval
      eval(script);
    }, CAPTURE_SCRIPT).catch(() => null);
  };

  await page.exposeFunction("__isMapperRecordClick", (payload: CapturedClick) => {
    onClick(payload);
  });
  await page.addInitScript({ content: CAPTURE_SCRIPT });
  await page.evaluate((script: string) => {
    // eslint-disable-next-line no-eval
    eval(script);
  }, CAPTURE_SCRIPT);

  for (const frame of page.frames()) {
    await installInFrame(frame);
  }
  page.on("frameattached", (frame) => {
    void installInFrame(frame);
  });
  page.on("framenavigated", (frame) => {
    void installInFrame(frame);
  });
}

export type ClickLogEntry = {
  index: number;
  timestamp: string;
  target: string;
  kind?: CapturedClickKind;
  selectors: CapturedClick["selectors"];
  urlBefore: string;
  urlAfter: string;
  frameUrl?: string;
  frameName?: string;
  inFrame?: boolean;
  elementId?: string;
  transitionType?: "navigate" | "open_modal" | "close_modal" | "tab_switch" | "dismiss_alert" | "expand_section";
  nodeIdBefore?: string;
  nodeIdAfter?: string;
  newFieldIds: string[];
  newlyVisibleFieldIds?: string[];
  newlyDiscoveredFieldIds?: string[];
  noLongerVisibleFieldIds?: string[];
  screenshotPath?: string;
};

export type ClickLogFile = {
  meta: {
    generatedAt: string;
    baseUrl: string;
    runPath: string;
    clickCount: number;
  };
  clicks: ClickLogEntry[];
};
