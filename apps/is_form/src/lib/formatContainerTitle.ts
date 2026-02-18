export type ContainerTitle = {
  pageTitle: string;
  isModal: boolean;
  modalTitle: string | null;
  raw: string;
};

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function derivePageTitle(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return "Untitled";
  }

  const hashIndex = trimmed.indexOf("#");
  const hashPart = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() : "";
  if (hashPart) {
    const normalizedHash = hashPart.replace(/^hash/i, "").trim();
    if (normalizedHash) {
      return toTitleCase(normalizedHash);
    }
  }

  const pathOnly = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const segments = pathOnly.split("/").filter(Boolean);
  const lastSegment = segments.at(-1) ?? "";

  if (!lastSegment) {
    return "Untitled";
  }

  if (/^index\.[a-z0-9]+$/i.test(lastSegment) && segments.length > 1) {
    return toTitleCase(segments.at(-2) ?? "Untitled");
  }

  const withoutExtension = lastSegment.replace(/\.[a-z0-9]+$/i, "");
  return toTitleCase(withoutExtension || lastSegment);
}

export function formatContainerTitle(containerId: string): ContainerTitle {
  const parts = containerId.split("::");
  const rawPath = parts[0] ?? containerId;
  const contextSegment = parts.find((part) => part.startsWith("modal:")) ?? "";
  const isModal = contextSegment.startsWith("modal:");
  const modalTitle = isModal ? contextSegment.replace(/^modal:/, "").trim() || null : null;

  return {
    pageTitle: derivePageTitle(rawPath),
    isModal,
    modalTitle,
    raw: containerId,
  };
}
