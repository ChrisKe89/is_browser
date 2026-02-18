  const lowerFirst = (value) =>
    value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;

  const text = (value) => {
    if (!value) return null;
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const makeCssPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== "html") {
      const tag = current.tagName.toLowerCase();
      const id = current.getAttribute("id");
      if (id) {
        parts.unshift(`#${id}`);
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }

      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  };

  const inHelpTip = (element) =>
    Boolean(element.closest("#loginHelptip, #appsHelptip, .xux-helptipPopup"));

  const findSection = (element) => {
    const section = element.closest("section, article, form");
    if (!section) return null;

    const heading = section.querySelector(".xux-section-title-text, h1, h2, h3, legend");
    const headingText = text(heading?.textContent);
    if (headingText) return headingText;

    const sectionId = section.getAttribute("id");
    return sectionId ? `#${sectionId}` : null;
  };

  const inferDependency = (modalContainer) => {
    if (!modalContainer) return null;
    const id = modalContainer.getAttribute("id");
    if (!id) return null;

    let stem = id
      .replace(/^open/i, "")
      .replace(/(ModalWindow|ModalRoot|ModalContent|Modal)$/i, "")
      .replace(/SettingRoot$/i, "")
      .replace(/Root$/i, "");
    stem = lowerFirst(stem);
    if (!stem) return null;

    const candidates = [
      stem,
      `${stem}Button`,
      `${stem}Link`,
      `${stem}Settings`,
      `open${stem[0]?.toUpperCase() ?? ""}${stem.slice(1)}ModalWindow`
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (document.getElementById(candidate)) return `#${candidate}`;
    }

    const fuzzy = Array.from(document.querySelectorAll("[id]"))
      .filter((el) => !/modal/i.test(el.id))
      .find((el) => el.id.toLowerCase().includes(stem.toLowerCase()));

    return fuzzy?.id ? `#${fuzzy.id}` : null;
  };

  const findModalContext = (element) => {
    const modalContainer =
      element.closest("[id$='ModalWindow'], [id^='open'][id*='Modal'], [id*='ModalWindow'][id]") ??
      element.closest("[role='dialog']")?.closest("[id*='Modal'][id]") ??
      element.closest("[role='dialog']");
    if (!modalContainer) return { context: "main", dependency: null };

    const dialog = element.closest("[role='dialog']") ?? modalContainer.querySelector("[role='dialog']");
    const titleEl = dialog?.querySelector(".xux-modalWindow-title-text") ?? modalContainer.querySelector(".xux-modalWindow-title-text");
    const title = text(titleEl?.textContent);
    const modalId = modalContainer.getAttribute("id");
    const context = title
      ? `modal:${title}`
      : modalId
        ? `modal:#${modalId}`
        : "modal:unknown";

    return { context, dependency: inferDependency(modalContainer) };
  };

  const findLabel = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      const ariaLabel = text(element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;

      if (element.labels && element.labels.length > 0) {
        const first = text(element.labels[0].textContent);
        if (first) return first;
      }

      const ariaLabelledBy = element.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const parts = ariaLabelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter((node) => Boolean(node));
        const joined = text(parts.map((node) => node.innerText).join(" "));
        if (joined) return joined;
      }
    }

    const labelInBox = element.closest(".xux-labelableBox")?.querySelector(".xux-labelableBox-label");
    const labelText = text(labelInBox?.textContent);
    if (labelText) return labelText;

    return null;
  };

  const settings = [];

  const controls = Array.from(document.querySelectorAll("input, select, textarea"));
  for (const node of controls) {
    if (inHelpTip(node)) continue;

    if (node instanceof HTMLInputElement) {
      const type = (node.type || "text").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) continue;

      if (!node.id && node.classList.contains("ui-spinner-input")) continue;

      const { context, dependency } = findModalContext(node);
      const label = findLabel(node);
      const section = findSection(node);

      let kind = "text";
      if (type === "password") kind = "password";
      if (type === "number") kind = "number";
      if (type === "checkbox") kind = "checkbox";
      if (type === "radio") kind = "radio";

      const selector = node.id ? `#${node.id}` : node.name ? `${node.tagName.toLowerCase()}[name="${node.name}"]` : makeCssPath(node);
      settings.push({
        node,
        kind,
        id: node.id || null,
        name: node.name || null,
        label,
        section,
        context,
        dependency,
        selector,
        cssPath: makeCssPath(node),
        value: kind === "checkbox" || kind === "radio" ? String(node.checked) : node.value ?? null,
        checked: kind === "checkbox" || kind === "radio" ? node.checked : null,
        disabled: node.disabled,
        visible: isVisible(node)
      });
      continue;
    }

    if (node instanceof HTMLSelectElement) {
      const { context, dependency } = findModalContext(node);
      const label = findLabel(node);
      const section = findSection(node);

      const options = Array.from(node.options).map((opt) => ({
        value: opt.value,
        text: text(opt.textContent) ?? "",
        selected: opt.selected
      }));

      const selected = options.find((opt) => opt.selected)?.value ?? node.value ?? null;

      const selector = node.id ? `#${node.id}` : node.name ? `${node.tagName.toLowerCase()}[name="${node.name}"]` : makeCssPath(node);
      settings.push({
        node,
        kind: "select",
        id: node.id || null,
        name: node.name || null,
        label,
        section,
        context,
        dependency,
        selector,
        cssPath: makeCssPath(node),
        value: selected,
        checked: null,
        options,
        disabled: node.disabled,
        visible: isVisible(node)
      });
      continue;
    }

    if (node instanceof HTMLTextAreaElement) {
      const { context, dependency } = findModalContext(node);
      const label = findLabel(node);
      const section = findSection(node);

      const selector = node.id ? `#${node.id}` : node.name ? `${node.tagName.toLowerCase()}[name="${node.name}"]` : makeCssPath(node);
      settings.push({
        node,
        kind: "textarea",
        id: node.id || null,
        name: node.name || null,
        label,
        section,
        context,
        dependency,
        selector,
        cssPath: makeCssPath(node),
        value: node.value ?? null,
        checked: null,
        disabled: node.disabled,
        visible: isVisible(node)
      });
    }
  }

  const actionRows = Array.from(
    document.querySelectorAll(
      ".xux-staticTextBox[role='button'], .xux-labelableBox[role='button']"
    )
  );

  for (const node of actionRows) {
    if (inHelpTip(node)) continue;

    const id = node.getAttribute("id");
    if (!id) continue;
    if (id.startsWith("globalnav")) continue;

    const label = text(
      node.querySelector(".xux-labelableBox-label")?.textContent ?? null
    );
    if (!label) continue;

    const value = text(node.querySelector(".xux-labelableBox-content")?.textContent ?? "");
    const { context, dependency } = findModalContext(node);
    const modalOpener = /^open.+modal/i.test(id) && !node.closest("[role='dialog']");
    const finalContext = modalOpener ? "main" : context;
    const finalDependency = modalOpener ? null : dependency;

    settings.push({
      node,
      kind: "staticTextButton",
      id,
      name: null,
      label,
      section: findSection(node),
      context: finalContext,
      dependency: finalDependency,
      selector: `#${id}`,
      cssPath: makeCssPath(node),
      value,
      checked: null,
      disabled: node.classList.contains("ui-state-disabled"),
      visible: isVisible(node)
    });
  }

  const actionButtons = Array.from(document.querySelectorAll("button"));
  for (const node of actionButtons) {
    if (inHelpTip(node)) continue;

    const id = node.getAttribute("id");
    if (!id) continue;
    if (id.startsWith("globalnav")) continue;

    const label = text(
      node.querySelector(".xux-button-text")?.textContent ?? node.textContent ?? null
    );
    if (!label) continue;

    const { context, dependency } = findModalContext(node);

    settings.push({
      node,
      kind: "action",
      id,
      name: node.getAttribute("name"),
      label,
      section: findSection(node),
      context,
      dependency,
      selector: `#${id}`,
      cssPath: makeCssPath(node),
      value: null,
      checked: null,
      disabled: node.disabled || node.getAttribute("aria-disabled") === "true",
      visible: isVisible(node)
    });
  }

  settings.sort((a, b) => {
    if (a.node === b.node) return 0;
    const pos = a.node.compareDocumentPosition(b.node);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const deduped = [];
  const seen = new Set();

  for (const setting of settings) {
    const key = `${setting.kind}|${setting.id ?? ""}|${setting.name ?? ""}|${setting.label ?? ""}|${setting.cssPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(setting);
  }

  return {
    title: document.title,
    settings: deduped.map((setting, index) => ({
      order: index + 1,
      kind: setting.kind,
      id: setting.id,
      name: setting.name,
      label: setting.label,
      section: setting.section,
      context: setting.context,
      dependency: setting.dependency,
      selector: setting.selector,
      cssPath: setting.cssPath,
      value: setting.value,
      checked: setting.checked,
      options: setting.options,
      disabled: setting.disabled,
      visible: setting.visible
    }))
  };
