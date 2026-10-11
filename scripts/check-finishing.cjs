// Local regression checks. Transpile in memory; native modules and cloud calls are explicit mocks.
// Run: node --test scripts/check-finishing.cjs (no install, network, database or generated files).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function loader(mocks = {}, globals = {}, sources = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const module = { exports: {} };
    cache.set(file, module);
    const source = sources[path.relative(root, file).replaceAll('\\', '/')] ?? fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: file, reportDiagnostics: true });
    assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
    const req = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('https://esm.sh/zod')) return require('zod');
      if (name.startsWith('.') || name.startsWith('@/')) {
        let resolved = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        if (!path.extname(resolved)) resolved = fs.existsSync(path.join(resolved, 'index.ts')) ? path.join(resolved, 'index.ts') : resolved + (fs.existsSync(resolved + '.ts') ? '.ts' : '.tsx');
        const key = path.relative(root, resolved).replaceAll('\\', '/');
        if (Object.hasOwn(mocks, key)) return mocks[key];
        return load(resolved);
      }
      if (name.startsWith('expo-') || name === 'react-native' || name.startsWith('https://')) throw new Error(`Unmocked external dependency: ${name}`);
      return require(name);
    };
    const context = { require: req, module, exports: module.exports, console, Buffer, Uint8Array,
      atob, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      Date, Response, Request, __DEV__: false, process: { env: {} }, ...globals };
    vm.runInNewContext(compiled.outputText, context, { filename: file });
    return module.exports;
  }
  return load;
}
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function recipe(load) { return plain(load('lib/demoData.ts').DEMO_RECIPE); }
function omittedRecipe(load) {
  const r = recipe(load);
  r.ingredients.find(i => i.name === 'garlic').omitted = true;
  return r;
}

test('canonical omissions change requirements, retain source references, and undo restores them', () => {
  const load = loader(); const r = recipe(load); const original = plain(r);
  const options = load('lib/recipeOptions.ts');
  r.ingredients.find(i => i.name === 'garlic').omitted = true;
  assert(!options.stepOptions(r, 3).expected.includes('garlic'));
  assert(options.stepOptions(r, 3).allOmitted);
  assert.match(options.instructionText(r, 3), /intentionally omitted/);
  assert.equal(options.ingredientDiff(original, r)[0].type, 'removed');
  assert.deepEqual(r.steps, original.steps);
  r.ingredients.find(i => i.name === 'garlic').omitted = false;
  assert(options.stepOptions(r, 3).expected.includes('garlic'));
  assert.equal(options.ingredientDiff(original, r).length, 0);
  assert.equal(options.hasAdaptations(r), false);
});

test('manual quantities and omissions survive schema parsing and model recap proposals', () => {
  const load = loader(); const r = omittedRecipe(load); const o = load('lib/recipeOptions.ts');
  const soy = r.ingredients.find(i => i.name === 'soy sauce');
  soy.source_qty = soy.qty; soy.source_unit = soy.unit; soy.qty = '1';
  const parsed = load('lib/guards.ts').RecipeSchema.parse(r);
  assert(parsed.ingredients.find(i => i.name === 'garlic').omitted);
  const proposal = recipe(load);
  proposal.steps.reverse();
  const preserved = o.preserveIntentions(parsed, proposal);
  assert.equal(preserved.ingredients.find(i => i.name === 'soy sauce').qty, '1');
  assert(preserved.ingredients.find(i => i.name === 'garlic').omitted);
  assert.deepEqual(plain(preserved.steps.map(s => [s.n, s.ref_frame_sec])), r.steps.map(s => [s.n, s.ref_frame_sec]));
  assert.equal(o.adaptCoachEvent(load('lib/demoData.ts').DEMO_COACH_SCRIPT[3][0].event, r, 3, true), null);
});

