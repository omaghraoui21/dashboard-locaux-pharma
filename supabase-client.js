/*
 * Dashboard des locaux d'activité — client Supabase hybride v4
 * Dépendance navigateur : @supabase/supabase-js v2 (UMD) chargé avant ce fichier.
 * Ce module conserve localStorage comme cache et file d'attente hors-ligne.
 */
(function bootstrapPharmaSync(window) {
  'use strict';

  const CACHE_KEY = 'pharma_ops_dashboard_v2';
  const OUTBOX_KEY = 'pharma_ops_sync_queue_v4';
  const META_KEY = 'pharma_ops_sync_meta_v4';
  const MAX_LOGS = 200;

  const runtime = {
    client: null,
    channel: null,
    session: null,
    profile: null,
    enabled: false,
    backendReachable: false,
    syncing: false,
    lastSyncAt: '',
    baseline: null,
    syncTimer: null,
    realtimeTimer: null,
    flushPromise: null,
    syncPromise: null,
    authSubscription: null,
    config: null
  };

  function adapter() {
    return window.PharmaDashboardAdapter || null;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`[PharmaSync] Lecture ${key} impossible`, error);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`[PharmaSync] Écriture ${key} impossible`, error);
      notify('La file de synchronisation locale ne peut pas être enregistrée.', 'bad');
      return false;
    }
  }

  function resolveConfig() {
    const globalConfig = window.PHARMA_SUPABASE_CONFIG || {};
    const url = String(globalConfig.url || '').trim();
    const key = String(globalConfig.publishableKey || globalConfig.anonKey || '').trim();
    const placeholder = /YOUR_|VOTRE_|example/i.test(`${url} ${key}`);
    return {
      url,
      key,
      enabled: globalConfig.enabled !== false && Boolean(url && key && !placeholder),
      redirectTo: globalConfig.redirectTo || (location.protocol === 'http:' || location.protocol === 'https:' ? location.href.split('#')[0] : ''),
      schema: globalConfig.schema || 'public',
      libraryUrl: globalConfig.libraryUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
      libraryIntegrity: String(globalConfig.libraryIntegrity || '').trim()
    };
  }

  function getOutbox() {
    const queue = readJSON(OUTBOX_KEY, []);
    return Array.isArray(queue) ? queue : [];
  }

  function setOutbox(queue) {
    writeJSON(OUTBOX_KEY, queue.slice(-1000));
    publishContext();
  }

  function getMeta() {
    return readJSON(META_KEY, { hasInitialPull: false, lastSyncAt: '' });
  }

  function setMeta(patch) {
    const next = { ...getMeta(), ...patch };
    writeJSON(META_KEY, next);
    return next;
  }

  function notify(message, type = '') {
    if (adapter()?.notify) adapter().notify(message, type);
    else console[type === 'bad' ? 'error' : 'log'](`[PharmaSync] ${message}`);
  }

  function publishContext(extra = {}) {
    const queue = getOutbox();
    const context = {
      enabled: runtime.enabled,
      backendReachable: runtime.backendReachable,
      authenticated: Boolean(runtime.session?.user),
      user: runtime.session?.user ? {
        id: runtime.session.user.id,
        email: runtime.session.user.email || ''
      } : null,
      role: runtime.profile?.role || null,
      displayName: runtime.profile?.display_name || '',
      syncing: runtime.syncing,
      pendingCount: queue.length,
      blockedCount: queue.filter(item => item.blocked).length,
      lastSyncAt: runtime.lastSyncAt || getMeta().lastSyncAt || '',
      ...extra
    };
    adapter()?.setSyncContext?.(context);
  }

  function parseDateToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function roomToDb(room) {
    return {
      id: Number(room.id),
      name: String(room.name || '').trim(),
      zone: String(room.zone || 'Zone de production').trim(),
      code: String(room.code || '').trim(),
      kind: String(room.kind || 'generique').trim() || 'generique',
      hygiene: room.hygiene === 'a_nettoyer' ? 'a_nettoyer' : 'propre',
      is_active: room.isActive !== false,
      created_at: parseDateToIso(room.createdAt) || undefined,
      updated_at: parseDateToIso(room.updatedAt) || undefined
    };
  }

  function roomFromDb(row) {
    const code = row.code || (String(row.name || '').match(/\b([AD]\d{2})\b/i) || [])[1] || '';
    const kindMap = {
      A23: 'process', A27: 'geluleuse', A26: 'stock_primaire',
      A28: 'blistereuse', D08: 'cond_sec_continuite', D18: 'cond_sec_assemblage'
    };
    return {
      id: Number(row.id),
      name: row.name,
      zone: row.zone,
      code: String(code).toUpperCase(),
      kind: row.kind || kindMap[String(code).toUpperCase()] || 'generique',
      hygiene: row.hygiene === 'a_nettoyer' ? 'a_nettoyer' : 'propre',
      isActive: row.is_active !== false,
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || ''
    };
  }

  function activityToDb(activity) {
    return {
      id: String(activity.id),
      room_id: Number(activity.roomId),
      activity: String(activity.activity || '').trim(),
      product: String(activity.product || '—'),
      batch: String(activity.batch || '—'),
      team: String(activity.team || 'Équipe A'),
      owner: String(activity.owner || '—'),
      plan_start: parseDateToIso(activity.planStart),
      plan_end: parseDateToIso(activity.planEnd),
      actual_start: parseDateToIso(activity.actualStart),
      actual_end: parseDateToIso(activity.actualEnd),
      progress: Number(activity.progress || 0),
      status: activity.status || 'planned',
      step: String(activity.step || ''),
      comment: String(activity.comment || ''),
      delay_category: activity.delayCategory || 'none',
      created_at: parseDateToIso(activity.createdAt) || undefined,
      updated_at: parseDateToIso(activity.updatedAt) || undefined
    };
  }

  function activityFromDb(row) {
    return {
      id: String(row.id),
      roomId: Number(row.room_id),
      activity: row.activity,
      product: row.product,
      batch: row.batch,
      team: row.team,
      owner: row.owner,
      planStart: row.plan_start,
      planEnd: row.plan_end,
      actualStart: row.actual_start || '',
      actualEnd: row.actual_end || '',
      progress: Number(row.progress || 0),
      status: row.status,
      step: row.step || '',
      comment: row.comment || '',
      delayCategory: row.delay_category || 'none',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || ''
    };
  }

  function articleToDb(article) {
    return {
      code: String(article.code || '').trim().toUpperCase(),
      label: String(article.label || article.code || '').trim(),
      family: article.family || 'SF',
      unit: String(article.unit || 'u').trim(),
      default_qty: Number(article.defaultQty || 1),
      default_futs: Number(article.defaultFuts || 0),
      active: article.active !== false
    };
  }

  function articleFromDb(row) {
    return {
      code: row.code,
      label: row.label,
      family: row.family,
      unit: row.unit,
      defaultQty: Number(row.default_qty || 1),
      defaultFuts: Number(row.default_futs || 0),
      active: row.active !== false
    };
  }

  function movementToDb(movement) {
    return {
      id: String(movement.id),
      sens: movement.sens === 'sortie' ? 'sortie' : 'entree',
      article_code: String(movement.articleCode || '').trim().toUpperCase(),
      batch: String(movement.batch || '—'),
      qty: Number(movement.qty || 0),
      unit: String(movement.unit || 'u'),
      futs: Number(movement.futs || 0),
      place: String(movement.place || ''),
      comment: String(movement.comment || ''),
      at: parseDateToIso(movement.at) || undefined
    };
  }

  function movementFromDb(row) {
    const role = row.created_by === runtime.session?.user?.id ? runtime.profile?.role : null;
    return {
      id: String(row.id),
      sens: row.sens === 'sortie' ? 'sortie' : 'entree',
      articleCode: row.article_code,
      batch: row.batch || '—',
      qty: Number(row.qty || 0),
      unit: row.unit || 'u',
      futs: Number(row.futs || 0),
      place: row.place || '',
      comment: row.comment || '',
      at: row.at || row.created_at || '',
      by: role === 'planner' ? 'Planificateur' : role === 'manager' ? 'Manager' : 'Utilisateur',
      createdAt: row.created_at || ''
    };
  }

  function settingsToDb(settings) {
    return {
      id: 1,
      hours_per_team: Number(settings.hoursPerTeam || 8),
      weekday_teams: Number(settings.weekdayTeams || 2),
      include_saturday: Boolean(settings.includeSaturday),
      saturday_teams: Number(settings.saturdayTeams || 1)
    };
  }

  function settingsFromDb(row) {
    return {
      hoursPerTeam: Number(row?.hours_per_team || 8),
      weekdayTeams: Number(row?.weekday_teams || 2),
      includeSaturday: Boolean(row?.include_saturday),
      saturdayTeams: Number(row?.saturday_teams || 1)
    };
  }

  function changeLogFromDb(row) {
    const actionLabels = { insert: 'Création serveur', update: 'Modification serveur', delete: 'Suppression serveur' };
    return {
      id: `srv_${row.id}`,
      timestamp: row.changed_at,
      action: actionLabels[row.action] || 'Synchronisation serveur',
      detail: row.detail || `${row.entity_type} ${row.entity_id}`
    };
  }

  function canonicalState(state) {
    const rooms = (state?.rooms || []).map(roomToDb).map(stripUndefined).sort((a, b) => a.id - b.id);
    const activities = (state?.activities || []).map(activityToDb).map(stripUndefined).sort((a, b) => a.id.localeCompare(b.id));
    const articles = (state?.articles || []).map(articleToDb).map(stripUndefined).sort((a, b) => a.code.localeCompare(b.code));
    const movements = (state?.movements || []).map(movementToDb).map(stripUndefined).sort((a, b) => a.id.localeCompare(b.id));
    return { rooms, activities, articles, movements, settings: stripUndefined(settingsToDb(state?.settings || {})) };
  }

  function stripUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  }

  function signature(value) {
    return JSON.stringify(value);
  }

  function sameOutboxItem(left, right) {
    return left?.userId === right?.userId
      && left?.queuedAt === right?.queuedAt
      && left?.operation === right?.operation
      && signature(left?.record) === signature(right?.record);
  }

  function outboxAttemptKey(item) {
    return `${item.userId || 'unclaimed'}:${item.key}:${item.queuedAt}:${item.operation}:${signature(item.record)}`;
  }

  function queueMutation(entity, operation, record, id) {
    const key = `${entity}:${id}`;
    let queue = getOutbox().filter(item => item.key !== key);
    queue.push({
      key,
      entity,
      operation,
      id: String(id),
      record: record ? clone(record) : null,
      userId: runtime.session?.user?.id || null,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      blocked: false,
      error: ''
    });
    setOutbox(queue);
  }

  function diffCollection(entity, previous, next, idField) {
    const before = new Map((previous || []).map(item => [String(item[idField]), item]));
    const after = new Map((next || []).map(item => [String(item[idField]), item]));

    for (const [id, record] of after) {
      if (!before.has(id) || signature(before.get(id)) !== signature(record)) {
        queueMutation(entity, 'upsert', record, id);
      }
    }
    for (const id of before.keys()) {
      if (!after.has(id)) queueMutation(entity, 'delete', null, id);
    }
  }

  function captureLocalState(localState) {
    const next = canonicalState(localState);
    if (!runtime.baseline) {
      runtime.baseline = next;
      publishContext();
      return;
    }
    diffCollection('room', runtime.baseline.rooms, next.rooms, 'id');
    diffCollection('activity', runtime.baseline.activities, next.activities, 'id');
    diffCollection('article', runtime.baseline.articles, next.articles, 'code');
    diffCollection('stock_movement', runtime.baseline.movements, next.movements, 'id');
    if (signature(runtime.baseline.settings) !== signature(next.settings)) {
      queueMutation('settings', 'upsert', next.settings, 1);
    }
    runtime.baseline = next;
    if (runtime.enabled && runtime.session?.user) {
      scheduleSync(50);
    }
  }

  function resetBaseline(localState) {
    runtime.baseline = canonicalState(localState || adapter()?.getState?.() || readJSON(CACHE_KEY, {}));
  }

  async function loadProfile(userId) {
    const { data, error } = await runtime.client
      .from('profiles')
      .select('id, display_name, role, updated_at')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  }

  async function fetchSnapshot() {
    const [roomsResult, activitiesResult, articlesResult, movementsResult, settingsResult, logResult] = await Promise.all([
      runtime.client.from('rooms').select('*').order('id'),
      runtime.client.from('activities').select('*').order('plan_start'),
      runtime.client.from('articles').select('*').order('code'),
      runtime.client.from('stock_movements').select('*').order('at'),
      runtime.client.from('settings').select('*').eq('id', 1).maybeSingle(),
      runtime.client.from('change_log').select('id, entity_type, entity_id, action, detail, changed_at').order('changed_at', { ascending: false }).limit(MAX_LOGS)
    ]);

    const errors = [roomsResult.error, activitiesResult.error, articlesResult.error, movementsResult.error, settingsResult.error, logResult.error].filter(Boolean);
    if (errors.length) throw errors[0];

    return {
      rooms: (roomsResult.data || []).map(roomFromDb),
      activities: (activitiesResult.data || []).map(activityFromDb),
      articles: (articlesResult.data || []).map(articleFromDb),
      movements: (movementsResult.data || []).map(movementFromDb),
      settings: settingsFromDb(settingsResult.data || {}),
      changeLog: (logResult.data || []).slice().reverse().map(changeLogFromDb)
    };
  }

  function isNetworkLikeError(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return !navigator.onLine || /fetch|network|failed to fetch|load failed|timeout|connection/.test(text);
  }

  function humanSyncError(error) {
    if (!error) return 'Erreur de synchronisation inconnue.';
    if (error.code === '23P01') return 'Chevauchement détecté par le serveur : corrigez le créneau du local.';
    if (error.code === '23503') return 'Le local lié à cette activité n’existe plus sur le serveur.';
    if (error.code === '42501' || /row-level security/i.test(error.message || '')) return 'Écriture refusée pour ce compte.';
    return error.message || 'Synchronisation impossible.';
  }

  async function executeOutboxItem(item) {
    let query;
    if (item.entity === 'activity') {
      query = item.operation === 'delete'
        ? runtime.client.from('activities').delete().eq('id', item.id)
        : runtime.client.from('activities').upsert(stripUndefined(item.record), { onConflict: 'id' });
    } else if (item.entity === 'room') {
      query = item.operation === 'delete'
        ? runtime.client.from('rooms').delete().eq('id', Number(item.id))
        : runtime.client.from('rooms').upsert(stripUndefined(item.record), { onConflict: 'id' });
    } else if (item.entity === 'settings') {
      query = runtime.client.from('settings').upsert(stripUndefined(item.record), { onConflict: 'id' });
    } else if (item.entity === 'article') {
      query = item.operation === 'delete'
        ? runtime.client.from('articles').delete().eq('code', item.id)
        : runtime.client.from('articles').upsert(stripUndefined(item.record), { onConflict: 'code' });
    } else if (item.entity === 'stock_movement') {
      query = item.operation === 'delete'
        ? runtime.client.from('stock_movements').delete().eq('id', item.id)
        : runtime.client.from('stock_movements').upsert(stripUndefined(item.record), { onConflict: 'id' });
    } else {
      throw new Error(`Entité de synchronisation inconnue : ${item.entity}`);
    }
    const { error } = await query;
    if (error) throw error;
  }

  function canPushItem(item) {
    if (item.userId && item.userId !== runtime.session?.user?.id) return false;
    return runtime.profile?.role === 'planner' || (runtime.profile?.role === 'manager' && item.entity === 'stock_movement');
  }

  async function drainOutbox() {
    if (!runtime.enabled || !runtime.session?.user) return false;
    if (!getOutbox().length) return true;

    runtime.syncing = true;
    publishContext();
    let changed = false;
    const attempted = new Set();

    try {
      while (true) {
        const item = getOutbox().find(candidate => {
          return !candidate.blocked && canPushItem(candidate) && !attempted.has(outboxAttemptKey(candidate));
        });
        if (!item) break;
        attempted.add(outboxAttemptKey(item));

        try {
          await executeOutboxItem(item);
          const latest = getOutbox();
          const current = latest.find(candidate => candidate.key === item.key);
          if (sameOutboxItem(current, item)) {
            setOutbox(latest.filter(candidate => candidate.key !== item.key));
          }
          changed = true;
          runtime.backendReachable = true;
        } catch (error) {
          console.error('[PharmaSync] Envoi impossible', item, error);
          runtime.backendReachable = !isNetworkLikeError(error);
          const latest = getOutbox();
          const current = latest.find(candidate => candidate.key === item.key);
          if (sameOutboxItem(current, item)) {
            current.attempts = Number(current.attempts || 0) + 1;
            current.error = humanSyncError(error);
            if (['23P01', '23503', '42501'].includes(error.code) || /row-level security/i.test(error.message || '')) {
              current.blocked = true;
              notify(current.error, 'bad');
            }
            setOutbox(latest);
          }
          if (isNetworkLikeError(error)) break;
        }
      }
      if (changed) {
        runtime.lastSyncAt = new Date().toISOString();
        setMeta({ lastSyncAt: runtime.lastSyncAt });
      }
      return !getOutbox().some(canPushItem);
    } finally {
      runtime.syncing = false;
      publishContext();
    }
  }

  function flushOutbox() {
    if (runtime.flushPromise) return runtime.flushPromise;
    const promise = drainOutbox().finally(() => {
      if (runtime.flushPromise === promise) runtime.flushPromise = null;
    });
    runtime.flushPromise = promise;
    return promise;
  }

  function shouldPreserveLocalState(localState, meta) {
    if (meta.hasInitialPull) return false;
    if (meta.migrationPending) return true;
    const hasData = ['rooms', 'activities', 'articles', 'movements']
      .some(key => Array.isArray(localState?.[key]) && localState[key].length > 0);
    if (!hasData) return false;
    const logs = Array.isArray(localState?.changeLog) ? localState.changeLog : [];
    const untouchedSeed = logs.length === 1
      && logs[0].action === 'Initialisation'
      && /initialis/i.test(logs[0].detail || '')
      && !(localState?.activities || []).length
      && !(localState?.movements || []).length;
    return !untouchedSeed;
  }

  async function pullAndApply({ force = false } = {}) {
    if (!runtime.enabled || !runtime.session?.user) return false;
    const localState = adapter()?.getState?.() || readJSON(CACHE_KEY, {});
    const meta = getMeta();
    if (!force && shouldPreserveLocalState(localState, meta)) {
      setMeta({ hasInitialPull: false, migrationPending: true });
      notify('Des données locales doivent être migrées avant la première lecture Supabase.', '');
      publishContext({ migrationSuggested: true });
      return false;
    }

    runtime.syncing = true;
    publishContext();
    try {
      const snapshot = await fetchSnapshot();
      runtime.backendReachable = true;
      adapter()?.applyRemoteSnapshot?.(snapshot);
      resetBaseline(adapter()?.getState?.() || localState);
      runtime.lastSyncAt = new Date().toISOString();
      setMeta({ hasInitialPull: true, migrationPending: false, lastSyncAt: runtime.lastSyncAt });
      return true;
    } catch (error) {
      console.error('[PharmaSync] Lecture serveur impossible', error);
      runtime.backendReachable = !isNetworkLikeError(error);
      notify('Serveur indisponible : le dashboard continue avec le cache local.', 'bad');
      throw error;
    } finally {
      runtime.syncing = false;
      publishContext();
    }
  }

  async function runSync() {
    if (!runtime.enabled) {
      notify('Supabase n’est pas configuré. Le dashboard reste en mode local.', '');
      return false;
    }
    if (!runtime.session?.user) {
      publishContext();
      notify('Connectez-vous pour synchroniser les données.', 'bad');
      return false;
    }
    const localState = adapter()?.getState?.() || readJSON(CACHE_KEY, {});
    if (shouldPreserveLocalState(localState, getMeta())) {
      setMeta({ hasInitialPull: false, migrationPending: true });
      notify('Des données locales doivent être migrées avant la première synchronisation Supabase.', '');
      publishContext({ migrationSuggested: true });
      return false;
    }
    if (!await flushOutbox()) return false;
    return pullAndApply();
  }

  function syncNow() {
    if (runtime.syncPromise) return runtime.syncPromise;
    const promise = runSync().finally(() => {
      if (runtime.syncPromise === promise) runtime.syncPromise = null;
    });
    runtime.syncPromise = promise;
    return promise;
  }

  function scheduleSync(delay = 250) {
    clearTimeout(runtime.syncTimer);
    runtime.syncTimer = setTimeout(() => {
      syncNow().catch(error => console.error('[PharmaSync] Synchronisation planifiée impossible', error));
    }, delay);
  }

  function scheduleRealtimePull() {
    clearTimeout(runtime.realtimeTimer);
    runtime.realtimeTimer = setTimeout(() => {
      if (!runtime.session?.user) return;
      syncNow().catch(error => console.error('[PharmaSync] Relecture Realtime impossible', error));
    }, 180);
  }

  async function subscribeRealtime() {
    if (!runtime.client || !runtime.session?.user) return;
    if (runtime.channel) await runtime.client.removeChannel(runtime.channel);

    runtime.channel = runtime.client
      .channel('pharma-dashboard-v4')
      .on('postgres_changes', { event: '*', schema: runtime.config.schema, table: 'rooms' }, scheduleRealtimePull)
      .on('postgres_changes', { event: '*', schema: runtime.config.schema, table: 'activities' }, scheduleRealtimePull)
      .on('postgres_changes', { event: '*', schema: runtime.config.schema, table: 'articles' }, scheduleRealtimePull)
      .on('postgres_changes', { event: '*', schema: runtime.config.schema, table: 'stock_movements' }, scheduleRealtimePull)
      .on('postgres_changes', { event: '*', schema: runtime.config.schema, table: 'settings' }, scheduleRealtimePull)
      .on('postgres_changes', { event: 'INSERT', schema: runtime.config.schema, table: 'change_log' }, scheduleRealtimePull)
      .subscribe(status => {
        publishContext({ realtimeStatus: status });
      });
  }

  async function handleSession(session) {
    runtime.session = session || null;
    runtime.profile = null;

    if (!session?.user) {
      runtime.backendReachable = navigator.onLine;
      if (runtime.channel) {
        await runtime.client.removeChannel(runtime.channel);
        runtime.channel = null;
      }
      publishContext();
      return;
    }

    try {
      runtime.profile = await loadProfile(session.user.id);
      runtime.backendReachable = true;
      publishContext();
      await subscribeRealtime();
      await syncNow();
    } catch (error) {
      console.error('[PharmaSync] Initialisation de session impossible', error);
      runtime.backendReachable = !isNetworkLikeError(error);
      publishContext();
      notify('Session conservée, mais le serveur est momentanément indisponible. Mode cache local actif.', 'bad');
    }
  }

  async function signInWithPassword(email, password) {
    if (!runtime.enabled) throw new Error('Supabase n’est pas configuré.');
    const { data, error } = await runtime.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    await handleSession(data.session);
    return data;
  }

  async function sendMagicLink(email) {
    if (!runtime.enabled) throw new Error('Supabase n’est pas configuré.');
    const options = { shouldCreateUser: false };
    if (runtime.config.redirectTo) options.emailRedirectTo = runtime.config.redirectTo;
    const { data, error } = await runtime.client.auth.signInWithOtp({ email: email.trim(), options });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!runtime.client) return;
    const { error } = await runtime.client.auth.signOut();
    if (error) throw error;
    await handleSession(null);
  }

  async function performMigration() {
    if (!runtime.session?.user || !['manager', 'planner'].includes(runtime.profile?.role)) {
      throw new Error('La migration nécessite un membre connecté.');
    }
    const localState = adapter()?.getState?.() || readJSON(CACHE_KEY, null);
    if (!localState) throw new Error('Aucune donnée locale v3 à migrer.');

    const normalized = canonicalState(localState);
    const planner = runtime.profile.role === 'planner';
    if (!planner && normalized.activities.length) {
      throw new Error('Connectez un compte Planificateur pour migrer le planning local.');
    }
    if (planner) {
      normalized.rooms.forEach(record => queueMutation('room', 'upsert', record, record.id));
      queueMutation('settings', 'upsert', normalized.settings, 1);
      normalized.articles.forEach(record => queueMutation('article', 'upsert', record, record.code));
      normalized.activities.forEach(record => queueMutation('activity', 'upsert', record, record.id));
    }
    normalized.movements.forEach(record => queueMutation('stock_movement', 'upsert', record, record.id));

    notify(`${normalized.activities.length} activité(s) et ${normalized.movements.length} mouvement(s) placés dans la file de migration.`, 'ok');
    if (!await flushOutbox()) {
      const blocked = getOutbox().some(item => item.blocked);
      throw new Error(blocked
        ? 'Certaines lignes ont été refusées. Corrigez-les avant de réessayer.'
        : 'Migration incomplète : des opérations restent en attente.');
    }
    const remaining = getOutbox();
    if (remaining.some(canPushItem)) throw new Error('Migration incomplète : des opérations autorisées restent en attente.');
    if (!await pullAndApply({ force: true })) throw new Error('La vérification serveur après migration a échoué.');
    return {
      rooms: planner ? normalized.rooms.length : 0,
      activities: planner ? normalized.activities.length : 0,
      articles: planner ? normalized.articles.length : 0,
      movements: normalized.movements.length
    };
  }

  async function migrateLocalData() {
    if (runtime.syncPromise) await runtime.syncPromise;
    const promise = performMigration().finally(() => {
      if (runtime.syncPromise === promise) runtime.syncPromise = null;
    });
    runtime.syncPromise = promise;
    return promise;
  }

  function retryBlockedItems() {
    const queue = getOutbox().map(item => ({ ...item, blocked: false, error: '' }));
    setOutbox(queue);
    scheduleSync(20);
  }

  function clearOutbox() {
    setOutbox([]);
    resetBaseline();
  }

  function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-pharma-supabase-library]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Bibliothèque Supabase indisponible.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = runtime.config.libraryUrl;
      script.async = true;
      if (runtime.config.libraryIntegrity) {
        script.integrity = runtime.config.libraryIntegrity;
        script.crossOrigin = 'anonymous';
      }
      script.dataset.pharmaSupabaseLibrary = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Bibliothèque Supabase indisponible.'));
      document.head.appendChild(script);
    });
  }

  async function initialize() {
    runtime.config = resolveConfig();
    runtime.enabled = runtime.config.enabled;
    resetBaseline();

    window.addEventListener('online', () => {
      runtime.backendReachable = true;
      publishContext();
      scheduleSync(50);
    });
    window.addEventListener('offline', () => {
      runtime.backendReachable = false;
      publishContext();
    });

    if (!runtime.enabled) {
      publishContext();
      return;
    }

    if (!window.supabase?.createClient) {
      try {
        await loadSupabaseLibrary();
      } catch (error) {
        console.error('[PharmaSync] Chargement de la bibliothèque impossible', error);
        runtime.enabled = false;
        publishContext({ libraryMissing: true });
        notify('La bibliothèque Supabase n’a pas pu être chargée. Mode local actif.', 'bad');
        return;
      }
    }

    const clientOptions = {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    };
    if (runtime.config.schema && runtime.config.schema !== 'public') {
      clientOptions.db = { schema: runtime.config.schema };
    }
    runtime.client = window.supabase.createClient(runtime.config.url, runtime.config.key, clientOptions);

    const { data: { subscription } } = runtime.client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleSession(session), 0);
    });
    runtime.authSubscription = subscription;

    const { data, error } = await runtime.client.auth.getSession();
    if (error) {
      console.warn('[PharmaSync] Session non disponible', error);
      publishContext();
      return;
    }
    await handleSession(data.session);
  }

  window.PharmaSync = {
    initialize,
    captureLocalState,
    resetBaseline,
    syncNow,
    signInWithPassword,
    sendMagicLink,
    signOut,
    migrateLocalData,
    retryBlockedItems,
    clearOutbox,
    getContext: () => ({
      enabled: runtime.enabled,
      backendReachable: runtime.backendReachable,
      authenticated: Boolean(runtime.session?.user),
      role: runtime.profile?.role || null,
      pendingCount: getOutbox().length,
      lastSyncAt: runtime.lastSyncAt || getMeta().lastSyncAt || ''
    }),
    getOutbox: () => clone(getOutbox())
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);
