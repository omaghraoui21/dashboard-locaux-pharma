/**
 * Domaine usine — articles, lots, bascules stock, CSV planning.
 * Chargé avant le script principal du dashboard.
 */
(function (window) {
  'use strict';

  const DEFAULT_ARTICLES = [
    { code: 'FSF600', label: 'Aerofor 12 µg (SF / process)', family: 'SF', unit: 'gélules', defaultQty: 360000, defaultFuts: 10, active: true },
    { code: 'FSF601', label: 'Réservé / inactif', family: 'SF', unit: 'gélules', defaultQty: 360000, defaultFuts: 10, active: false },
    { code: 'FSF602', label: 'Aeronide 200 µg (SF / process)', family: 'SF', unit: 'gélules', defaultQty: 360000, defaultFuts: 10, active: true },
    { code: 'FSF603', label: 'Aeronide 400 µg (SF / process)', family: 'SF', unit: 'gélules', defaultQty: 360000, defaultFuts: 10, active: true },
    // Mapping YOLO v1 pochettes (modifiable via UI Articles)
    { code: 'FSF604', label: 'Pochette Aerofor 12 · pour Combifor 12/200', family: 'pochette', unit: 'pochettes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'FSF605', label: 'Pochette Aerofor 12 · pour Combifor 12/400', family: 'pochette', unit: 'pochettes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'FSF606', label: 'Pochette Aeronide 200 · pour Combifor 12/200', family: 'pochette', unit: 'pochettes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'FSF607', label: 'Pochette Aeronide 400 · pour Combifor 12/400', family: 'pochette', unit: 'pochettes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'MP9', label: 'MP / Mélange · 9 kg', family: 'MP', unit: 'kg', defaultQty: 9, defaultFuts: 0, active: true },
    { code: 'PF600', label: 'AEROFOR 12 µg – BTE 30', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'PF601', label: 'AEROFOR 12 µg – BTE 60', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'PF602', label: 'AERONIDE 200 µg – BTE 60', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'PF603', label: 'AERONIDE 400 µg – BTE 60', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'PF604', label: 'COMBIFOR 400 µg / 12 µg – BTE 120', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true },
    { code: 'PF605', label: 'COMBIFOR 200 µg / 12 µg – BTE 120', family: 'PF', unit: 'boîtes', defaultQty: 1, defaultFuts: 0, active: true }
  ];

  /** Familles autorisées par kind de local (saisie facilitée) */
  const FAMILY_BY_KIND = {
    process: ['MP', 'SF'],
    geluleuse: ['SF'],
    stock_primaire: ['MP', 'MF', 'SF'],
    blistereuse: ['SF', 'pochette', 'PF'],
    cond_sec_continuite: ['PF'],
    cond_sec_assemblage: ['PF', 'pochette'],
    generique: ['MP', 'MF', 'SF', 'pochette', 'PF']
  };

  const CSV_HEADERS = [
    'local_code', 'type', 'article_code', 'lot', 'plan_start', 'plan_end',
    'qty_theorique', 'unit', 'futs', 'status', 'step', 'comment'
  ];

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeArticle(a, index) {
    return {
      code: String(a.code || `ART${index + 1}`).trim().toUpperCase(),
      label: String(a.label || a.code || 'Article').trim(),
      family: ['MP', 'MF', 'SF', 'pochette', 'PF'].includes(a.family) ? a.family : 'SF',
      unit: String(a.unit || 'u').trim(),
      defaultQty: Number(a.defaultQty) > 0 ? Number(a.defaultQty) : 1,
      defaultFuts: Math.max(0, Math.round(Number(a.defaultFuts) || 0)),
      active: a.active !== false
    };
  }

  function articlesForRoomKind(articles, kind) {
    if (kind === 'cond_sec_continuite') {
      return (articles || []).filter(a => a.active !== false && ['PF600', 'PF601', 'PF602', 'PF603'].includes(a.code));
    }
    if (kind === 'cond_sec_assemblage') {
      return (articles || []).filter(a => a.active !== false && (['PF604', 'PF605'].includes(a.code) || a.family === 'pochette'));
    }
    const families = FAMILY_BY_KIND[kind] || FAMILY_BY_KIND.generique;
    return (articles || []).filter(a => a.active !== false && families.includes(a.family));
  }

  function productLabel(article) {
    if (!article) return '—';
    return `${article.code} · ${article.label}`;
  }

  /** Prochain lot type 26001 incrémental par préfixe article (année 2 digits + seq 3+) */
  function nextLotNumber(articleCode, activities, movements) {
    const year = String(new Date().getFullYear()).slice(-2);
    const re = new RegExp(`^${year}(\\d{3,})$`);
    let max = 0;
    const scan = (lot) => {
      const m = String(lot || '').match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    };
    (activities || []).forEach(a => {
      if (!articleCode || String(a.product || '').toUpperCase().includes(String(articleCode).toUpperCase())) scan(a.batch);
    });
    (movements || []).forEach(m => {
      if (!articleCode || m.articleCode === articleCode) scan(m.batch);
    });
    const next = max + 1;
    return `${year}${String(next).padStart(3, '0')}`;
  }

  /**
   * Bascule stock : fin d'activité amont → suggestion activité stockage A26
   * A23 mélange/MP → A26 ; A27 SF → A26
   */
  function storageHandoffFromComplete(activity, rooms) {
    const room = (rooms || []).find(r => Number(r.id) === Number(activity.roomId));
    if (!room) return null;
    const stockRoom = (rooms || []).find(r => r.kind === 'stock_primaire' || r.code === 'A26');
    if (!stockRoom) return null;

    const kind = room.kind || '';
    if (kind !== 'process' && kind !== 'geluleuse') return null;
    if (activity.activity && !String(activity.activity).trim().startsWith('Lot en cours')) return null;

    const product = String(activity.product || '').trim();
    const batch = String(activity.batch || '').trim();
    if (!product || product === '—' || !batch || batch === '—') return null;
    const label = kind === 'process'
      ? `Stock A26 · entrée (suite ${room.code || room.name}) · ${product}`
      : `Stock A26 · SF entrée (suite ${room.code || room.name}) · ${product}`;

    return {
      roomId: stockRoom.id,
      activity: label,
      product,
      batch,
      team: activity.team || 'Équipe A',
      owner: activity.owner || '—',
      status: 'planned',
      progress: 0,
      step: 'Stockage en attente',
      comment: `Auto · clôture ${room.code || room.name} · corrigeable`,
      delayCategory: 'none',
      sourceActivityId: activity.id
    };
  }

  function parseCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const split = (line) => {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; }
          else q = !q;
        } else if (c === delimiter && !q) {
          out.push(cur.trim());
          cur = '';
        } else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    const headers = split(lines[0]).map(h => h.toLowerCase());
    const rows = lines.slice(1).map(line => {
      const cols = split(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
      return obj;
    });
    return { headers, rows };
  }

  function toCsv(rows) {
    const esc = (v) => {
      const raw = String(v ?? '');
      const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [CSV_HEADERS.join(';')];
    rows.forEach(r => {
      lines.push(CSV_HEADERS.map(h => esc(r[h])).join(';'));
    });
    return '\uFEFF' + lines.join('\n');
  }

  function templateCsvRows(rooms) {
    const sample = (rooms && rooms[0]) || { code: 'A23' };
    return [{
      local_code: sample.code || 'A23',
      type: 'Lot en cours',
      article_code: 'FSF600',
      lot: '',
      plan_start: '',
      plan_end: '',
      qty_theorique: '360000',
      unit: 'gélules',
      futs: '10',
      status: 'planned',
      step: '',
      comment: 'Ligne modèle — supprimer ou dupliquer'
    }];
  }

  window.PlantDomain = {
    DEFAULT_ARTICLES,
    FAMILY_BY_KIND,
    CSV_HEADERS,
    uid,
    normalizeArticle,
    articlesForRoomKind,
    productLabel,
    nextLotNumber,
    storageHandoffFromComplete,
    parseCsv,
    toCsv,
    templateCsvRows
  };
})(window);
