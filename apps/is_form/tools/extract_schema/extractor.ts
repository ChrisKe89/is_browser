import { mergeToContainers } from "./merge.js";
import { normalizeInputs } from "./normalize.js";
import type { ExtractedSchema, ExtractorInput, ExtractorResult } from "./types.js";

export function extractSchema(input: ExtractorInput): ExtractorResult {
  const normalized = normalizeInputs({
    deterministicInputs: input.deterministicInputs,
    captureInputs: input.captureInputs,
  });

  const merged = mergeToContainers({
    settings: normalized.settings,
    navigationInputs: input.navigationInputs,
    layoutInputs: input.layoutInputs,
  });

  const fields = merged.containers.reduce((count, container) => count + container.fields.length, 0);
  const actions = merged.containers.reduce((count, container) => count + container.actions.length, 0);
  const warnings = [...normalized.warnings, ...merged.warnings].sort((a, b) => a.localeCompare(b));

  const schema: ExtractedSchema = {
    version: "1.0.0",
    generatedFrom: {
      deterministic: [...input.sourceFiles.deterministic].sort((a, b) => a.localeCompare(b)),
      capture: [...input.sourceFiles.capture].sort((a, b) => a.localeCompare(b)),
      navigation: [...input.sourceFiles.navigation].sort((a, b) => a.localeCompare(b)),
      layout: [...input.sourceFiles.layout].sort((a, b) => a.localeCompare(b)),
    },
    summary: {
      containers: merged.containers.length,
      fields,
      actions,
      warnings: warnings.length,
    },
    warnings,
    containers: merged.containers,
  };

  const summaryLine = `containers=${schema.summary.containers} fields=${fields} actions=${actions} warnings=${warnings.length}`;
  return { schema, summaryLine };
}
