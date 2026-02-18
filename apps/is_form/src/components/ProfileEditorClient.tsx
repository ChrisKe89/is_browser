"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatContainerTitle } from "../lib/formatContainerTitle";
import type { ProfileRecord, UISchemaField } from "../lib/types";

type ValuesResponse = {
  profile: ProfileRecord;
  values: Record<string, unknown>;
};

type SchemaResponse = {
  schema: UISchemaField[];
};

type SaveValuesResponse = {
  upserted: number;
  profile: ProfileRecord;
};

type UpdateProfileResponse = {
  profile: ProfileRecord;
};

type ProfileDraft = {
  account: string;
  name: string;
};

type SectionGroup = {
  containerId: string;
  anchorId: string;
  title: ReturnType<typeof formatContainerTitle>;
  fields: UISchemaField[];
};

const STORABLE_TYPES = new Set(["dropdown", "radio_group", "checkbox", "text", "number"]);
const METADATA_TYPES = new Set(["action_button", "text_display"]);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeProfileDraft(profile: ProfileDraft): ProfileDraft {
  return {
    account: profile.account.trim(),
    name: profile.name.trim(),
  };
}

function normalizeValueForSave(field: UISchemaField, value: unknown): unknown {
  if (field.control_type === "number" && typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : Number(trimmed);
  }
  return value;
}

function buildStorablePayload(
  schema: UISchemaField[],
  sourceValues: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of schema) {
    if (!STORABLE_TYPES.has(field.control_type)) {
      continue;
    }
    payload[field.field_id] = normalizeValueForSave(field, sourceValues[field.field_id]);
  }
  return payload;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === right) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLongField(field: UISchemaField): boolean {
  if (field.control_type === "radio_group") {
    return true;
  }
  if (field.control_type === "dropdown") {
    const options = field.options ?? [];
    return options.length > 12 || options.some((option) => option.length > 30);
  }
  return false;
}