test('demo import → child version → cook selected version → recap → history → undo preserves v1', async () => {
  const load = loader(); const { demoDb: db, demoInvoke } = load('lib/demoDb.ts');
  const o = load('lib/recipeOptions.ts');
  const id = await db.createRecipe();
  const extracted = await demoInvoke('extract-recipe', { recipe_id: id });
  const v1 = await db.getVersion(extracted.version_id);
  const before = plain(v1.recipe_json);
  const draft = plain(before); draft.ingredients.find(i => i.name === 'garlic').omitted = true;
  const cookId = await db.startCook(id, v1.id);
  const v2 = await db.saveVersion({ recipeId: id, parentId: v1.id, recipe: draft, diff: o.ingredientDiff(before, draft), rating: null, notes: 'intentional' });
  await db.activateCookVersion(cookId, v2.id);
  assert.equal((await db.getCook(cookId)).base_version_id, v2.id);
  const reopened = await db.getVersion(v2.id); // navigation/reload of the screen, not process persistence
  assert(reopened.recipe_json.ingredients.find(i => i.name === 'garlic').omitted);
  assert.deepEqual(plain((await db.getVersion(v1.id)).recipe_json), before);
  const recap = await demoInvoke('recap', { cook_id: cookId, rating: 8 });
  assert.equal(recap.diff.length, 0);
  assert.match(recap.spoken_recap, /scripted demo cannot measure/);
  assert(recap.proposed_version.ingredients.find(i => i.name === 'garlic').omitted);
  const v3 = await db.saveVersion({ recipeId: id, parentId: v2.id, recipe: recap.proposed_version, diff: recap.diff, rating: 8, notes: '', cookId });
  const repeated = await db.saveVersion({ recipeId: id, parentId: v2.id, recipe: recap.proposed_version, diff: recap.diff, rating: 8, notes: '', cookId });
  assert.equal(repeated.id, v3.id);
  assert.equal((await db.getVersions(id)).length, 3);
  const replay = await db.startCook(id, v2.id);
  const restored = plain(reopened.recipe_json); restored.ingredients.find(i => i.name === 'garlic').omitted = false;
  const v4 = await db.saveVersion({ recipeId: id, parentId: v2.id, recipe: restored, diff: o.ingredientDiff(reopened.recipe_json, restored), rating: null, notes: 'undo' });
  await db.activateCookVersion(replay, v4.id);
  assert(o.stepOptions((await db.getVersion(v4.id)).recipe_json, 3).expected.includes('garlic'));
  assert.deepEqual(plain((await db.getVersion(v1.id)).recipe_json), before);
  await assert.rejects(db.activateCookVersion(cookId, v4.id), /Cannot activate/);
});

function visionSetup({ adapted = false, demo = false, response, capability = async () => {}, sources = {} } = {}) {
  const events = []; const stats = []; const calls = [];
  const load = loader({
    'lib/demo.ts': { isDemoMode: () => demo },
    'lib/supabase.ts': { requireAdaptationBackend: capability, supabase: { functions: { invoke: async (name, opts) => { calls.push(opts.body); return response?.promise ?? { data: { ok: true, event: null }, error: null }; } } } },
    'lib/image.ts': { resizeJpeg: async (_uri, width) => ({ uri: `mock://${width}`, base64: 'AA==' }), base64ToBytes: () => new Uint8Array([0]), deleteQuietly: () => {} },
  }, {}, sources);
  const r = adapted ? omittedRecipe(load) : recipe(load);
  const loop = new (load('lib/visionLoop.ts').VisionLoop)({ current: { takePictureAsync: async () => ({ uri: 'mock://shot' }) } }, r, 'recipe', 'cook', (ev, n) => events.push([ev, n]), s => stats.push(s));
  return { load, loop, events, stats, calls };
}

for (const action of ['change step', 'stop']) test(`late coach result is discarded after ${action}`, async () => {
  const response = deferred(); const { load, loop, events, calls } = visionSetup({ response });
  loop.start(); const request = loop.tick(); await flush();
  assert.equal(calls.length, 1);
  if (action === 'change step') loop.setStep(2); else loop.stop();
  response.resolve({ data: { ok: true, event: load('lib/demoData.ts').DEMO_COACH_SCRIPT[1][0].event }, error: null });
  await request; assert.equal(events.length, 0); loop.stop();
});

test('coach duplicate tick is blocked while request is pending; processing state clears', async () => {
  const response = deferred(); const { loop, calls, stats } = visionSetup({ response });
  loop.start(); const request = loop.tick(); await flush(); await loop.tick();
  assert.equal(calls.length, 1); assert(stats.at(-1).processing);
  response.resolve({ data: { ok: true, event: null }, error: null });
  await request; assert.equal(stats.at(-1).processing, false); loop.stop();
});

