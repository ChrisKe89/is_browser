export type UIControlType =
  | "dropdown"
  | "radio_group"
  | "checkbox"
  | "text"
  | "number"
  | "text_display"
  | "action_button";

export type UIValueType = "string" | "number" | "boolean" | "enum" | "none";

export type RadioMember = {
  option: string;
  selector?: string;
  dom_selector?: string;
};

export type UISchemaField = {
  field_id: string;
  container_id: string;
  page_path: string;
  context: string;
  label: string;
  control_type: UIControlType;
  value_type: UIValueType;
  current_value: unknown;
  default_value: unknown;
  options?: string[];
  locators: {
    role?: string;
    name?: string;
    selector?: string;
    dom_selector?: string;
    dependency?: string;
  };
  disabled?: boolean;
  is_action_only?: boolean;
  radio_members?: RadioMember[];
  order?: number;
};

export type ProfileRecord = {
  id: string;
  account: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};
