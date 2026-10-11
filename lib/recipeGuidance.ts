// Preset, recipe-grounded guidance. No model, microphone input, translation, or inferred quantities.
import { CONF, type Recipe } from './guards';
import { hasAdaptations, ingredientKey, instructionText, quantityChanged, stepOptions } from './recipeOptions';
import { SAFETY_DISCLAIMERS } from '../prompts/index';

export type QuestionId = 'next' | 'howmuch' | 'look' | 'safe';

export function answerRecipeQuestion(q: QuestionId, recipe: Recipe, stepN: number): string {
  const { step, expected, allOmitted } = stepOptions(recipe, stepN);
  if (!step) return 'Loading the recipe.';
  switch (q) {
    case 'next': {
      const next = recipe.steps.find(s => s.n > stepN);
      return next ? `Next, step ${next.n}. ${instructionText(recipe, next.n)}` : 'That was the last step. Plate up and rate it.';
    }
    case 'howmuch': {
      const active = expected.map(name => recipe.ingredients.find(i => ingredientKey(i.name) === ingredientKey(name)));
      const parts = expected.map((name, index) => {
        const ing = active[index];
        if (!ing) return name;
        const approx = ing.confidence < CONF.recipeQty && !quantityChanged(ing) ? 'about ' : '';
        return `${approx}${ing.qty}${ing.unit ? ` ${ing.unit}` : ''} ${ing.name}`;
      });
      if (!parts.length) return allOmitted ? 'All ingredients in this step are intentionally omitted. Continue manually when ready.' : 'Nothing new goes in this step.';
      const vague = active.some(ing => ing && ing.confidence < CONF.recipeQty && !quantityChanged(ing));
      return `${parts.join(', and ')}.${vague ? " The video didn't say exactly; that's from what was visible." : ''}`;
    }
    case 'look':
      return `In the source video: ${step.visual_cue}.${hasAdaptations(recipe) ? ' Your intentional changes can change this appearance; it is not an exact target.' : ''}`;
    case 'safe':
      return `${allOmitted ? 'All listed ingredients are intentionally omitted; review whether this step is still needed.' : `Source visual cue: ${step.visual_cue}.`} ${SAFETY_DISCLAIMERS.rawProtein}`;
  }
}