test('an incompatible deployment blocks adapted live frames before capture/invoke', async () => {
  const { loop, calls, stats } = visionSetup({ adapted: true, capability: async () => { throw new Error('deployment missing adaptation contract'); } });
  loop.start(); await loop.tick();
  assert.equal(calls.length, 0); assert.match(stats.at(-1).lastError, /deployment missing/); loop.stop();
});

test('adapted scripted demo emits no fabricated camera comparisons', () => {
  const { loop, events } = visionSetup({ adapted: true, demo: true });
  loop.start(); loop.tickDemo(Date.now() + 25_000);
  assert.equal(events.length, 0); loop.stop();
});

function voiceSetup(sources = {}, stop = async () => {}) {
  const requests = []; const played = []; const speech = []; const lines = [];
  const load = loader({
    'lib/demo.ts': { isDemoMode: () => false },
    'lib/supabase.ts': { supabase: { functions: { invoke: async (_name, { body }) => { const d = deferred(); requests.push({ text: body.text, ...d }); return d.promise; } } } },
    'lib/image.ts': { base64ToBytes: () => new Uint8Array([0]) },
    'expo-file-system': { Paths: { cache: 'mock://cache' }, File: class { constructor(_p, name) { this.uri = name; } write() {} } },
    'expo-audio': { createAudioPlayer: ({ uri }) => ({ addListener: () => ({ remove() {} }), play: () => played.push(uri), pause() {}, remove() {} }), setAudioModeAsync: async () => {} },
    'expo-speech': { speak: (text, options) => speech.push({ text, options }), stop },
  }, {}, sources);
  const speaker = load('lib/voice.ts').speaker;
  speaker.onLine = text => lines.push(text);
  const resolveAudio = request => request.resolve({ data: { ok: true, audio_b64: 'AA==' }, error: null });
  return { speaker, requests, played, speech, lines, resolveAudio };
}

for (const action of ['stop', 'mute']) test(`pending voice generation cannot play after ${action}`, async () => {
  const v = voiceSetup(); const saying = v.speaker.say('Old step', 'step');
  assert.equal(v.lines[0], 'Old step');
  if (action === 'stop') await v.speaker.stopAll(); else v.speaker.setMuted(true);
  v.resolveAudio(v.requests[0]); await saying;
  assert.equal(v.played.length, 0); assert.equal(v.speech.length, 0);
});

test('pending speaker serializes same-priority requests and stop alerts interrupt generation', async () => {
  const v = voiceSetup(); const first = v.speaker.say('Old intro', 'step');
  await v.speaker.say('New intro', 'step'); assert.equal(v.requests.length, 1);
  const urgent = v.speaker.say('Pull the pan off the heat.', 'stop'); await flush();
  assert.equal(v.requests.length, 2);
  v.resolveAudio(v.requests[0]); await first; assert.equal(v.played.length, 0);
  v.resolveAudio(v.requests[1]); await urgent; assert.equal(v.played.length, 1);
  await v.speaker.stopAll();
});

test('prefetch and speech share one TTS request per line; failures retain device fallback', async () => {
  const v = voiceSetup(); const prefetched = v.speaker.prefetch(['Same line']); const saying = v.speaker.say('Same line', 'step');
  assert.equal(v.requests.length, 1); v.resolveAudio(v.requests[0]); await Promise.all([prefetched, saying]);
  assert.equal(v.played.length, 1); await v.speaker.stopAll();
  const fallback = v.speaker.say('Fallback line', 'step');
  v.requests[1].reject(new Error('mock unavailable')); await fallback;
  assert.equal(v.speech[0].text, 'Fallback line');
});

test('reference processing reports failures separately from attempted completion', async () => {
  let upload = 0; const reports = [];
  const load = loader({
    'lib/demo.ts': { isDemoMode: () => false },
    'expo-video-thumbnails': { getThumbnailAsync: async () => ({ uri: 'mock://thumb' }) },
    'lib/image.ts': { resizeJpeg: async () => ({ uri: 'mock://small', base64: 'AA==' }), base64ToArrayBuffer: () => new ArrayBuffer(1), deleteQuietly: () => {} },
    'lib/supabase.ts': { supabase: { storage: { from: () => ({ upload: async () => ({ error: upload++ === 0 ? { message: 'mock failure' } : null }) }) }, from: () => ({ upsert: async () => ({ error: null }) }) } },
  });
  const r = recipe(load); r.steps = r.steps.slice(0, 2);
  await load('lib/refFrames.ts').uploadRefFrames('mock://video', 'recipe', 'version', r, p => reports.push(p));
  assert.deepEqual(plain(reports.at(-1)), { done: 2, total: 2, succeeded: 1, failed: 1, scripted: false });
});

