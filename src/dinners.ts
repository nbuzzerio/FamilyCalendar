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

export const GROCERIES_STORAGE_KEY = "family-calendar.groceries.v1";
export interface GroceryItem { key: string; name: string; entries: { date: string; amount: string }[] }
export function groceryItems(plans: DinnerPlans, dates: string[]): GroceryItem[] {
  const items = new Map<string, GroceryItem>();
  for (const date of dates) for (const ingredient of plans[date]?.ingredients ?? []) {
    const name = ingredient.name.trim(), key = name.toLowerCase();
    const item = items.get(key) ?? { key, name, entries: [] };
    item.entries.push({ date, amount: ingredient.amount?.trim() || "Amount not specified" });
    items.set(key, item);
  }
  return [...items.values()];
}
export type GroceryChecks = Record<string, string[]>;
function dinnerWeek(date: string): string {
  const day = new Date(`${date}T12:00:00`);
  day.setDate(day.getDate() - (day.getDay() + 6) % 7);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
/** Validate saved checks without reconciling or writing storage. */
export function parseGroceryChecks(raw: string | null): GroceryChecks {
  const value: unknown = JSON.parse(raw ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.entries(value).every(([week, keys]) =>
    isLocalDate(week) && dinnerWeek(week) === week && Array.isArray(keys) && keys.every(key => typeof key === "string" && !!key.trim() && key === key.trim().toLowerCase()))) throw Error("Invalid grocery checkmarks");
  return value as GroceryChecks;
}
export function createGroceryStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
  function read(): GroceryChecks {
    return parseGroceryChecks(storage().getItem(GROCERIES_STORAGE_KEY));
  }
  function reconcile(plans: DinnerPlans): GroceryChecks {
    const saved = read(), next: GroceryChecks = {};
    for (const [week, keys] of Object.entries(saved)) {
      const available = new Set(groceryItems(plans, Object.keys(plans).filter(date => dinnerWeek(date) === week)).map(item => item.key));
      const retained = [...new Set(keys)].filter(key => available.has(key));
      if (retained.length) next[week] = retained;
    }
    if (JSON.stringify(saved) !== JSON.stringify(next)) storage().setItem(GROCERIES_STORAGE_KEY, JSON.stringify(next));
    return next;
  }
  return { reconcile, setChecked(plans: DinnerPlans, week: string, key: string, checked: boolean) {
    if (!isLocalDate(week) || dinnerWeek(week) !== week || !groceryItems(plans, Object.keys(plans).filter(date => dinnerWeek(date) === week)).some(item => item.key === key)) throw Error("Ingredient unavailable");
    const next = reconcile(plans);
    const keys = new Set(next[week] ?? []);
    if (checked) keys.add(key); else keys.delete(key);
    if (keys.size) next[week] = [...keys]; else delete next[week];
    storage().setItem(GROCERIES_STORAGE_KEY, JSON.stringify(next));
    return next;
  } };
}
export const groceryStore = createGroceryStore();
