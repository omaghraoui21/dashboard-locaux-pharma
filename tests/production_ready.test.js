/**
 * Durable production-readiness tests against SHIPPED package files.
 * Run: node tests/production_ready.test.js
 * Exit 0 only if all assertions pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}: ${err.message}`);
    failures.push(name);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// --- Load shipped plant-domain.js (real entry) ---
const plantSrc = read('plant-domain.js');
const windowObj = {};
vm.runInNewContext(plantSrc, { window: windowObj, console });
const PD = windowObj.PlantDomain;
assert.ok(PD, 'PlantDomain not exported by plant-domain.js');

// --- Load supabase-client resolveConfig by extracting function via real module pattern ---
// Client is IIFE; we re-run a minimal sandbox that exposes resolveConfig through config side-effect.
const clientSrc = read('supabase-client.js');
const clientWindow = {
  PHARMA_SUPABASE_CONFIG: {
    enabled: true,
    url: 'https://rzxnowngjudicmwzjdjo.supabase.co',
    publishableKey: 'sb_publishable_test_key_for_unit',
    schema: 'locaux_dash'
  },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  addEventListener() {},
  location: { protocol: 'https:', href: 'https://example.test/dashboard.html' },
  document: { readyState: 'complete', addEventListener() {} }
};
// Prevent initialize network by stubbing load path — only need resolveConfig via PharmaSync if exposed
// Execute client; initialize may warn but should attach PharmaSync
try {
  vm.runInNewContext(clientSrc, {
    window: clientWindow,
    console: { log() {}, warn() {}, error() {} },
    location: clientWindow.location,
    document: clientWindow.document,
    localStorage: clientWindow.localStorage,
    setTimeout,
    clearTimeout
  });
} catch (_) {
  // initialize may fail without DOM/CDN; PharmaSync may still be set partially
}

check('plant-domain exports DEFAULT_ARTICLES with FSF/PF', () => {
  assert.ok(Array.isArray(PD.DEFAULT_ARTICLES) && PD.DEFAULT_ARTICLES.length >= 10);
  const codes = new Set(PD.DEFAULT_ARTICLES.map(a => a.code));
  ['FSF600', 'FSF602', 'FSF603', 'FSF604', 'FSF605', 'FSF606', 'FSF607', 'PF600', 'PF605'].forEach(c => {
    assert.ok(codes.has(c), `missing article ${c}`);
  });
});

check('productLabel uses real article codes', () => {
  const a = PD.DEFAULT_ARTICLES.find(x => x.code === 'FSF600');
  const label = PD.productLabel(a);
  assert.ok(label.includes('FSF600'));
  assert.ok(label.includes(a.label));
});

check('nextLotNumber increments from existing batches', () => {
  const year = String(new Date().getFullYear()).slice(-2);
  const lot = PD.nextLotNumber('FSF600', [
    { product: 'FSF600 · x', batch: `${year}001` },
    { product: 'FSF600 · x', batch: `${year}007` }
  ], []);
  assert.strictEqual(lot, `${year}008`);
});

check('storageHandoffFromComplete A27 → A26', () => {
  const rooms = [
    { id: 2, code: 'A27', kind: 'geluleuse', name: 'A27' },
    { id: 3, code: 'A26', kind: 'stock_primaire', name: 'A26' }
  ];
  const activity = {
    id: 'act_test_1',
    roomId: 2,
    product: 'FSF600 · Aerofor',
    batch: '26001',
    team: 'Équipe A',
    owner: '—'
  };
  const handoff = PD.storageHandoffFromComplete(activity, rooms);
  assert.ok(handoff, 'expected handoff');
  assert.strictEqual(handoff.roomId, 3);
  assert.ok(String(handoff.activity).includes('A26') || String(handoff.comment).includes('Auto'));
  assert.strictEqual(handoff.batch, '26001');
});

check('storage handoff ignores cleaning and missing lots', () => {
  const rooms = [
    { id: 1, code: 'A23', kind: 'process' },
    { id: 3, code: 'A26', kind: 'stock_primaire' }
  ];
  assert.strictEqual(PD.storageHandoffFromComplete({ roomId: 1, activity: 'Nettoyage', product: '—', batch: '—' }, rooms), null);
  assert.strictEqual(PD.storageHandoffFromComplete({ roomId: 1, activity: 'Lot en cours', product: 'FSF600', batch: '—' }, rooms), null);
});

check('stockAt returns A26 balances by article and lot at the selected instant', () => {
  const balances = PD.stockAt([
    { sens: 'entree', articleCode: 'FSF600', batch: '26001', qty: 1000, futs: 10, unit: 'gélules', at: '2026-07-12T08:00:00Z' },
    { sens: 'sortie', articleCode: 'FSF600', batch: '26001', qty: 300, futs: 2, unit: 'gélules', at: '2026-07-12T09:00:00Z' },
    { sens: 'entree', articleCode: 'FSF600', batch: '26002', qty: 200, futs: 1, unit: 'gélules', at: '2026-07-12T09:30:00Z' },
    { sens: 'sortie', articleCode: 'FSF600', batch: '26001', qty: 700, futs: 8, unit: 'gélules', at: '2026-07-12T11:00:00Z' }
  ], '2026-07-12T10:00:00Z');
  assert.strictEqual(balances.length, 2);
  assert.deepStrictEqual(
    Array.from(balances, row => [row.articleCode, row.batch, row.qty, row.futs]),
    [['FSF600', '26001', 700, 8], ['FSF600', '26002', 200, 1]]
  );
});

check('D08/D18 article catalog follows the plant workflow', () => {
  const d08 = PD.articlesForRoomKind(PD.DEFAULT_ARTICLES, 'cond_sec_continuite').map(a => a.code);
  const d18 = PD.articlesForRoomKind(PD.DEFAULT_ARTICLES, 'cond_sec_assemblage').map(a => a.code);
  assert.deepStrictEqual(Array.from(d08), ['PF600', 'PF601', 'PF602', 'PF603']);
  assert.ok(d18.includes('PF604') && d18.includes('PF605') && d18.includes('FSF604'));
  assert.ok(!d18.includes('PF600'));
  assert.strictEqual(PD.normalizeArticle({ code: 'MF1', family: 'MF' }, 0).family, 'MF');
});

check('parseCsv + toCsv round-trip columns', () => {
  const csv = PD.toCsv([{
    local_code: 'A23', type: 'Lot en cours', article_code: 'FSF600', lot: '26001',
    plan_start: '2026-07-11T08:00', plan_end: '2026-07-11T12:00',
    qty_theorique: '360000', unit: 'gélules', futs: '10', status: 'planned', step: '', comment: 't'
  }]);
  const parsed = PD.parseCsv(csv);
  assert.ok(parsed.rows.length >= 1);
  assert.strictEqual(parsed.rows[0].local_code, 'A23');
  assert.strictEqual(parsed.rows[0].article_code, 'FSF600');
});

check('CSV keeps decimal commas and neutralizes spreadsheet formulas', () => {
  const parsed = PD.parseCsv('local_code;qty_theorique;comment\nA23;9,5;"texte, conservé"');
  assert.strictEqual(parsed.rows[0].qty_theorique, '9,5');
  assert.strictEqual(parsed.rows[0].comment, 'texte, conservé');
  const csv = PD.toCsv([{ local_code: 'A23', comment: '=HYPERLINK("https://example.test")' }]);
  assert.ok(csv.includes("'=HYPERLINK"));
});

check('shipped HTML cloud config is production-shaped', () => {
  const html = read('dashboard_4_locaux_pharma.html');
  assert.ok(/enabled:\s*true/.test(html), 'enabled:true required');
  assert.ok(html.includes('locaux_dash'), 'schema locaux_dash required');
  assert.ok(/rzxnowngjudicmwzjdjo\.supabase\.co/.test(html), 'trs-pharma host required');
  assert.ok(/sb_publishable_/.test(html), 'publishable client key present');
  assert.ok(!/anonKey:\s*['"]eyJ/.test(html), 'legacy anon JWT must not be shipped');
  assert.ok(!/service_role/.test(html), 'service_role must not appear in HTML');
  assert.ok(!/\bsbp_/.test(html), 'sbp_ management token must not appear in HTML');
  assert.ok(html.includes('plant-domain.js'), 'plant-domain script tag');
  assert.ok(html.includes('supabase-client.js'), 'supabase-client script tag');
  assert.ok(html.includes('A23'), 'plant code A23');
  assert.ok(html.includes('@supabase/supabase-js@2.110.2/'), 'Supabase SDK must be pinned');
  assert.ok(html.includes('libraryIntegrity'), 'Supabase SDK integrity required');
  assert.ok(html.includes('Content-Security-Policy'), 'CSP required');
  const seedBlock = html.slice(html.indexOf('function buildSeedState'), html.indexOf('function normalizeState'));
  assert.ok(seedBlock.includes('activities:[]'), 'production seed must start without activities');
  assert.ok(!seedBlock.includes('AF12-260701'), 'demo activity must not exist in the production seed');
  assert.ok(html.includes('snapshot.articles') && html.includes('snapshot.movements'), 'remote articles and stock snapshot required');
  assert.ok(/function toggleArticle[\s\S]*?logChange\(/.test(html), 'article toggles must mark the seed as changed');
  assert.ok(!/name\)\.toUpperCase\(\)\.includes\(localCode\)/.test(html), 'CSV room matching must not accept partial names');
  assert.ok(html.includes('id="stockSummaryBody"') && html.includes('id="stockRecentBody"'), 'visible A26 overview required');
  assert.ok(/id="stockAtFilter"[^>]*type="datetime-local"/.test(html), 'stock instant selector required');
  assert.ok(/id="mAt"[^>]*type="datetime-local"[^>]*required/.test(html), 'effective movement time required');
  assert.ok(html.includes('Toutes les données (CSV)') && html.includes('exportAllCSV()') && html.includes('exportStockCSV()'), 'complete and stock exports required');
  assert.ok(/function exportStockCSV\(\)[\s\S]*?reference=stockReferenceTime\(\)[\s\S]*?filter\(movement=>new Date\(movement\.at\)<=reference\)/.test(html), 'stock export must respect the selected instant');
  ['LOCAUX', 'ACTIVITÉS', 'ARTICLES', 'MOUVEMENTS A26', 'PARAMÈTRES', 'JOURNAL'].forEach(section => assert.ok(html.includes(`'${section}'`), `missing full export section ${section}`));
  assert.ok(/getMovements\(\)[\s\S]*?slice\(0,20\)/.test(html), 'A26 overview must keep the latest 20 movements');
  assert.ok(/effectiveAt\.getTime\(\)>Date\.now\(\)\+60000/.test(html), 'future stock movements must be rejected');
});

check('root redirect preserves Supabase auth parameters', () => {
  const index = read('index.html');
  const source = read('redirect.js');
  const redirects = [];
  assert.ok(index.includes('src="redirect.js"'), 'root must load the redirect script');
  assert.ok(!/http-equiv="refresh"/i.test(index), 'meta refresh would discard the auth fragment');
  vm.runInNewContext(source, {
    location: {
      search: '?code=one-time-code',
      hash: '#access_token=session-token',
      replace: value => redirects.push(value)
    }
  });
  assert.deepStrictEqual(Array.from(redirects), [
    'dashboard_4_locaux_pharma.html?code=one-time-code#access_token=session-token'
  ]);
});

check('inline scripts parse and dynamic IDs are encoded', () => {
  const html = read('dashboard_4_locaux_pharma.html');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), `inline script ${index + 1}`));
  assert.ok(html.includes('function inlineArg'));
  assert.ok(!html.includes("openEditActivity('${"));
  assert.ok(!html.includes("openCalendarActivity('${"));
});

check('production content is auth-gated and local operational data is cleared when signed out', () => {
  const html = read('dashboard_4_locaux_pharma.html');
  const client = read('supabase-client.js');
  assert.ok(/id="loginGate"/.test(html), 'login gate required');
  assert.ok(/id="dashboardApp"[^>]*hidden/.test(html), 'dashboard must start hidden');
  assert.ok(/syncContext\.authenticated&&\['manager','planner'\]\.includes\(syncContext\.role\)/.test(html), 'authorized role required to reveal dashboard');
  assert.ok(!/allowed=!syncContext\.enabled/.test(html), 'disabled Supabase must never bypass authentication');
  assert.ok(!html.includes('id="authDialog"'), 'login gate must not be closable as a dialog');
  assert.ok(html.includes('let state = buildSeedState();') && !html.includes('state = loadState();'), 'cached operational data must not load before authentication');
  assert.ok(/@media\(max-width:760px\)[^\n]*\.action-menu-popover\{left:auto;right:0\}/.test(html), 'mobile action menus must stay inside the viewport');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.strictEqual(new Set(ids).size, ids.length, 'HTML IDs must be unique');
  for (const key of ['CACHE_KEY', 'OUTBOX_KEY', 'META_KEY', "'pharma_rooms'", "'pharma_history'"]) assert.ok(client.includes(key), `cache key ${key} must be removed`);
  assert.ok(client.includes('localStorage.removeItem(key)'), 'all operational cache keys must be removed');
  assert.ok(client.includes('adapter()?.hydrateLocalData?.();') && html.includes('hydrateLocalData:()=>'), 'local cache must hydrate only after profile validation');
  assert.ok(/if \(!session\?\.user\)[\s\S]*?clearLocalData\(\);[\s\S]*?publishContext\(\)/.test(client), 'signed-out session must clear operational data before publishing context');
  assert.ok(/Profil applicatif non autorisé\.[\s\S]*?catch \(error\)[\s\S]*?clearLocalData\(\)/.test(client), 'authenticated users without an allowed profile must also lose cached data');
  const syncFailure = client.slice(client.indexOf("console.error('[PharmaSync] Synchronisation initiale impossible'"), client.indexOf('\n  async function signInWithPassword'));
  assert.ok(syncFailure.includes('Les données locales sont conservées.') && !syncFailure.includes('clearLocalData()'), 'validated sessions must keep local data during a sync outage');
  assert.ok(/if \(!runtime\.enabled\) \{\s*clearLocalData\(\)/.test(client), 'disabled secure backend must purge local data');
  assert.ok(/auth\.signOut\(\{ scope: 'local' \}\)/.test(client), 'logout must affect only the current device');
});

check('client-served JS has no admin secrets', () => {
  for (const f of ['supabase-client.js', 'plant-domain.js', 'redirect.js']) {
    const t = read(f);
    assert.ok(!/service_role/.test(t), `${f} must not contain service_role`);
    assert.ok(!/\bsbp_/.test(t), `${f} must not contain sbp_`);
    assert.ok(!/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(t), `${f} must not contain GitHub tokens`);
    assert.ok(!/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(t), `${f} must not contain JWT secrets`);
  }
});

check('deployment documentation matches the authenticated product', () => {
  const setup = read('README_SUPABASE.md');
  const tokens = read('TOKENS_ET_DEPLOIEMENT.md');
  for (const missing of ['MIGRATION_LOCALSTORAGE_V3.md', 'supabase-config.example.js', '.env.example']) {
    assert.ok(!setup.includes(missing), `documentation must not reference missing ${missing}`);
  }
  assert.ok(!/mode local-first|PIN Planificateur en local|Compte cloud \| Non/i.test(`${setup}\n${tokens}`), 'documentation must not advertise an authentication bypass');
  assert.ok(tokens.includes('Compte Supabase autorisé') && setup.includes('obligatoire pour afficher les données'), 'login requirement must be explicit');
});

check('DEFAULT_PLANT room kinds cover A23–D18 via HTML seed or domain', () => {
  const html = read('dashboard_4_locaux_pharma.html');
  for (const code of ['A23', 'A27', 'A26', 'A28', 'D08', 'D18']) {
    assert.ok(html.includes(code), `HTML must reference ${code}`);
  }
});

check('resolveConfig-equivalent prefers publishableKey (shipped client source)', () => {
  // Drive real resolveConfig string from shipped source
  const src = read('supabase-client.js');
  assert.ok(src.includes('publishableKey || globalConfig.anonKey'), 'key resolution order');
  assert.ok(src.includes("schema: globalConfig.schema || 'public'"), 'schema resolution');
  assert.ok(src.includes('db = { schema:'), 'custom schema client option');
});

check('disabled Supabase initialization purges operational and legacy cache', () => {
  const keys = ['pharma_ops_dashboard_v2', 'pharma_ops_sync_queue_v4', 'pharma_ops_sync_meta_v4', 'pharma_rooms', 'pharma_history'];
  const storage = {
    _d: Object.fromEntries(keys.map(key => [key, 'stale'])),
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  const testWindow = {
    PHARMA_SUPABASE_CONFIG: { enabled: false }, localStorage: storage,
    PharmaDashboardAdapter: { getState: () => ({}), setSyncContext() {}, notify() {}, clearLocalData() {} },
    addEventListener() {}, location: { protocol: 'https:', href: 'https://example.test/' }
  };
  vm.runInNewContext(clientSrc, {
    window: testWindow, document: { readyState: 'complete', addEventListener() {} },
    localStorage: storage, location: testWindow.location, navigator: { onLine: true },
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout
  });
  keys.forEach(key => assert.strictEqual(storage.getItem(key), null, `${key} must be purged`));
});

check('state capture queues articles and stock movements from an explicit baseline', () => {
  let currentState = {
    rooms: [], activities: [], articles: [], movements: [],
    settings: { hoursPerTeam: 8, weekdayTeams: 2, includeSaturday: false, saturdayTeams: 1 }
  };
  const storage = {
    _d: {}, getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
  };
  const testWindow = {
    PHARMA_SUPABASE_CONFIG: { enabled: false }, localStorage: storage,
    PharmaDashboardAdapter: { getState: () => currentState, setSyncContext() {}, notify() {} },
    addEventListener() {}, location: { protocol: 'https:', href: 'https://example.test/' }
  };
  const document = { readyState: 'complete', addEventListener() {} };
  vm.runInNewContext(clientSrc, {
    window: testWindow, document, localStorage: storage, location: testWindow.location,
    navigator: { onLine: true }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout
  });
  testWindow.PharmaSync.resetBaseline(currentState);
  currentState = {
    ...currentState,
    articles: [{ code: 'MF1', label: 'MF', family: 'MF', unit: 'kg', defaultQty: 1, defaultFuts: 0, active: true }],
    movements: [{ id: 'mv_1', sens: 'entree', articleCode: 'MF1', batch: '26001', qty: 1, unit: 'kg', futs: 0, place: 'A26', comment: '', at: new Date().toISOString(), by: 'Manager' }]
  };
  testWindow.PharmaSync.captureLocalState(currentState);
  const entities = testWindow.PharmaSync.getOutbox().map(item => item.entity);
  assert.ok(entities.includes('article'));
  assert.ok(entities.includes('stock_movement'));
});

check('outbox mutations are scoped to their authenticated author', () => {
  const storage = {
    _d: {}, getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
  };
  const testWindow = {
    PHARMA_SUPABASE_CONFIG: { enabled: false }, localStorage: storage,
    PharmaDashboardAdapter: { getState: () => ({}), setSyncContext() {}, notify() {} },
    addEventListener() {}, location: { protocol: 'https:', href: 'https://example.test/' }
  };
  const instrumented = clientSrc.replace(
    '  window.PharmaSync = {',
    `  window.OutboxScopeTest = {
      setAuth(userId, role) {
        runtime.session = userId ? { user: { id: userId } } : null;
        runtime.profile = role ? { role } : null;
      },
      queueMutation, canPushItem, claimUnownedItems, getOutbox
    };
    window.PharmaSync = {`
  );
  vm.runInNewContext(instrumented, {
    window: testWindow, document: { readyState: 'complete', addEventListener() {} },
    localStorage: storage, location: testWindow.location, navigator: { onLine: true },
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout
  });
  const scope = testWindow.OutboxScopeTest;

  scope.setAuth('user-a', 'planner');
  scope.queueMutation('activity', 'upsert', { id: 'same' }, 'same');
  const itemA = scope.getOutbox()[0];
  scope.setAuth('user-b', 'planner');
  assert.strictEqual(scope.canPushItem(itemA), false);
  scope.queueMutation('activity', 'upsert', { id: 'same', comment: 'B' }, 'same');
  assert.deepStrictEqual(Array.from(scope.getOutbox(), item => item.userId).sort(), ['user-a', 'user-b']);

  scope.setAuth(null, null);
  scope.queueMutation('stock_movement', 'upsert', { id: 'mv' }, 'mv');
  const unclaimed = scope.getOutbox().find(item => item.id === 'mv');
  scope.setAuth('user-b', 'manager');
  assert.strictEqual(scope.canPushItem(unclaimed), false);
  scope.claimUnownedItems();
  const claimed = scope.getOutbox().find(item => item.id === 'mv');
  assert.strictEqual(claimed.userId, 'user-b');
  assert.strictEqual(scope.canPushItem(claimed), true);
  assert.ok(!clientSrc.includes('hasInitialPull: false, migrationPending'));
});

check('schema is reproducible for locaux_dash and Realtime', () => {
  const sql = read('supabase_schema.sql');
  assert.ok(/create schema if not exists locaux_dash/i.test(sql));
  assert.ok(/create table if not exists locaux_dash\.articles/i.test(sql));
  assert.ok(/create table if not exists locaux_dash\.stock_movements/i.test(sql));
  assert.ok(/family in \('MP', 'MF', 'SF', 'pochette', 'PF'\)/i.test(sql));
  assert.ok(/created_by uuid/i.test(sql));
  assert.ok(/locaux_private\.is_member/i.test(sql));
  assert.ok(/'locaux_dash\.stock_movements'::regclass/i.test(sql));
  assert.ok(/alter publication supabase_realtime add table %s/i.test(sql));
  assert.ok(!/create table if not exists public\.(rooms|activities|settings)/i.test(sql));
  assert.ok(!/create\s+(or\s+replace\s+)?function\s+locaux_dash\.handle_new_user/i.test(sql));
  assert.ok(/drop column if exists by_role/i.test(sql));
});

check('smoke_check.sh passes on an isolated local server', () => {
  const port = String(18000 + process.pid % 1000);
  const pidFile = `/tmp/pharma-dashboard-test-${process.pid}.pid`;
  const logFile = `/tmp/pharma-dashboard-test-${process.pid}.log`;
  const env = { ...process.env, PORT: port, PID_FILE: pidFile, LOG_FILE: logFile };
  try {
    execSync('bash ./serve.sh', { cwd: ROOT, env, stdio: 'pipe', timeout: 10000 });
    execSync('bash ./smoke_check.sh', { cwd: ROOT, env, stdio: 'pipe', timeout: 60000 });
  } finally {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch (_) {}
    for (const file of [pidFile, logFile]) try { fs.unlinkSync(file); } catch (_) {}
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nALL production_ready tests PASS');
process.exit(0);