test('shared guards/options/prompts are synchronized with app copies', () => {
  for (const [app, shared] of [['lib/guards.ts', 'supabase/functions/_shared/guards.ts'], ['lib/recipeOptions.ts', 'supabase/functions/_shared/recipeOptions.ts'], ['prompts/index.ts', 'supabase/functions/_shared/prompts.ts']]) {
    const normalize = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n').replace("'https://esm.sh/zod@3'", "'zod'").replace("'./guards.ts'", "'./guards'");
    assert.equal(normalize(app), normalize(shared), `${app} differs from ${shared}`);
  }
});

// Fluent local Supabase mock. All reads/writes below affect these arrays only.
function mockDatabase(tables, failWrite = () => false) {
  const writes = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = 'read'; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { return this.eq(key, value); }
    not(key, _op, value) { this.filters.push(row => row[key] !== value); return this; }
    order(key, options = {}) { this.ordering = [key, options.ascending !== false]; return this; }
    limit(n) { this.limitN = n; return this; }
    update(values) { this.operation = 'update'; this.values = values; return this; }
    insert(values) { this.operation = 'insert'; this.values = values; return this; }
    upsert(values) { this.operation = 'upsert'; this.values = values; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; this.optional = true; return this; }
    then(resolve, reject) {
      try {
        let rows = (tables[this.table] ?? []).filter(row => this.filters.every(f => f(row)));
        if (this.operation !== 'read') {
          writes.push({ table: this.table, operation: this.operation, values: plain(this.values) });
          if (failWrite(this.table, this.operation, this.values)) return Promise.resolve({ data: null, error: { message: 'mock write failed' } }).then(resolve, reject);
          if (this.operation === 'update') rows.forEach(row => Object.assign(row, this.values));
          else {
            rows = (Array.isArray(this.values) ? this.values : [this.values]).map((v, i) => ({ id: `saved-${writes.length}-${i}`, is_best: false, created_at: new Date().toISOString(), ...plain(v) }));
            (tables[this.table] ??= []).push(...rows);
          }
        }
        if (this.ordering) { const [key, asc] = this.ordering; rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (asc ? 1 : -1)); }
        if (this.limitN) rows = rows.slice(0, this.limitN);
        const error = this.one && !this.optional && !rows[0] ? { message: 'mock row not found' } : null;
        return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  return { writes, from: table => new Query(table), storage: { from: () => ({ download: async () => ({ data: null }) }) } };
}

function backendSetup({ stub = false, adapt = true, modelResult, failWrite } = {}) {
  let handler; const calls = [];
  const initial = loader(); const r = adapt ? omittedRecipe(initial) : recipe(initial);
  const tables = {
    cooks: [{ id: 'cook', recipe_id: 'recipe', base_version_id: 'child', ended_at: null, saved_version_id: null, started_at: new Date().toISOString(), rating: null, notes: null }],
    versions: [{ id: 'child', recipe_id: 'recipe', number: 2, parent_id: 'source', recipe_json: r, diff_json: [], rating: null, notes: null, is_best: false, created_at: new Date().toISOString() }],
    recipes: [{ id: 'recipe', title: r.title }], ref_frames: [], cook_events: [],
  };
  const database = mockDatabase(tables, failWrite);
  const load = loader({
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => database },
    'supabase/functions/_shared/gemini.ts': { STUB_MODE: stub, bytesToBase64: () => 'AA==', geminiGenerate: async opts => { calls.push(opts); return JSON.stringify(modelResult ?? initial('lib/demoData.ts').DEMO_RECAP); } },
    'lib/demo.ts': { isDemoMode: () => false },
    'lib/supabase.ts': { supabase: database, DEMO_USER_ID: 'test-only' },
    'expo-file-system': { File: class {} },
  }, { Deno: { env: { get: () => 'test-only' }, serve: fn => { handler = fn; } } });
  const serve = file => { load(file); return async body => plain(await (await handler(new Request('http://test-only.local', { method: 'POST', body: JSON.stringify(body) }))).json()); };
  return { serve, load, tables, database, calls, recipe: r };
}

