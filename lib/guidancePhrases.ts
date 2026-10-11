// Local, prewritten English/Spanish guidance. Source recipe text and canonical ingredient names are not translated.
import { CONF, type Recipe } from './guards';
import { hasAdaptations, ingredientKey, quantityChanged, stepOptions } from './recipeOptions';
import type { QuestionId } from './recipeGuidance';
export type GuidanceLanguage = 'en' | 'es';
export const PRESET_LABELS = {
  en: { next: "What's next?", howmuch: 'How much goes in?', look: 'What did it look like in the video?', safe: 'Is it done?' },
  es: { next: '¿Qué sigue?', howmuch: '¿Cuánto agrego?', look: '¿Cómo se veía en el video?', safe: '¿Está listo?' },
} satisfies Record<GuidanceLanguage, Record<QuestionId, string>>;
export const UNTRANSLATED = 'Los nombres de ingredientes, las unidades y el texto original del video se mantienen sin traducir. La guía usa frases locales; no traduce toda la receta.';
function amounts(recipe: Recipe, expected: string[]) {
  return expected.map(name => {
    const ing = recipe.ingredients.find(i => ingredientKey(i.name) === ingredientKey(name));
    if (!ing) return name;
    return `${ing.confidence < CONF.recipeQty && !quantityChanged(ing) ? 'aproximadamente ' : ''}${ing.qty}${ing.unit ? ` ${ing.unit}` : ''} ${ing.name}`;
  });
}
export function spanishPreset(q: QuestionId, recipe: Recipe, n: number): string {
  const { step, expected, allOmitted } = stepOptions(recipe, n);
  if (!step) return 'Cargando la receta.';
  switch (q) {
    case 'howmuch': {
      if (!expected.length) return allOmitted ? 'Todos los ingredientes de este paso se omitieron intencionalmente. Avanza manualmente cuando estés listo.' : 'No se agregan ingredientes nuevos en este paso.';
      const approximate = expected.some(name => { const i = recipe.ingredients.find(i => ingredientKey(i.name) === ingredientKey(name)); return i && i.confidence < CONF.recipeQty && !quantityChanged(i); });
      return `${amounts(recipe, expected).join(', y ')}.${approximate ? ' El video no indicó cantidades exactas; son estimaciones visuales.' : ''}`;
    }
    case 'next': {
      const next = recipe.steps.find(s => s.n > n);
      if (!next) return 'Este fue el último paso. Sirve el plato y califícalo.';
      const options = stepOptions(recipe, next.n);
      if (options.allOmitted) return `Sigue el paso ${next.n}. Todos sus ingredientes se omitieron intencionalmente. Revisa el paso original y decide si queda alguna acción antes de avanzar manualmente.`;
      if (options.omitted.length || options.changed.length) return `Sigue el paso ${next.n}. Ingredientes incluidos: ${amounts(recipe, options.expected).join(', y ')}.${options.omitted.length ? ` Omite ${options.omitted.join(', ')}.` : ''} Revisa la técnica en las instrucciones originales, sin traducir.`;
      return `Sigue el paso ${next.n}. Texto original, sin traducir: ${next.text}`;
    }
    case 'look': return `Referencia del video, sin traducir: ${step.visual_cue}.${hasAdaptations(recipe) ? ' Tus cambios pueden modificar la apariencia; no es un objetivo exacto.' : ''}`;
    case 'safe': return `${allOmitted ? 'Todos los ingredientes indicados se omitieron intencionalmente; revisa si este paso todavía es necesario.' : `Referencia visual original, sin traducir: ${step.visual_cue}.`} La apariencia no confirma la seguridad de los alimentos. Usa un termómetro y comprueba una temperatura interna segura para carnes, aves y pescado.`;
  }
}
