// Pure recipe adaptation helpers. Keep this file in sync with the Edge Function copy.
import type { CoachEvent, Recipe } from './guards.ts';

export const ADAPTATION_CONTRACT = 'ingredient-options-v1';
export const ingredientKey = (name: string) => name.trim().toLowerCase();
export const quantityChanged = (i: Recipe['ingredients'][number]) =>
  i.source_qty !== undefined && (i.qty !== i.source_qty || i.unit !== (i.source_unit ?? i.unit));
export const hasAdaptations = (r: Recipe) => r.ingredients.some(i => i.omitted || quantityChanged(i));

export function stepOptions(recipe: Recipe, n: number) {
  const step = recipe.steps.find(s => s.n === n);
  const ingredients = (step?.ingredients ?? []).map(name => ({
    name, ingredient: recipe.ingredients.find(i => ingredientKey(i.name) === ingredientKey(name)),
  }));
  const expected = ingredients.filter(i => !i.ingredient?.omitted).map(i => i.name);
  const omitted = ingredients.filter(i => i.ingredient?.omitted).map(i => i.name);
  const changed = ingredients.filter(i => i.ingredient && quantityChanged(i.ingredient)).map(i => i.ingredient!);
  return { step, expected, omitted, changed, allOmitted: ingredients.length > 0 && expected.length === 0 };
}

export function adaptationSummary(recipe: Recipe): string {
  return recipe.ingredients.flatMap(i => i.omitted ? [`Omit ${i.name}`] : quantityChanged(i) ? [`${i.name}: ${i.qty} ${i.unit}`.trim()] : []).join('; ');
}

// Source instructions remain available visually. Do not read an instruction to add an omitted item.
export function instructionText(recipe: Recipe, n: number): string {
  const { step, omitted, changed, allOmitted, expected } = stepOptions(recipe, n);
  if (!step) return 'Loading the recipe.';
  if (allOmitted) return 'All listed ingredients are intentionally omitted. Review the source step; skip it manually if no action remains.';
  if (!omitted.length && !changed.length) return step.text;
  const choices = [omitted.length ? `Omit ${omitted.join(', ')}.` : '', ...changed.map(i => `Use ${i.qty} ${i.unit} ${i.name}.`)];
  return `${choices.filter(Boolean).join(' ')} Adapted ${step.action} step with ${expected.join(', ')}. Review the source instructions for the remaining technique.`;
}

export function ingredientDiff(base: Recipe, recipe: Recipe) {
  return recipe.ingredients.flatMap(i => {
    const old = base.ingredients.find(b => ingredientKey(b.name) === ingredientKey(i.name));
    if (!old) return [];
    const rows: { type: 'removed' | 'added' | 'changed_qty'; step_n: null; field: string; from: string | null; to: string | null; confidence: number }[] = [];
    if (!!old.omitted !== !!i.omitted) rows.push({ type: i.omitted ? 'removed' : 'added', step_n: null, field: i.name, from: old.omitted ? 'intentionally omitted' : `${old.qty} ${old.unit}`.trim(), to: i.omitted ? 'intentionally omitted' : `${i.qty} ${i.unit}`.trim(), confidence: 1 });
    if (old.qty !== i.qty || old.unit !== i.unit) rows.push({ type: 'changed_qty', step_n: null, field: i.name, from: `${old.qty} ${old.unit}`.trim(), to: `${i.qty} ${i.unit}`.trim(), confidence: 1 });
    return rows;
  });
}

/** Never accept a detection of an omitted ingredient. Scripted source comparisons cannot assess adaptations. */
export function adaptCoachEvent(ev: CoachEvent, recipe: Recipe, n: number, scripted = false): CoachEvent | null {
  const { omitted, allOmitted } = stepOptions(recipe, n);
  if (allOmitted) return null;
  if (ev.ingredient_added && recipe.ingredients.some(i => i.omitted && ingredientKey(i.name) === ingredientKey(ev.ingredient_added!))) return null;
  if (scripted && hasAdaptations(recipe)) return null; // do not fabricate an adapted camera result
  const out = { ...ev };
  if (omitted.some(name => ingredientKey(`${out.deviation ?? ''} ${out.action ?? ''}`).includes(ingredientKey(name)))) {
    if (out.severity === 'stop') return { ...out, deviation: 'Potential safety issue. Review the pan.', action: 'Pause. Check the pan.' };
    out.deviation = null; out.action = null;
  }
  return out;
}

/** Model recaps cannot silently undo user-confirmed omissions/quantities or renumber source steps. */
export function preserveIntentions(base: Recipe, proposed: Recipe): Recipe {
  if (!hasAdaptations(base)) return proposed;
  return {
    ...proposed,
    ingredients: base.ingredients.map(i => {
      const candidate = proposed.ingredients.find(p => ingredientKey(p.name) === ingredientKey(i.name)) ?? i;
      return i.omitted || quantityChanged(i) ? { ...i } : { ...candidate, name: i.name, omitted: i.omitted };
    }),
    steps: base.steps.map(s => {
      const candidate = proposed.steps.find(p => p.n === s.n);
      return candidate ? { ...candidate, n: s.n, ingredients: s.ingredients, ref_frame_sec: s.ref_frame_sec } : s;
    }),
  };
}