test('backend capability probes perform no database writes and identify STUB_MODE', async () => {
  for (const file of ['coach-frame', 'recap']) {
    const b = backendSetup({ stub: true });
    const result = await b.serve(`supabase/functions/${file}/index.ts`)({ capability_check: true });
    assert.equal(result.adaptation_contract, 'ingredient-options-v1'); assert.equal(result.scripted, true);
    assert.equal(b.database.writes.length, 0); assert.equal(b.calls.length, 0);
  }
});

test('backend coach resolves selected child version and skips a wholly omitted source step', async () => {
  const b = backendSetup();
  const result = await b.serve('supabase/functions/coach-frame/index.ts')({ cook_id: 'cook', step_n: 3, user_frame_b64: 'AA==' });
  assert.equal(result.intentionally_skipped, true); assert.equal(result.event, null);
  assert.equal(b.calls.length, 0); assert.equal(b.database.writes.length, 0);
});

test('backend coach supplies adapted expectations/quantities and rejects an omitted detection', async () => {
  const initial = loader();
  const ev = initial('lib/demoData.ts').DEMO_COACH_SCRIPT[4][0].event;
  const b = backendSetup({ modelResult: ev });
  const soy = b.recipe.ingredients.find(i => i.name === 'soy sauce'); soy.omitted = true;
  const result = await b.serve('supabase/functions/coach-frame/index.ts')({ cook_id: 'cook', step_n: 4, user_frame_b64: 'AA==' });
  assert.equal(result.event, null);
  const prompt = b.calls[0].parts.at(-1).text;
  assert.match(prompt, /Expected ingredients this step: honey/);
  assert.match(prompt, /Intentional changes:.*Omit soy sauce/);
  assert.equal(b.tables.cook_events.length, 0);
});

test('backend STUB_MODE does not replay source coaching for an adapted recipe', async () => {
  const b = backendSetup({ stub: true });
  const result = await b.serve('supabase/functions/coach-frame/index.ts')({ cook_id: 'cook', step_n: 4, user_frame_b64: 'AA==' });
  assert.equal(result.scripted, true); assert.equal(result.event, null); assert.equal(b.tables.cook_events.length, 0);
});

test('backend recap preserves omissions and rejects source-only diff/advice', async () => {
  const b = backendSetup();
  const result = await b.serve('supabase/functions/recap/index.ts')({ cook_id: 'cook', rating: 8, notes: 'No garlic on purpose' });
  assert.equal(result.ok, true); assert.equal(result.scripted, false);
  assert(result.proposed_version.ingredients.find(i => i.name === 'garlic').omitted);
  assert(!result.diff.some(d => d.field.toLowerCase().includes('garlic')));
  assert.equal(result.suggestion, null);
  assert.deepEqual(result.proposed_version.steps.map(s => [s.n, s.ref_frame_sec]), b.recipe.steps.map(s => [s.n, s.ref_frame_sec]));
});

test('backend adapted STUB recap is clearly scripted and makes no inferred measurements', async () => {
  const b = backendSetup({ stub: true });
  const result = await b.serve('supabase/functions/recap/index.ts')({ cook_id: 'cook' });
  assert.equal(result.scripted, true); assert.equal(result.diff.length, 0);
  assert.match(result.spoken_recap, /STUB_MODE cannot measure/);
  assert(result.proposed_version.ingredients.find(i => i.name === 'garlic').omitted);
});

test('cloud data layer saves a child without a fake cook, copies references, and activates that exact version', async () => {
  const b = backendSetup(); const db = b.load('lib/db.ts');
  b.tables.ref_frames.push({ version_id: 'child', step_n: 3, storage_path: 'source/step-3.jpg' });
  const saved = await db.saveVersion({ recipeId: 'recipe', parentId: 'child', recipe: b.recipe, diff: [], rating: null, notes: 'intentional' });
  assert.equal(saved.number, 3); assert.equal(saved.parent_id, 'child');
  assert(b.tables.ref_frames.some(f => f.version_id === saved.id && f.step_n === 3 && f.storage_path === 'source/step-3.jpg'));
  assert(!b.database.writes.some(w => w.table === 'cooks'));
  await db.activateCookVersion('cook', saved.id);
  assert.equal(b.tables.cooks[0].base_version_id, saved.id);
  assert.equal(b.tables.versions.length, 2);
});

