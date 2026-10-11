import type { LibraryItem, VersionRow } from './db';
import { instructionText } from './recipeOptions';
export type LibraryFilter = 'All' | 'Recent' | 'Processing';
export function filterLibrary(items: LibraryItem[], query: string, filter: LibraryFilter, now = Date.now()) {
  const q = query.trim().toLowerCase();
  return items.filter(i => (filter !== 'Recent' || (Date.parse(i.created_at) >= now - 7 * 86400_000 && Date.parse(i.created_at) <= now))
    && (filter !== 'Processing' || i.version_count === 0)
    && `${i.title} ${i.source_summary ?? ''} ${i.search_ingredients ?? ''}`.toLowerCase().includes(q));
}
// Allow only readable content. Private notes, IDs, media paths and URLs are never exported.
const readable = (s: string) => s.replace(/(?:https?:\/\/|file:\/\/|content:\/\/|supabase:\/\/)[^\s]+/gi, '[link omitted]').replace(/\b(?:videos|frames)\/[^\s]+/gi, '[media path omitted]');
export function shareVersionText(v: VersionRow): string {
  const r = v.recipe_json;
  let attribution = '';
  try { const n = JSON.parse(v.notes ?? '{}'); if (typeof n.source_attribution === 'string') attribution = readable(n.source_attribution); } catch { /* ordinary private notes are excluded */ }
  const included = r.ingredients.filter(i => !i.omitted).map(i => `• ${i.qty}${i.unit ? ` ${i.unit}` : ''} ${i.name}`);
  const omitted = r.ingredients.filter(i => i.omitted).map(i => i.name);
  return [readable(r.title), `ForkLog recipe v${v.number}`, r.source_summary ? `Source: ${readable(r.source_summary)}` : '',
    attribution ? `Attribution: ${attribution}` : '', '', 'Ingredients', ...included.map(readable),
    omitted.length ? `Intentionally omitted (not required): ${omitted.map(readable).join(', ')}` : '', '', 'Steps',
    ...r.steps.map(s => `${s.n}. ${readable(instructionText(r, s.n))}`)].filter(x => x !== '').join('\n');
}

/** Private notes are readable in history but are never part of shareVersionText. */
export function versionNotesLines(notes: string | null): string[] {
  if (!notes) return [];
  try {
    const n = JSON.parse(notes);
    if (n && typeof n === 'object' && typeof n.private_notes === 'string') return [n.private_notes ? `Private notes: ${n.private_notes}` : '', typeof n.source_attribution === 'string' && n.source_attribution ? `Source attribution: ${n.source_attribution}` : ''].filter(Boolean);
    if (n && typeof n === 'object' && typeof n.import_caption === 'string') return [
      n.import_caption ? `Extraction caption: ${n.import_caption}` : '',
      n.reviewed_caption && n.reviewed_caption !== n.import_caption ? `Reviewed caption (notes only): ${n.reviewed_caption}` : '',
      n.variation_notes ? `Private variation notes: ${n.variation_notes}` : '',
      n.source_attribution ? `Source attribution: ${n.source_attribution}` : '',
    ].filter(Boolean);
  } catch { /* existing ordinary cook notes */ }
  return [notes];
}

/** Carry public attribution forward without copying a parent's private caption/variation notes. */
export function notesWithAttribution(notes: string, parentNotes: string | null): string {
  try {
    const parent = JSON.parse(parentNotes ?? '{}');
    if (!parent || typeof parent.source_attribution !== 'string' || !parent.source_attribution) return notes;
    try { const own = JSON.parse(notes); if (own && typeof own === 'object' && Object.hasOwn(own, 'source_attribution')) return notes; } catch { /* ordinary new private notes */ }
    return JSON.stringify({ private_notes: notes, source_attribution: parent.source_attribution });
  } catch { return notes; }
}
