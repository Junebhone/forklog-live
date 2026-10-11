// Bounded name/alias reminders, never an allergen-safety assessment. No models or automatic removals.
export const RESTRICTIONS = { peanut: 'Peanuts', milk: 'Milk', wheat: 'Wheat' } as const;
export type Restriction = keyof typeof RESTRICTIONS;
export type IngredientReminder = { ingredient: string; restriction: Restriction; reason: string; omitted: boolean; unknown: boolean };
const ALIASES: Record<Restriction, string[]> = {
  peanut: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'cacahuate', 'cacahuetes', 'mani'],
  milk: ['milk', 'buttermilk', 'whey', 'casein', 'caseinate', 'sodium caseinate', 'leche'],
  wheat: ['wheat', 'wheat flour', 'trigo'],
};
const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (name: string, alias: string) => ` ${name} `.includes(` ${alias} `);
export function ingredientReminders(ingredients: { name: string; omitted?: boolean }[], restrictions: Restriction[]): IngredientReminder[] {
  return ingredients.flatMap(ingredient => {
    const name = normalized(ingredient.name);
    return restrictions.flatMap(restriction => {
      const alias = ALIASES[restriction].find(a => contains(name, a));
      if (alias) return [{ ingredient: ingredient.name, restriction, reason: `Name mentions “${alias}”; check the complete product label.`, omitted: !!ingredient.omitted, unknown: true }];
      if (/\b(sauce|broth|stock|seasoning|dressing|flour|blend)\b/.test(name)) return [{ ingredient: ingredient.name, restriction, reason: 'Compound ingredient: contents are unknown from its name. Review the label or source.', omitted: !!ingredient.omitted, unknown: true }];
      return [];
    });
  });
}
export function reminderReviewKey(version: string, ingredients: { name: string; qty?: string; unit?: string; omitted?: boolean }[], restrictions: Restriction[]) {
  return JSON.stringify([version, [...restrictions].sort(), ingredients.map(i => [i.name, i.qty, i.unit, !!i.omitted])]);
}
