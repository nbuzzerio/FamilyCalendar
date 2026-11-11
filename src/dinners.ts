// @ts-expect-error Explicit extension supports the Node strip-types test runner.
import { isLocalDate } from "./events.ts";

export interface Ingredient { name: string; amount?: string }
export interface Dinner { name: string; cook?: string; notes?: string; ingredients: Ingredient[] }
export type DinnerPlans = Record<string, Dinner>;
export const DINNERS_STORAGE_KEY = "family-calendar.dinners.v1";

export function parseIngredients(text: string): Ingredient[] {
  return text.split(/[,\n]/).map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [name, ...quantity] = entry.split("|");
    if (!name.trim()) throw new Error("Enter an ingredient name before its quantity.");
    const amount = quantity.join("|").trim();
    return { name: name.trim(), ...(amount ? { amount } : {}) };
  });
}

export function formatIngredients(items: Ingredient[]): string {
  return items.map(item => `${item.name}${item.amount ? ` | ${item.amount}` : ""}`).join("\n");
}

export function isDinner(value: unknown): value is Dinner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const dinner = value as Record<string, unknown>;
  return typeof dinner.name === "string" && !!dinner.name.trim() &&
    (dinner.cook === undefined || typeof dinner.cook === "string") &&
    (dinner.notes === undefined || typeof dinner.notes === "string") &&
    Array.isArray(dinner.ingredients) && dinner.ingredients.every(item =>
      item && typeof item === "object" && !Array.isArray(item) &&
      typeof item.name === "string" && !!item.name.trim() &&
      (item.amount === undefined || typeof item.amount === "string"));
}

export function parseDinnerPlans(raw: string | null): DinnerPlans {
  const value: unknown = JSON.parse(raw ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Object.entries(value).every(([date, dinner]) => isLocalDate(date) && isDinner(dinner))) {
    throw new Error("Saved dinner data is invalid. It has been left unchanged.");
  }
  return value as DinnerPlans;
}

export function createDinnerStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
  function list(): DinnerPlans {
    try { return parseDinnerPlans(storage().getItem(DINNERS_STORAGE_KEY)); }
    catch { throw new Error("Dinner plans could not be read. Saved data has been left unchanged."); }
  }
  return { list, save(date: string, dinner: Dinner | null) {
    if (!isLocalDate(date) || (dinner !== null && !isDinner(dinner))) throw new Error("Enter a dinner name and valid ingredients.");
    const plans = list();
    if (dinner === null) delete plans[date];
    else plans[date] = dinner;
    storage().setItem(DINNERS_STORAGE_KEY, JSON.stringify(plans));
  } };
}
export const dinnerStore = createDinnerStore();