test('partial reference-copy failure returns saved child and explicit warning, not false complete success', async () => {
  const b = backendSetup({ failWrite: (table, op) => table === 'ref_frames' && op === 'upsert' });
  b.tables.ref_frames.push({ version_id: 'child', step_n: 3, storage_path: 'source/step-3.jpg' });
  const saved = await b.load('lib/db.ts').saveVersion({ recipeId: 'recipe', parentId: 'child', recipe: b.recipe, diff: [], rating: null, notes: 'intentional' });
  assert(saved.id); assert.match(saved.save_warnings[0], /copying reference-frame links failed/);
  assert.equal(b.tables.versions.length, 2);
});

test('failed cook attachment is retriable without creating a duplicate child', async () => {
  let fail = true;
  const b = backendSetup({ failWrite: table => table === 'cooks' && fail }); const db = b.load('lib/db.ts');
  const saved = await db.saveVersion({ recipeId: 'recipe', parentId: 'child', recipe: b.recipe, diff: [], rating: null, notes: 'intentional' });
  await assert.rejects(db.activateCookVersion('cook', saved.id), /mock write failed/);
  assert.equal(b.tables.cooks[0].base_version_id, 'child');
  fail = false; await db.activateCookVersion('cook', saved.id);
  assert.equal(b.tables.cooks[0].base_version_id, saved.id); assert.equal(b.tables.versions.length, 2);
});

test('preset guidance excludes omissions and uses confirmed quantities from the selected version', () => {
  const load = loader(); const r = omittedRecipe(load); const { answerRecipeQuestion: answer } = load('lib/recipeGuidance.ts');
  assert.match(answer('howmuch', r, 3), /intentionally omitted/);
  assert.match(answer('next', r, 2), /intentionally omitted/);
  assert.match(answer('look', r, 3), /not an exact target/);
  const soy = r.ingredients.find(i => i.name === 'soy sauce');
  soy.source_qty = soy.qty; soy.source_unit = soy.unit; soy.qty = '1'; soy.confidence = 0.1;
  assert.match(answer('howmuch', r, 4), /^1 tbsp soy sauce/);
  assert(!answer('howmuch', r, 4).startsWith('about 1'));
});

test('new speech waits for a delayed device stop rather than being cancelled by it', async () => {
  const stopped = deferred(); const v = voiceSetup({}, () => stopped.promise);
  const first = v.speaker.say('Device fallback', 'step');
  v.requests[0].reject(new Error('mock unavailable')); await first;
  const stopping = v.speaker.stopAll(); const second = v.speaker.say('New step', 'step');
  await flush(); assert.equal(v.requests.length, 1);
  stopped.resolve(); await stopping; await flush();
  assert.equal(v.requests.length, 2); v.resolveAudio(v.requests[1]); await second;
  assert.equal(v.played.length, 1);
});

test('original baseline commit reproduces stale coach and pending-speech bugs under the same mocks', async () => {
  const { execFileSync } = require('node:child_process');
  const source = file => execFileSync('git', ['show', `4e7dece43301899df3d196709c3488f099799e75:${file}`], { cwd: root, encoding: 'utf8' });
  const response = deferred();
  const originalVision = visionSetup({ response, sources: { 'lib/visionLoop.ts': source('lib/visionLoop.ts') } });
  originalVision.loop.start(); const tick = originalVision.loop.tick(); await flush();
  originalVision.loop.stop();
  response.resolve({ data: { ok: true, event: originalVision.load('lib/demoData.ts').DEMO_COACH_SCRIPT[1][0].event }, error: null });
  await tick; assert.equal(originalVision.events.length, 1, 'baseline bug: stopped loop still delivers a late event');
  const originalVoice = voiceSetup({ 'lib/voice.ts': source('lib/voice.ts') });
  const speaking = originalVoice.speaker.say('Old pending step', 'step'); await originalVoice.speaker.stopAll();
  originalVoice.resolveAudio(originalVoice.requests[0]); await speaking;
  assert.equal(originalVoice.played.length, 1, 'baseline bug: cancelled TTS generation still starts audio');
  await originalVoice.speaker.stopAll();
});

