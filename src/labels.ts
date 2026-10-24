export interface CalendarLabel {
  id: string;
  name: string;
  kind: "Person" | "Category";
  color: string;
}
export type LabelInput = Omit<CalendarLabel, "id">;
export const LABELS_STORAGE_KEY = "family-calendar.labels.v1";

function isLabel(value: unknown): value is CalendarLabel {
  if (!value || typeof value !== "object") return false;
  const label = value as Record<string, unknown>;
  return typeof label.id === "string" && !!label.id.trim() &&
    typeof label.name === "string" && !!label.name.trim() &&
    (label.kind === "Person" || label.kind === "Category") &&
    typeof label.color === "string" && /^#[\da-f]{6}$/i.test(label.color);
}

/** Choose the higher-contrast text color using WCAG relative luminance. */
export function labelTextColor(color: string): "#000000" | "#ffffff" {
  const channels = [1, 3, 5].map(start => {
    const channel = parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

export function createLabelStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
  function list(): CalendarLabel[] {
    try {
      const parsed: unknown = JSON.parse(storage().getItem(LABELS_STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      const ids = new Set<string>();
      return parsed.filter(isLabel).filter(label => {
        if (ids.has(label.id)) return false;
        ids.add(label.id);
        return true;
      }).map(({ id, name, kind, color }) => ({ id, name, kind, color }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  }
  function save(labels: CalendarLabel[]) {
    try { storage().setItem(LABELS_STORAGE_KEY, JSON.stringify(labels)); }
    catch { throw new Error("Labels could not be saved. Browser storage may be unavailable or full."); }
  }
  function fields(input: LabelInput): LabelInput {
    if (!isLabel({ ...input, id: "validation" })) throw new Error("Enter a label name, Person or Category, and a valid color.");
    return { name: input.name.trim(), kind: input.kind, color: input.color };
  }
  return {
    list,
    create(input: LabelInput): CalendarLabel {
      const label = { ...fields(input), id: globalThis.crypto.randomUUID() };
      save([...list(), label]);
      return label;
    },
    update(id: string, input: LabelInput): CalendarLabel {
      const label = { ...fields(input), id };
      const labels = list();
      if (!labels.some(item => item.id === id)) throw new Error("Label no longer exists.");
      save(labels.map(item => item.id === id ? label : item));
      return label;
    },
    // Events retain their IDs and fields; missing labels are displayed as unassigned.
    delete(id: string) { save(list().filter(label => label.id !== id)); },
  };
}
export const labelStore = createLabelStore();