function FieldRow({
  field,
  value,
  onChange,
  onCopyFieldId,
}: {
  field: UISchemaField;
  value: unknown;
  onChange: (value: unknown) => void;
  onCopyFieldId: (fieldId: string) => void;
}) {
  const disabled = field.disabled === true;

  let control: React.ReactNode;
  if (field.control_type === "dropdown") {
    control = (
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">Select...</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.control_type === "checkbox") {
    control = (
      <label className="checkbox-control">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span>Enabled</span>
      </label>
    );
  } else if (field.control_type === "number") {
    control = (
      <input
        type="number"
        value={typeof value === "number" ? String(value) : String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    );
  } else if (field.control_type === "radio_group") {
    control = (
      <div className="radio-group">
        {(field.options ?? []).map((option) => (
          <label className="radio-line" key={`${field.field_id}:${option}`}>
            <input
              type="radio"
              name={field.field_id}
              checked={value === option}
              onChange={() => onChange(option)}
              disabled={disabled}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  } else {
    control = (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    );
  }

  return (
    <article className={`field-card ${isLongField(field) ? "field-card-full" : ""}`}>
      <div className="field-heading">
        <p className="field-label">{field.label}</p>
        <button
          type="button"
          className="copy-button"
          onClick={() => onCopyFieldId(field.field_id)}
          aria-label={`Copy field id for ${field.label}`}
        >
          Copy ID
        </button>
      </div>
      <p className="field-helper">field_id: {field.field_id}</p>
      {control}
    </article>
  );
}

export function ProfileEditorClient({ profileId }: { profileId: string }) {
  const [schema, setSchema] = useState<UISchemaField[]>([]);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({ account: "", name: "" });
  const [savedProfileDraft, setSavedProfileDraft] = useState<ProfileDraft>({ account: "", name: "" });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savedValues, setSavedValues] = useState<Record<string, unknown>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApplyMetadata, setShowApplyMetadata] = useState(false);
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErrorMessage(null);

      const [schemaRes, valuesRes] = await Promise.all([
        fetch("/api/schema", { cache: "no-store" }),
        fetch(`/api/profiles/${profileId}/values`, { cache: "no-store" }),
      ]);

      if (!schemaRes.ok || !valuesRes.ok) {
        throw new Error("Failed to load profile data");
      }

      const schemaPayload = (await schemaRes.json()) as SchemaResponse;
      const valuePayload = (await valuesRes.json()) as ValuesResponse;
      const mergedValues: Record<string, unknown> = {};

      for (const field of schemaPayload.schema) {
        if (!STORABLE_TYPES.has(field.control_type)) {
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(valuePayload.values, field.field_id)) {
          mergedValues[field.field_id] = valuePayload.values[field.field_id];
        } else if (field.current_value !== undefined && field.current_value !== null) {
          mergedValues[field.field_id] = field.current_value;
        } else {
          mergedValues[field.field_id] = field.default_value ?? null;
        }
      }

      const initialProfileDraft = {
        account: valuePayload.profile.account,
        name: valuePayload.profile.name ?? "",
      };

      const firstContainerId = Array.from(
        new Set(schemaPayload.schema.map((field) => field.container_id)),
      )
        .sort((a, b) => a.localeCompare(b))[0];

      setSchema(schemaPayload.schema);
      setProfile(valuePayload.profile);
      setProfileDraft(initialProfileDraft);
      setSavedProfileDraft(initialProfileDraft);
      setValues(mergedValues);
      setSavedValues(mergedValues);
      setOpenSections(firstContainerId ? new Set([firstContainerId]) : new Set());
      setLoading(false);
    }

    load().catch((error: unknown) => {
      setLoading(false);
      setErrorMessage(error instanceof Error ? error.message : "Load failed");
    });
  }, [profileId]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const sections = useMemo<SectionGroup[]>(() => {
    const map = new Map<string, UISchemaField[]>();
    for (const field of schema) {
      const list = map.get(field.container_id) ?? [];
      list.push(field);
      map.set(field.container_id, list);
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([containerId, fields]) => ({
        containerId,
        anchorId: `section-${slugify(containerId)}`,
        title: formatContainerTitle(containerId),
        fields: [...fields].sort((a, b) => {
          const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return a.label.localeCompare(b.label);
        }),
      }));
  }, [schema]);

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return sections.map((section) => ({ section, visibleFields: section.fields }));
    }

    return sections
      .map((section) => {
        const titleText = [
          section.title.pageTitle,
          section.title.isModal ? "Modal" : "Page",
          section.title.modalTitle ?? "",
        ]
          .join(" ")
          .toLowerCase();

        const fieldMatches = section.fields.filter((field) =>
          field.label.toLowerCase().includes(query),
        );

        if (titleText.includes(query)) {
          return { section, visibleFields: section.fields };
        }

        return { section, visibleFields: fieldMatches };
      })
      .filter((entry) => entry.visibleFields.length > 0);
  }, [search, sections]);

  useEffect(() => {
    if (filteredSections.length === 0) {
      return;
    }
    const hasVisibleOpenSection = filteredSections.some((entry) =>
      openSections.has(entry.section.containerId),
    );
    if (!hasVisibleOpenSection) {
      setOpenSections((current) => {
        const next = new Set(current);
        next.add(filteredSections[0].section.containerId);
        return next;
      });
    }
  }, [filteredSections, openSections]);

  const savedPayload = useMemo(() => buildStorablePayload(schema, savedValues), [schema, savedValues]);
  const currentPayload = useMemo(() => buildStorablePayload(schema, values), [schema, values]);

  const dirtyFieldIds = useMemo(() => {
    const changed: string[] = [];
    for (const fieldId of Object.keys(currentPayload)) {
      if (!valuesEqual(currentPayload[fieldId], savedPayload[fieldId])) {
        changed.push(fieldId);
      }
    }
    return changed;
  }, [currentPayload, savedPayload]);

  const normalizedSavedProfile = useMemo(
    () => normalizeProfileDraft(savedProfileDraft),
    [savedProfileDraft],
  );
  const normalizedCurrentProfile = useMemo(
    () => normalizeProfileDraft(profileDraft),
    [profileDraft],
  );

  const profileChangeCount =
    (normalizedSavedProfile.account !== normalizedCurrentProfile.account ? 1 : 0) +
    (normalizedSavedProfile.name !== normalizedCurrentProfile.name ? 1 : 0);

  const unsavedChanges = dirtyFieldIds.length + profileChangeCount;

  function updateValue(fieldId: string, value: unknown) {
    setValues((previous) => ({ ...previous, [fieldId]: value }));
  }

  function toggleSection(containerId: string) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(containerId)) {
        next.delete(containerId);
      } else {
        next.add(containerId);
      }
      return next;
    });
  }

  function scrollToSection(anchorId: string, containerId: string) {
    const target = document.getElementById(anchorId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setOpenSections((current) => {
        const next = new Set(current);
        next.add(containerId);
        return next;
      });
    }
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToastMessage("Copied");
    } catch {
      setErrorMessage("Clipboard copy failed");
    }
  }

  async function saveAll() {
    setSaving(true);
    setErrorMessage(null);

    const profileChanged = profileChangeCount > 0;
    const fieldsChanged = dirtyFieldIds.length > 0;

    try {
      let latestProfile = profile;

      if (profileChanged) {
        const response = await fetch(`/api/profiles/${profileId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: normalizedCurrentProfile.account,
            name: normalizedCurrentProfile.name || null,
          }),
        });
        if (!response.ok) {
          const errorPayload = (await response.json()) as { error?: string };
          throw new Error(errorPayload.error ?? "Failed to save profile metadata");
        }
        const payload = (await response.json()) as UpdateProfileResponse;
        latestProfile = payload.profile;
      }

      if (fieldsChanged) {
        const response = await fetch(`/api/profiles/${profileId}/values`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: currentPayload }),
        });
        if (!response.ok) {
          const errorPayload = (await response.json()) as { error?: string };
          throw new Error(errorPayload.error ?? "Failed to save values");
        }
        const payload = (await response.json()) as SaveValuesResponse;
        latestProfile = payload.profile;
      }

      if (latestProfile) {
        setProfile(latestProfile);
        const nextDraft = {
          account: latestProfile.account,
          name: latestProfile.name ?? "",
        };
        setProfileDraft(nextDraft);
        setSavedProfileDraft(nextDraft);
      } else {
        setSavedProfileDraft({ ...profileDraft });
      }

      setSavedValues({ ...values });
      setToastMessage("Saved successfully");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function resetChanges() {
    setValues({ ...savedValues });
    setProfileDraft({ ...savedProfileDraft });
    setErrorMessage(null);
  }

  const selectedSectionId = filteredSections[0]?.section.containerId ?? "";

  return (
    <main className="page page-shell">
      <section className="card header-card">
        <div className="header-row">
          <div>
            <p className="eyebrow">Settings</p>
            <h1 className="title">Profile Editor</h1>
          </div>
          <Link href="/" className="text-link">
            Back to profiles
          </Link>
        </div>

        <div className="header-grid">
          <div>
            <label htmlFor="accountTop">Account</label>
            <input
              id="accountTop"
              value={profileDraft.account}
              onChange={(event) =>
                setProfileDraft((current) => ({ ...current, account: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="profileName">Profile Name (optional)</label>
            <input
              id="profileName"
              value={profileDraft.name}
              onChange={(event) =>
                setProfileDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label htmlFor="profileId">Profile ID</label>
            <div className="inline-input-row">
              <input id="profileId" value={profile?.id ?? ""} readOnly />
              <button
                type="button"
                className="secondary-button"
                onClick={() => copyToClipboard(profile?.id ?? "")}
                disabled={!profile?.id}
              >
                Copy
              </button>
            </div>
          </div>
          <div>
            <p className="input-label">Last saved</p>
            <p className="muted">{profile?.updated_at ? new Date(profile.updated_at).toLocaleString() : "-"}</p>
          </div>
        </div>
      </section>

      <div className="mobile-nav card">
        <label htmlFor="sectionPicker">Jump to section</label>
        <select
          id="sectionPicker"
          value={selectedSectionId}
          onChange={(event) => {
            const match = filteredSections.find(
              (entry) => entry.section.containerId === event.target.value,
            );
            if (match) {
              scrollToSection(match.section.anchorId, match.section.containerId);
            }
          }}
        >
          {filteredSections.map(({ section }) => (
            <option key={section.containerId} value={section.containerId}>
              {section.title.pageTitle}
              {section.title.isModal && section.title.modalTitle
                ? ` · Modal: ${section.title.modalTitle}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="layout-shell">
        <aside className="sidebar card">
          <h2 className="section-heading">Sections</h2>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search labels or sections"
          />
          <label className="metadata-toggle">
            <input
              type="checkbox"
              checked={showApplyMetadata}
              onChange={(event) => setShowApplyMetadata(event.target.checked)}
            />
            <span>Show apply metadata</span>
          </label>
          <nav className="section-nav" aria-label="Sections">
            {filteredSections.map(({ section, visibleFields }) => (
              <button
                key={section.containerId}
                type="button"
                className={`section-nav-item ${
                  openSections.has(section.containerId) ? "is-active" : ""
                }`}
                onClick={() => scrollToSection(section.anchorId, section.containerId)}
              >
                <span>{section.title.pageTitle}</span>
                <small>{visibleFields.length}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="content-column">
          {loading ? <section className="card">Loading...</section> : null}

          {!loading && filteredSections.length === 0 ? (
            <section className="card">
              <p className="muted">No matching sections for this search.</p>
            </section>
          ) : null}

          {!loading &&
            filteredSections.map(({ section, visibleFields }) => {
              const isOpen = openSections.has(section.containerId);
              const editableFields = visibleFields.filter(
                (field) => !METADATA_TYPES.has(field.control_type),
              );
              const metadataFields = visibleFields.filter((field) =>
                METADATA_TYPES.has(field.control_type),
              );

              return (
                <article className="card section-card" id={section.anchorId} key={section.containerId}>
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection(section.containerId)}
                  >
                    <span>
                      <strong>{section.title.pageTitle}</strong>
                      {section.title.isModal ? (
                        <span className="badge-group">
                          <span className="badge">Modal</span>
                          {section.title.modalTitle ? (
                            <span className="badge badge-soft">{section.title.modalTitle}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="badge-group">
                          <span className="badge badge-page">Page</span>
                        </span>
                      )}
                    </span>
                    <span className="muted">{isOpen ? "Collapse" : "Expand"}</span>
                  </button>

                  {isOpen ? (
                    <div className="section-content">
                      {section.title.isModal ? (
                        <p className="muted">
                          Applied via modal context <span className="badge">Modal</span>
                        </p>
                      ) : null}

                      <details>
                        <summary>Raw container ID</summary>
                        <div className="raw-id-row">
                          <code>{section.title.raw}</code>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => copyToClipboard(section.title.raw)}
                          >
                            Copy
                          </button>
                        </div>
                      </details>

                      <div className="fields-grid">
                        {editableFields.map((field) => (
                          <FieldRow
                            key={field.field_id}
                            field={field}
                            value={values[field.field_id]}
                            onChange={(nextValue) => updateValue(field.field_id, nextValue)}
                            onCopyFieldId={copyToClipboard}
                          />
                        ))}
                      </div>

                      {showApplyMetadata && metadataFields.length > 0 ? (
                        <div className="metadata-panel">
                          <h3>Apply metadata</h3>
                          {metadataFields.map((field) => (
                            <p className="muted" key={field.field_id}>
                              <strong>{field.label}</strong> ({field.control_type}) - {field.field_id}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
        </section>
      </div>

      <div className="sticky-save-bar">
        <div>
          <p className="save-label">Unsaved changes</p>
          <p className="save-count">{unsavedChanges}</p>
        </div>
        <div className="save-actions">
          <button type="button" className="secondary-button" onClick={resetChanges} disabled={unsavedChanges === 0 || saving || loading}>
            Reset
          </button>
          <button type="button" onClick={saveAll} disabled={unsavedChanges === 0 || saving || loading}>
            {saving ? "Saving..." : "Save"}
          </button>
          <Link href={`/api/profiles/${profileId}/export`} className="text-link export-link">
            Export JSON
          </Link>
        </div>
      </div>

      {errorMessage ? <p className="status-message error">{errorMessage}</p> : null}
      {toastMessage ? <div className="toast">{toastMessage}</div> : null}
    </main>
  );
}