function cookHarness({ failAttachOnce = false } = {}) {
  // Hook/event smoke test, not a native render or layout test.
  const cells = []; let index = 0; let dirty = true; let tree; let component; const pendingEffects = [];
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const n = index++; if (!cells[n]) cells[n] = { value: typeof initial === 'function' ? initial() : initial }; return [cells[n].value, value => { cells[n].value = typeof value === 'function' ? value(cells[n].value) : value; dirty = true; }]; },
    useRef(initial) { const n = index++; return cells[n] ??= { current: initial }; },
    useEffect(fn, deps) { const n = index++; if (!equalDeps(cells[n]?.deps, deps)) { const old = cells[n]; cells[n] = { deps }; pendingEffects.push(() => { old?.cleanup?.(); cells[n].cleanup = fn(); }); } },
    useCallback(fn, deps) { const n = index++; if (!equalDeps(cells[n]?.deps, deps)) cells[n] = { value: fn, deps }; return cells[n].value; },
  };
  const dataLoad = loader(); const db = dataLoad('lib/demoDb.ts').demoDb; const ids = dataLoad('lib/demoData.ts').DEMO_IDS;
  const capability = deferred(); const counts = { save: 0, attach: 0, capability: 0 }; const spoken = []; const loops = [];
  const load = loader({
    react: hooks,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', Modal: 'Modal', Pressable: 'Pressable', StyleSheet: { create: value => value, absoluteFill: {} }, Alert: { alert() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { back() {}, replace() {} }, useLocalSearchParams: () => ({ recipeId: ids.recipe }) },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: false }, async () => {}] },
    'expo-keep-awake': { useKeepAwake() {} },
    'expo-haptics': { selectionAsync: async () => {}, impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    'components/ui.tsx': Object.fromEntries(['Button', 'Centered', 'Chip', 'ErrorBox', 'Muted'].map(name => [name, name])),
    'lib/demo.ts': { useDemoMode: () => true },
    'lib/supabase.ts': { requireAdaptationBackend: () => { counts.capability++; return capability.promise; } },
    'lib/voice.ts': { speaker: { isMuted: false, gate: { reset() {} }, prefetch: async () => {}, stopAll: async () => {}, setMuted() {}, say: async line => { spoken.push(line); } } },
    'lib/visionLoop.ts': { VisionLoop: class { constructor(_camera, r) { this.recipe = r; loops.push(this); } start() { this.active = true; } stop() { this.active = false; } setStep(n) { this.step = n; } } },
    'lib/db.ts': { ...db, saveVersion: async opts => { counts.save++; return db.saveVersion(opts); }, activateCookVersion: async (...args) => { counts.attach++; if (failAttachOnce && counts.attach === 1) throw new Error('mock attachment failed'); return db.activateCookVersion(...args); } },
  });
  component = load('app/cook/[recipeId].tsx').default;
  function render() {
    for (let safety = 0; dirty && safety < 20; safety++) { dirty = false; index = 0; tree = component(); pendingEffects.splice(0).forEach(effect => effect()); }
    assert(!dirty, 'hook renders should settle');
    return tree;
  }
  function find(predicate, node) {
    if (arguments.length === 1) node = render();
    if (Array.isArray(node)) return node.flatMap(child => find(predicate, child));
    if (!node || typeof node !== 'object' || !node.props) return [];
    if (node.type === 'Modal' && !node.props.visible) return [];
    if (typeof node.type === 'function') return find(predicate, node.type(node.props));
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props.children)];
  }
  const button = title => { const result = find(node => node.type === 'Button' && node.props.title === title)[0]; assert(result, `button ${title} exists`); return result.props; };
  const pressLabel = label => { const result = find(node => node.props.accessibilityLabel === label)[0]; assert(result, `${label} exists`); result.props.onPress(); render(); };
  async function settle() { await flush(); render(); await flush(); render(); }
  async function waitFor(predicate) { for (let i = 0; i < 100 && !predicate(); i++) { await new Promise(r => setTimeout(r, 10)); render(); } assert(predicate(), 'expected async screen state'); }
  return { render, find, button, pressLabel, settle, waitFor, capability, counts, loops, db, ids, spoken,
    unmount: () => cells.forEach(cell => cell?.cleanup?.()) };
}

