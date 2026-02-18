export type Locator = {
  strategy: "role" | "css" | "id";
  role?: string;
  name?: string;
  selector: string;
  fallbackSelectors: string[];
};

export type EnumOption = {
  value: string;
  label: string;
};

export type ExtractedField = {
  fieldKey: string;
  sourceKeys: string[];
  label: string;
  controlType:
    | "text"
    | "number"
    | "checkbox"
    | "select"
    | "radio_group"
    | "textarea"
    | "text_display";
  valueType: "string" | "number" | "boolean" | "enum" | "none";
  sectionKey: string;
  sectionTitle: string;
  context: string;
  currentValue: unknown;
  disabled: boolean;
  options: EnumOption[];
  locator: Locator;
  orderHint: number;
  navPath: string[];
};

export type ExtractedAction = {
  actionKey: string;
  sourceKeys: string[];
  label: string;
  context: string;
  sectionKey: string;
  sectionTitle: string;
  locator: Locator;
  orderHint: number;
  navPath: string[];
};

export type ExtractedContainer = {
  containerKey: string;
  sourcePages: string[];
  title: string;
  contexts: string[];
  navPath: string[];
  fields: ExtractedField[];
  actions: ExtractedAction[];
};

export type ExtractedSchema = {
  version: string;
  generatedFrom: {
    deterministic: string[];
    capture: string[];
    navigation: string[];
    layout: string[];
  };
  summary: {
    containers: number;
    fields: number;
    actions: number;
    warnings: number;
  };
  warnings: string[];
  containers: ExtractedContainer[];
};

export type DeterministicSetting = {
  order?: number;
  key?: string;
  type?: string;
  label?: string;
  section?: string | null;
  context?: string;
  dependency?: string | null;
  selector?: string;
  dom_selector?: string;
  disabled?: boolean;
  current_value?: unknown;
  options?: string[];
};

export type DeterministicPage = {
  url: string;
  title?: string;
  settings?: DeterministicSetting[];
};

export type DeterministicInput = {
  pages?: DeterministicPage[];
};

export type CaptureOption = {
  value?: string;
  text?: string;
  selected?: boolean;
};

export type CaptureSetting = {
  order?: number;
  kind?: string;
  id?: string;
  name?: string | null;
  label?: string;
  section?: string | null;
  context?: string;
  dependency?: string | null;
  selector?: string;
  cssPath?: string;
  value?: string | null;
  checked?: boolean | null;
  disabled?: boolean;
  visible?: boolean;
  options?: CaptureOption[];
};

export type CapturePage = {
  url: string;
  title?: string;
  settings?: CaptureSetting[];
};

export type CaptureInput = {
  pages?: CapturePage[];
};

export type NavigationEdge = {
  click?: string;
  via?: string;
};

export type NavigationNode = {
  id?: string;
  title?: string;
  navPath?: NavigationEdge[];
};

export type NavigationInput = {
  navigation?: NavigationNode[];
};

export type LayoutField = {
  fieldKey?: string;
  controlType?: string;
  label?: string;
};

export type LayoutSection = {
  section?: string;
  fields?: LayoutField[];
};

export type LayoutNode = {
  id?: string;
  title?: string;
  sections?: LayoutSection[];
};

export type LayoutInput = {
  layout?: LayoutNode[];
};

export type NormalizedSetting = {
  pageId: string;
  pageTitle: string;
  sourceKey: string;
  type: string;
  label: string;
  section: string;
  context: string;
  dependency: string;
  selectorRole?: string;
  selectorName?: string;
  selector?: string;
  domSelector?: string;
  id?: string;
  name?: string;
  currentValue: unknown;
  disabled: boolean;
  options: EnumOption[];
  order: number;
};

export type ExtractorInput = {
  deterministicInputs: DeterministicInput[];
  captureInputs: CaptureInput[];
  navigationInputs: NavigationInput[];
  layoutInputs: LayoutInput[];
  sourceFiles: {
    deterministic: string[];
    capture: string[];
    navigation: string[];
    layout: string[];
  };
};

export type ExtractorResult = {
  schema: ExtractedSchema;
  summaryLine: string;
};