test('cook screen omission pauses coaching, blocks duplicate saves, applies the saved child, and guides from it', async () => {
  const h = cookHarness(); h.render(); await new Promise(r => setTimeout(r, 100)); await h.settle();
  h.button('Next step').onPress(); h.render(); h.button('Next step').onPress(); h.render();
  h.pressLabel('Omit garlic'); assert(h.loops.every(loop => !loop.active));
  assert(h.button("I'm done").disabled);
  const save = h.button('Save child version & apply'); save.onPress(); save.onPress();
  await h.settle(); assert.equal(h.counts.capability, 1); assert.equal(h.counts.save, 0);
  h.capability.resolve(); await h.waitFor(() => h.find(node => node.type === 'Chip' && node.props.label === 'v2').length > 0);
  assert.equal(h.counts.save, 1); assert.equal(h.counts.attach, 1);
  assert(h.loops.at(-1).recipe.ingredients.find(i => i.name === 'garlic').omitted);
  h.pressLabel('Preset recipe guidance'); h.button('How much goes in?').onPress(); await h.settle();
  assert.match(h.spoken.at(-1), /intentionally omitted/);
  assert(!(await h.db.getVersion(h.ids.version1)).recipe_json.ingredients.find(i => i.name === 'garlic').omitted);
  h.pressLabel('Undo omission of garlic'); assert(h.button("I'm done").disabled);
  h.button('Undo draft').onPress(); h.render(); assert(!h.button("I'm done").disabled);
  h.unmount();
});

test('cook screen retains a saved child after attach failure and retries without a duplicate insert', async () => {
  const h = cookHarness({ failAttachOnce: true }); h.render(); await new Promise(r => setTimeout(r, 100)); await h.settle();
  h.button('Next step').onPress(); h.render(); h.button('Next step').onPress(); h.render();
  h.pressLabel('Omit garlic'); h.capability.resolve(); h.button('Save child version & apply').onPress();
  await h.waitFor(() => h.find(node => node.type === 'Button' && node.props.title === 'Retry attach saved version' && !node.props.loading).length > 0);
  assert.equal(h.counts.save, 1); assert(h.loops.every(loop => !loop.active));
  h.button('Retry attach saved version').onPress(); await h.waitFor(() => h.find(node => node.type === 'Chip' && node.props.label === 'v2').length > 0);
  assert.equal(h.counts.save, 1); assert.equal(h.counts.attach, 2);
  h.unmount();
});

test('backend observation write failure returns an actionable error instead of successful coaching', async () => {
  const initial = loader(); const b = backendSetup({ adapt: false, modelResult: initial('lib/demoData.ts').DEMO_COACH_SCRIPT[1][0].event, failWrite: table => table === 'cook_events' });
  const result = await b.serve('supabase/functions/coach-frame/index.ts')({ cook_id: 'cook', step_n: 1, user_frame_b64: 'AA==' });
  assert.equal(result.ok, false); assert.match(result.error, /Could not save the observation/);
});

test('recap stops before model analysis when saving cook details fails', async () => {
  const b = backendSetup({ failWrite: table => table === 'cooks' });
  const result = await b.serve('supabase/functions/recap/index.ts')({ cook_id: 'cook' });
  assert.equal(result.ok, false); assert.match(result.error, /Retry when connected/); assert.equal(b.calls.length, 0);
});

test('app capability gate requires both deployed functions and sends read-only probes', async () => {
  const calls = [];
  const load = loader({
    '@supabase/supabase-js': { createClient: () => ({ functions: { invoke: async (name, opts) => { calls.push({ name, body: opts.body }); return { data: name === 'coach-frame' ? { ok: true, adaptation_contract: 'ingredient-options-v1' } : { ok: false, error: 'old deployment' }, error: null }; } } }) },
    'lib/demo.ts': { isDemoMode: () => false },
  });
  await assert.rejects(load('lib/supabase.ts').requireAdaptationBackend(), /coach-frame and recap/);
  assert.equal(calls.length, 2); assert(calls.every(call => call.body.capability_check === true && !call.body.cook_id));
});
