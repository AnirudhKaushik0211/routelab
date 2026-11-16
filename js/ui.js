(function () {
  'use strict';
  var RL = window.RouteLab;
  if (!RL || !RL.createRunner) return;

  var C = RL.config;
  var codec = C.codec;
  var F = RL.memo.format;
  var METHODS = RL.METHODS;
  var HELP_KEY = 'routelab.helpSeen.v1';
  var ALLOWED_KEYS = [HELP_KEY];
  var TABS = ['help', 'scenarios', 'config', 'results'];
  var SVG_NS = ['http', '//www.w3.org/2000/svg'].join(':');

  var MSG = {
    badLink: 'This link could not be read, so the default scenario was loaded.',
    unshownLink: 'This link\'s settings could not be shown, so the default scenario was loaded.',
    badLinkKept: 'This link could not be read; your current settings are kept.',
    unshownLinkKept: 'This link\'s settings could not be shown; your current settings are kept.',
    linkProblems: 'The link\'s settings have problems; fix the marked fields, then run.',
    linkLoaded: 'Loaded the settings from the link.',
    wrong: 'Something went wrong. Your settings are kept; please report this on the project\'s Issues page.',
    wrongRun: 'Something went wrong while running. Your settings are kept; please report this on the project\'s Issues page.',
    runFirst: 'Run a scenario first.',
    copied: 'Copied the memo.',
    copyFail: 'Copy did not work in this browser. The memo text is selected; press Ctrl+C (Cmd+C on a Mac).'
  };

  var S = { cfg: null, preset: null, results: null, runId: 0, running: false, evN: 0, ruleN: 0, lastHash: '', hashTimer: null,
    valTimer: null, cache: {}, kinds: [] };

  // ------------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function slug(m) { return String(m).replace(/_/g, '-'); }
  function lower(s) { return String(s).toLowerCase(); }

  function mk(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'checked') e.checked = !!v;
        else if (k === 'disabled') e.disabled = true;
        else if (k === 'hidden') e.hidden = true;
        else e.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function setText(id, text) { var e = $(id); if (e) e.textContent = text; }
  function setHidden(id, hidden) { var e = $(id); if (e) e.hidden = !!hidden; }
  function on(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, guard(fn)); }
  function readField(id) { var e = $(id); return e ? String(e.value) : ''; }
  function readChecked(id) { var e = $(id); return e ? !!e.checked : false; }
  function message(text) { setText('rl-status-text', text); }

  function guard(fn) {
    return function (ev) {
      try { return fn(ev); } catch (e) { warn(e); message(MSG.wrong); }
    };
  }
  function warn(e) { if (typeof console !== 'undefined' && console.warn) console.warn('RouteLab: ' + (e && e.message ? e.message : e)); }

  function storageGet(key) {
    if (ALLOWED_KEYS.indexOf(key) < 0) return null;
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    if (ALLOWED_KEYS.indexOf(key) < 0) return false;
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function setPath(obj, path, value) {
    var toks = path.match(/[^.\[\]]+/g);
    var o = obj;
    for (var i = 0; i < toks.length - 1; i++) {
      var t = /^\d+$/.test(toks[i]) ? Number(toks[i]) : toks[i];
      if (o[t] === null || typeof o[t] !== 'object') return false;
      o = o[t];
    }
    var last = /^\d+$/.test(toks[toks.length - 1]) ? Number(toks[toks.length - 1]) : toks[toks.length - 1];
    o[last] = value;
    return true;
  }

  // ------------------------------------------------------------------ tabs
  function currentTab() {
    for (var i = 0; i < TABS.length; i++) if ($('rl-tab-' + TABS[i]).getAttribute('aria-selected') === 'true') return TABS[i];
    return 'help';
  }
  function selectTab(name, focus) {
    for (var i = 0; i < TABS.length; i++) {
      var on_ = TABS[i] === name;
      var tab = $('rl-tab-' + TABS[i]);
      tab.setAttribute('aria-selected', on_ ? 'true' : 'false');
      tab.setAttribute('tabindex', on_ ? '0' : '-1');
      setHidden('rl-panel-' + TABS[i], !on_);
    }
    if (focus) $('rl-tab-' + name).focus();
    if (name !== 'help') storageSet(HELP_KEY, '1');
  }
  function onTabKey(ev) {
    var t = ev.target;
    var i = t && t.id && t.id.indexOf('rl-tab-') === 0 ? TABS.indexOf(t.id.slice(7)) : -1;
    if (i < 0) return;
    var n = i;
    if (ev.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (ev.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = TABS.length - 1;
    else return;
    ev.preventDefault();
    selectTab(TABS[n], true);
  }

  // ------------------------------------------------------------------ hash
  function writeHash() {
    try {
      var h = RL.encodeState(S.cfg);
      S.lastHash = h;
      try { history.replaceState(null, '', h); } catch (e) { location.replace(h); }
      S.lastHash = location.hash || h;
    } catch (e) { warn(e); }
  }
  function scheduleHash() {
    if (S.hashTimer) clearTimeout(S.hashTimer);
    S.hashTimer = setTimeout(function () { S.hashTimer = null; writeHash(); }, 400);
  }

  // ------------------------------------------------------------------ form rendering
  var DEFAULT_C_METHOD = null;
  function baseMethod(m) {
    if (!DEFAULT_C_METHOD) DEFAULT_C_METHOD = clone(RL.getScenario('steady').gateways[2].methods);
    return clone(DEFAULT_C_METHOD[m]);
  }

  function leaf(v, conv) {
    if (typeof v === 'number' && isFinite(v)) return String(conv ? conv(v) : v);
    if (v === undefined || v === null || typeof v === 'object') return '';
    return String(v);
  }

  // o: id, label, ariaLabel, path, kind, type, value (string) | checked, options [[value,label]], hint, errLabel, step, errId
  function addField(parent, o) {
    var wrap = mk('div', { 'class': o.kind === 'bool' ? 'rl-check' : 'rl-field' });
    var errId = o.errId || (o.id + '-err');
    var input;
    if (o.kind === 'select' || o.kind === 'selectint' || o.kind === 'target') {
      input = mk('select', { id: o.id });
      o.options.forEach(function (op) { input.appendChild(mk('option', { value: op[0], text: op[1] })); });
      var ok = o.options.some(function (op) { return op[0] === o.value; });
      if (ok) input.value = o.value;
    } else if (o.kind === 'bool' || o.kind === 'supports' || o.kind === 'methodsbox') {
      input = mk('input', { id: o.id, type: 'checkbox' });
      input.checked = !!o.checked;
    } else {
      input = mk('input', { id: o.id, type: o.type || 'number', step: o.type === 'time' ? '60' : (o.step || 'any') });
      if (o.type === 'text') input.removeAttribute('step');
      input.value = o.value === undefined ? '' : o.value;
    }
    if (o.path) input.setAttribute('data-path', o.path);
    input.setAttribute('data-kind', o.kind);
    input.setAttribute('data-label', o.errLabel || o.label || o.ariaLabel || '');
    input.setAttribute('data-err', errId);
    input.setAttribute('aria-describedby', errId);
    if (o.method) input.setAttribute('data-method', o.method);
    if (o.ariaLabel) input.setAttribute('aria-label', o.ariaLabel);
    var err = mk('span', { id: errId, 'class': 'rl-field-err', hidden: true });
    var label = o.label && !o.ariaLabel ? mk('label', { 'for': o.id, text: o.label }) : null;
    if (o.kind === 'bool' || o.kind === 'supports' || o.kind === 'methodsbox') { wrap.appendChild(input); if (label) wrap.appendChild(label); }
    else { if (label) wrap.appendChild(label); wrap.appendChild(input); }
    if (o.hint) wrap.appendChild(mk('span', { 'class': 'rl-hint', text: ' ' + o.hint }));
    if (o.errId && o.errInside === false) { /* error element is placed by the caller */ } else wrap.appendChild(err);
    parent.appendChild(wrap);
    return input;
  }

  function fieldset(parent, id, legend, path) {
    var fs = mk('fieldset', { id: id, tabindex: '-1' }, [mk('legend', { text: legend })]);
    if (path) fs.setAttribute('data-path', path);
    parent.appendChild(fs);
    return fs;
  }

  function renderForm() {
    var cfg = S.cfg;
    var root = $('rl-cfg-form');
    clear(root);
    var i; var m;
    var get = function (o, k) { return o !== null && typeof o === 'object' ? o[k] : undefined; };
    var run = get(cfg, 'run') || {};

    // Run
    var fs = fieldset(root, 'rl-cfg-run-fs', 'Run');
    addField(fs, { id: 'rl-cfg-seeds', label: 'Number of seeds (1-100)', path: 'run.seeds', kind: 'int', value: leaf(run.seeds), step: '1', errLabel: 'Seeds' });
    addField(fs, { id: 'rl-cfg-seed-start', label: 'First seed', path: 'run.seedStart', kind: 'int', value: leaf(run.seedStart), step: '1', errLabel: 'First seed' });
    addField(fs, { id: 'rl-cfg-txns', label: 'Transactions per simulated day (100-50,000)', path: 'run.txnPerDay', kind: 'int', value: leaf(run.txnPerDay), step: '1', errLabel: 'Transactions per day' });

    // Traffic
    var tr = get(cfg, 'traffic') || {};
    fs = fieldset(root, 'rl-cfg-traffic', 'Traffic', 'traffic');
    METHODS.forEach(function (mm) {
      var ml = RL.METHOD_LABELS[mm];
      var amt = get(get(tr, 'amount'), mm) || {};
      var row = mk('div', { 'class': 'rl-row' });
      addField(row, { id: 'rl-cfg-mix-' + slug(mm), label: ml + ' share of traffic (relative weight)', path: 'traffic.mix.' + mm, kind: 'num', value: leaf(get(get(tr, 'mix'), mm)), errLabel: ml + ' share of traffic' });
      addField(row, { id: 'rl-cfg-decline-' + slug(mm), label: ml + ' customer-side decline (%)', path: 'traffic.customerDecline.' + mm, kind: 'pct', value: leaf(get(get(tr, 'customerDecline'), mm), codec.toPercent), errLabel: ml + ' customer-side decline' });
      addField(row, { id: 'rl-cfg-amt-' + slug(mm) + '-p50', label: ml + ' typical amount, p50 (Rs)', path: 'traffic.amount.' + mm + '.p50', kind: 'num', value: leaf(amt.p50), errLabel: ml + ' typical amount' });
      addField(row, { id: 'rl-cfg-amt-' + slug(mm) + '-p95', label: ml + ' large amount, p95 (Rs)', path: 'traffic.amount.' + mm + '.p95', kind: 'num', value: leaf(amt.p95), errLabel: ml + ' large amount' });
      fs.appendChild(row);
    });
    var banks = Array.isArray(get(tr, 'banks')) ? tr.banks : [];
    for (i = 0; i < banks.length; i++) {
      var bid = lower(get(banks[i], 'id'));
      var row2 = mk('div', { 'class': 'rl-row' });
      addField(row2, { id: 'rl-cfg-bank-' + bid + '-share', label: 'Bank ' + String(get(banks[i], 'id')).toUpperCase() + ' share of customers', path: 'traffic.banks[' + i + '].share', kind: 'num', value: leaf(get(banks[i], 'share')), errLabel: 'Bank ' + banks[i].id + ' share' });
      addField(row2, { id: 'rl-cfg-bank-' + bid + '-factor', label: 'Bank ' + String(get(banks[i], 'id')).toUpperCase() + ' success rate factor (%)', path: 'traffic.banks[' + i + '].srFactor', kind: 'pct', value: leaf(get(banks[i], 'srFactor'), codec.toPercent), errLabel: 'Bank ' + banks[i].id + ' success rate factor' });
      fs.appendChild(row2);
    }
    var det = mk('details', { id: 'rl-cfg-hourly' }, [mk('summary', { text: 'Hourly traffic shape' })]);
    var hourly = Array.isArray(get(tr, 'hourly')) ? tr.hourly : [];
    var hr = mk('div', { 'class': 'rl-row' });
    for (i = 0; i < 24; i++) {
      var hh = (i < 10 ? '0' : '') + i;
      addField(hr, { id: 'rl-cfg-hour-' + hh, label: hh + ':00 weight', path: 'traffic.hourly[' + i + ']', kind: 'num', value: leaf(hourly[i]), errLabel: 'Traffic at ' + hh + ':00' });
    }
    det.appendChild(hr);
    fs.appendChild(det);

    // Gateways
    var gws = Array.isArray(get(cfg, 'gateways')) ? cfg.gateways : [];
    var gfs = fieldset(root, 'rl-cfg-gateways', 'Gateways', 'gateways');
    for (i = 0; i < gws.length; i++) renderGateway(gfs, gws[i], i);
    var gb = mk('div', { 'class': 'rl-buttons' });
    gb.appendChild(mk('button', { type: 'button', id: 'rl-cfg-gw-add', text: 'Add a gateway', disabled: gws.length >= 5 }));
    gb.appendChild(mk('button', { type: 'button', id: 'rl-cfg-gw-remove', text: 'Remove the last gateway', disabled: gws.length <= 2 }));
    gfs.appendChild(gb);

    // Events
    var evs = Array.isArray(get(cfg, 'events')) ? cfg.events : [];
    var efs = fieldset(root, 'rl-cfg-events', 'Events', 'events');
    for (i = 0; i < evs.length; i++) renderEvent(efs, evs[i], i, gws);
    efs.appendChild(mk('button', { type: 'button', id: 'rl-cfg-ev-add', text: 'Add an event', disabled: evs.length >= 20 }));

    // Retries
    var rt = get(cfg, 'retry') || {};
    var dp = get(cfg, 'dropoff') || {};
    fs = fieldset(root, 'rl-cfg-retry-fs', 'Retries and drop-off');
    addField(fs, { id: 'rl-cfg-retries', label: 'Retries after a failed attempt', path: 'retry.maxRetries', kind: 'selectint', options: [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], value: leaf(rt.maxRetries), errLabel: 'Retries' });
    addField(fs, { id: 'rl-cfg-retry-mode', label: 'Retry on', path: 'retry.mode', kind: 'select', options: [['other', 'Another gateway'], ['same', 'The same gateway']], value: leaf(rt.mode), errLabel: 'Retry mode' });
    addField(fs, { id: 'rl-cfg-retry-delay', label: 'Delay before a retry (s)', path: 'retry.delaySec', kind: 'num', value: leaf(rt.delaySec), errLabel: 'Retry delay' });
    addField(fs, { id: 'rl-cfg-drop-base', label: 'Drop-off at the start (%)', path: 'dropoff.base', kind: 'pct', value: leaf(dp.base, codec.toPercent), errLabel: 'Drop-off at the start' });
    addField(fs, { id: 'rl-cfg-drop-persec', label: 'Extra drop-off per second waited (% per second)', path: 'dropoff.perSec', kind: 'pct', value: leaf(dp.perSec, codec.toPercent), errLabel: 'Drop-off per second' });
    addField(fs, { id: 'rl-cfg-drop-max', label: 'Maximum drop-off (%)', path: 'dropoff.max', kind: 'pct', value: leaf(dp.max, codec.toPercent), errLabel: 'Maximum drop-off' });
    fs.appendChild(mk('p', { 'class': 'rl-hint', text: 'Illustrative model: the chance that a customer gives up before a retry grows with waiting time.' }));

    // Strategies
    renderStrategies(root, cfg, gws);

    // Comparison
    var cmp = get(cfg, 'compare') || {};
    var foc = get(cfg, 'focus');
    fs = fieldset(root, 'rl-cfg-compare', 'Comparison');
    addField(fs, { id: 'rl-cfg-baseline', label: 'Compare against', path: 'compare.baseline', kind: 'select', options: baselineOptions(cfg), value: leaf(cmp.baseline), errLabel: 'Baseline' });
    addField(fs, { id: 'rl-cfg-focus-start', label: 'Focus window start (HH:MM, optional)', path: 'focus', kind: 'focusStart', type: 'time', value: foc && typeof foc.start === 'number' ? codec.toHHMM(foc.start) : '', errLabel: 'Focus window' });
    addField(fs, { id: 'rl-cfg-focus-end', label: 'Focus window end (HH:MM or 24:00, optional)', kind: 'focusEnd', type: 'text', value: foc && typeof foc.end === 'number' ? codec.toHHMM(foc.end) : '', errLabel: 'Focus window end' });
    var fe = $('rl-cfg-focus-end');
    fe.setAttribute('pattern', '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$');
    fe.setAttribute('inputmode', 'numeric');
    updateMemoryFields();
    updateResetButton();
  }

  function baselineOptions(cfg) {
    var st = cfg && cfg.strategies && typeof cfg.strategies === 'object' ? cfg.strategies : {};
    var out = [];
    RL.STRATEGY_IDS.forEach(function (id) { if (st[id] && st[id].enabled === true) out.push([id, RL.POLICY_LABELS[id]]); });
    return out;
  }

  function renderGateway(parent, g, i) {
    var gid = lower(g.id);
    var G = String(g.id).toUpperCase();
    var fs = fieldset(parent, 'rl-cfg-gw-' + gid, 'Gateway ' + G, 'gateways[' + i + ']');
    var row = mk('div', { 'class': 'rl-row' });
    addField(row, { id: 'rl-cfg-gw-' + gid + '-active', label: 'Live from (HH:MM)', path: 'gateways[' + i + '].activeFrom', kind: 'time', type: 'time', value: typeof g.activeFrom === 'number' && g.activeFrom >= 0 && g.activeFrom < 1440 ? codec.toHHMM(g.activeFrom) : '', errLabel: 'Gateway ' + G + ', live from' });
    addField(row, { id: 'rl-cfg-gw-' + gid + '-cap', label: 'Capacity (attempts per minute, empty = no limit)', path: 'gateways[' + i + '].capacityTpm', kind: 'nullint', value: leaf(g.capacityTpm), step: '1', errLabel: 'Gateway ' + G + ', capacity' });
    fs.appendChild(row);
    var table = mk('table', {}, [mk('caption', { text: 'Gateway ' + G + ' by payment method' }),
      mk('thead', {}, [mk('tr', {}, ['Method', 'Success rate (%)', 'Latency p50 (s)', 'Latency p95 (s)', 'Fixed fee (Rs)', 'Percentage fee (%)'].map(function (h) { return mk('th', { scope: 'col', text: h }); }))])]);
    var tb = mk('tbody');
    METHODS.forEach(function (m) {
      var mv = g.methods && typeof g.methods === 'object' ? g.methods[m] : null;
      var supported = mv !== null && mv !== undefined && typeof mv === 'object';
      var base = 'rl-cfg-gw-' + gid + '-' + slug(m);
      var ml = RL.METHOD_LABELS[m];
      var tr = mk('tr');
      function cellField(o) {
        var td = mk('td');
        o.errLabel = 'Gateway ' + G + ', ' + ml + ' ' + o.errName;
        var input = addField(td, o);
        if (!supported) input.disabled = true;
        tr.appendChild(td);
      }
      var tdOn = mk('td');
      addField(tdOn, { id: base + '-on', label: 'Supports ' + ml, path: 'gateways[' + i + '].methods.' + m, kind: 'supports', method: m, checked: supported });
      tr.appendChild(tdOn);
      var p = 'gateways[' + i + '].methods.' + m + '.';
      cellField({ id: base + '-sr', ariaLabel: 'Gateway ' + G + ', ' + ml + ', success rate (%)', path: p + 'sr', kind: 'pct', value: supported ? leaf(mv.sr, codec.toPercent) : '', errName: 'success rate' });
      cellField({ id: base + '-p50', ariaLabel: 'Gateway ' + G + ', ' + ml + ', latency p50 (s)', path: p + 'p50', kind: 'sec', value: supported ? leaf(mv.p50, codec.toSeconds) : '', errName: 'latency p50' });
      cellField({ id: base + '-p95', ariaLabel: 'Gateway ' + G + ', ' + ml + ', latency p95 (s)', path: p + 'p95', kind: 'sec', value: supported ? leaf(mv.p95, codec.toSeconds) : '', errName: 'latency p95' });
      cellField({ id: base + '-fixed', ariaLabel: 'Gateway ' + G + ', ' + ml + ', fixed fee (Rs)', path: p + 'fixedFee', kind: 'num', value: supported ? leaf(mv.fixedFee) : '', errName: 'fixed fee' });
      cellField({ id: base + '-pct', ariaLabel: 'Gateway ' + G + ', ' + ml + ', percentage fee (%)', path: p + 'pctFee', kind: 'num', value: supported ? leaf(mv.pctFee) : '', errName: 'percentage fee' });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    fs.appendChild(mk('div', { 'class': 'rl-scroll', tabindex: '0', role: 'region', 'aria-label': 'Gateway ' + G + ' settings by payment method' }, [table]));
  }

  function renderEvent(parent, e, i, gws) {
    S.evN++;
    var n = S.evN;
    var pre = 'rl-cfg-ev-' + n;
    var fs = fieldset(parent, pre, 'Event ' + (i + 1), 'events[' + i + ']');
    var p = 'events[' + i + '].';
    var opts = [];
    gws.forEach(function (g) { opts.push(['gateway:' + g.id, 'Gateway ' + g.id]); });
    ['X', 'Y', 'Z'].forEach(function (b) { opts.push(['bank:' + b, 'Bank ' + b]); });
    var isBank = e.target === 'bank';
    addField(fs, { id: pre + '-target', label: 'Affects', path: p + 'target', kind: 'target', options: opts, value: String(e.target) + ':' + String(e.id), errLabel: 'Event ' + (i + 1) + ', target' });
    var grp = mk('fieldset', { id: pre + '-methods' }, [mk('legend', { text: 'Payment methods' })]);
    var arr = Array.isArray(e.methods) ? e.methods : null;
    METHODS.forEach(function (m, k) {
      var checked = arr !== null && (arr.length === 0 || arr.indexOf(m) >= 0);
      var inp = addField(grp, { id: pre + '-m-' + slug(m), label: RL.METHOD_LABELS[m], path: p + 'methods', kind: 'methodsbox', method: m, checked: checked, errId: pre + '-m-err', errInside: false, errLabel: 'Event ' + (i + 1) + ', payment methods' });
    });
    grp.appendChild(mk('span', { id: pre + '-m-err', 'class': 'rl-field-err', hidden: true }));
    fs.appendChild(grp);
    var row = mk('div', { 'class': 'rl-row' });
    var L = 'Event ' + (i + 1) + ', ';
    addField(row, { id: pre + '-start', label: 'Starts at (HH:MM)', path: p + 'start', kind: 'time', type: 'time', value: typeof e.start === 'number' && e.start >= 0 && e.start < 1440 ? codec.toHHMM(e.start) : '', errLabel: L + 'start' });
    addField(row, { id: pre + '-duration', label: 'Duration (minutes)', path: p + 'duration', kind: 'int', step: '1', value: leaf(e.duration), errLabel: L + 'duration' });
    addField(row, { id: pre + '-sr', label: 'Success rate during the event, % of normal', path: p + 'srFactor', kind: 'pct', value: leaf(e.srFactor, codec.toPercent), errLabel: L + 'success rate' });
    var lat = addField(row, { id: pre + '-lat', label: 'Latency factor (1 = unchanged)', path: p + 'latencyFactor', kind: 'num', value: isBank ? '1' : leaf(e.latencyFactor), errLabel: L + 'latency factor' });
    if (isBank) lat.disabled = true;
    addField(row, { id: pre + '-recovery', label: 'Recovery (minutes)', path: p + 'recovery', kind: 'int', step: '1', value: leaf(e.recovery), errLabel: L + 'recovery' });
    addField(row, { id: pre + '-repeat-every', label: 'Repeat every (minutes, 0 = once)', path: p + 'repeatEvery', kind: 'int', step: '1', value: leaf(e.repeatEvery), errLabel: L + 'repeat interval' });
    addField(row, { id: pre + '-repeat-count', label: 'Number of occurrences', path: p + 'repeatCount', kind: 'int', step: '1', value: leaf(e.repeatCount), errLabel: L + 'occurrences' });
    fs.appendChild(row);
    fs.appendChild(mk('button', { type: 'button', id: pre + '-remove', 'data-index': i, text: 'Remove event ' + (i + 1) }));
  }

  var MEM_OPTS = [['none', 'No forgetting'], ['window', 'Sliding window'], ['discount', 'Discounting']];

  function renderStrategies(root, cfg, gws) {
    var get = function (o, k) { return o !== null && typeof o === 'object' ? o[k] : undefined; };
    var st = get(cfg, 'strategies') || {};
    var fs = fieldset(root, 'rl-cfg-strategies', 'Strategies', 'strategies');
    function section(id, label) {
      var sub = fieldset(fs, 'rl-cfg-st-' + slug(id), label, 'strategies.' + id);
      addField(sub, { id: 'rl-cfg-st-' + slug(id) + '-on', label: 'Include ' + label, path: 'strategies.' + id + '.enabled', kind: 'bool', checked: get(st[id], 'enabled') === true, errLabel: label });
      return sub;
    }
    var sub = section('static', 'Static priority');
    var pri = Array.isArray(get(st.static, 'priority')) ? st.static.priority : [];
    var gopts = gws.map(function (g) { return [String(g.id), 'Gateway ' + g.id]; });
    for (var k = 0; k < gws.length; k++) {
      addField(sub, { id: 'rl-cfg-st-static-p' + (k + 1), label: 'Position ' + (k + 1), path: 'strategies.static.priority[' + k + ']', kind: 'select', options: gopts, value: leaf(pri[k]), errLabel: 'Static priority, position ' + (k + 1) });
    }
    sub = section('weighted', 'Weighted split');
    var wts = get(st.weighted, 'weights');
    gws.forEach(function (g) {
      addField(sub, { id: 'rl-cfg-st-weighted-' + lower(g.id), label: 'Weight of Gateway ' + g.id + ' (%)', path: 'strategies.weighted.weights.' + g.id, kind: 'num', value: leaf(get(wts, g.id)), errLabel: 'Weight of Gateway ' + g.id });
    });
    sub = section('rules', 'Rule-based');
    var rules = Array.isArray(get(st.rules, 'rules')) ? st.rules.rules : [];
    var ropts = [['any', 'Any method']].concat(METHODS.map(function (m) { return [m, RL.METHOD_LABELS[m]]; }));
    rules.forEach(function (r, i) {
      S.ruleN++;
      var pre = 'rl-cfg-rule-' + S.ruleN;
      var rp = 'strategies.rules.rules[' + i + '].';
      var row = mk('div', { 'class': 'rl-row' });
      var L = 'Rule ' + (i + 1) + ', ';
      addField(row, { id: pre + '-method', label: 'Rule ' + (i + 1) + ': method', path: rp + 'method', kind: 'select', options: ropts, value: leaf(r.method), errLabel: L + 'method' });
      addField(row, { id: pre + '-min', label: 'Amount from (Rs)', path: rp + 'minAmount', kind: 'num', value: leaf(r.minAmount), errLabel: L + 'minimum amount' });
      addField(row, { id: pre + '-max', label: 'Amount below (Rs, empty = no limit)', path: rp + 'maxAmount', kind: 'nullnum', value: leaf(r.maxAmount), errLabel: L + 'maximum amount' });
      addField(row, { id: pre + '-gateway', label: 'Send to', path: rp + 'gateway', kind: 'select', options: gopts, value: leaf(r.gateway), errLabel: L + 'gateway' });
      row.appendChild(mk('button', { type: 'button', id: pre + '-remove', 'data-index': i, text: 'Remove rule ' + (i + 1) }));
      sub.appendChild(row);
    });
    sub.appendChild(mk('button', { type: 'button', id: 'rl-cfg-rule-add', text: 'Add a rule', disabled: rules.length >= 20 }));
    function learning(id, label, extra) {
      var s = section(id, label);
      var o = st[id] || {};
      var mem = get(o, 'memory') || {};
      var sl = 'rl-cfg-st-' + slug(id);
      if (extra) extra(s, o, sl);
      addField(s, { id: sl + '-mem', label: 'Memory', path: 'strategies.' + id + '.memory.kind', kind: 'select', options: MEM_OPTS, value: leaf(mem.kind), errLabel: label + ', memory' });
      addField(s, { id: sl + '-min', label: 'Memory (minutes)', path: 'strategies.' + id + '.memory.minutes', kind: 'int', step: '1', value: leaf(mem.minutes), errLabel: label + ', memory minutes' });
    }
    learning('egreedy', 'Epsilon-greedy', function (s, o, sl) {
      addField(s, { id: sl + '-eps', label: 'Epsilon: share of random exploration (%)', path: 'strategies.egreedy.epsilon', kind: 'pct', value: leaf(o.epsilon, codec.toPercent), errLabel: 'Epsilon' });
    });
    learning('thompson', 'Thompson sampling');
    learning('thompson_cost', 'Cost-aware Thompson', function (s, o, sl) {
      addField(s, { id: sl + '-lambda', label: 'Lambda: success probability traded per rupee of fee', path: 'strategies.thompson_cost.lambda', kind: 'num', value: leaf(o.lambda), hint: '0.01 means saving Rs 1 is worth 1 percentage point of success', errLabel: 'Lambda' });
    });
  }

  function updateMemoryFields() {
    [['egreedy', 'rl-cfg-st-egreedy'], ['thompson', 'rl-cfg-st-thompson'], ['thompson_cost', 'rl-cfg-st-thompson-cost']].forEach(function (p) {
      var sel = $(p[1] + '-mem');
      var min = $(p[1] + '-min');
      if (!sel || !min) return;
      var kind = sel.value;
      min.disabled = kind === 'none';
      var lab = document.querySelector('label[for="' + p[1] + '-min"]');
      if (lab) lab.textContent = kind === 'window' ? 'Window (minutes)' : (kind === 'discount' ? 'Half-life (minutes)' : 'Memory (minutes)');
    });
  }

  function updateResetButton() {
    var b = $('rl-cfg-reset');
    if (!b) return;
    var sc = null;
    for (var i = 0; i < RL.scenarios.length; i++) if (RL.scenarios[i].id === S.preset) sc = RL.scenarios[i];
    b.disabled = !sc;
    b.textContent = sc ? 'Reset to the ' + sc.title + ' preset' : 'Reset to the preset';
  }

  // ------------------------------------------------------------------ reading the form
  function parseNumber(el, kind) {
    var t = String(el.value).trim();
    if (t === '') return { empty: true };
    var v = Number(t);
    if (!isFinite(v)) return { bad: true };
    return { v: v };
  }

  // Returns { cfg, uiErrors: [{ el, message }] }
  function readForm() {
    var cfg = clone(S.cfg);
    var errs = [];
    var els = Array.prototype.slice.call($('rl-cfg-form').querySelectorAll('[data-kind]'));
    var methodBoxes = {};
    var focusStart = null; var focusEnd = null;
    function bad(el, msg) { errs.push({ el: el, message: msg }); }
    // pass 1: structure-changing kinds
    els.forEach(function (el) {
      var kind = el.getAttribute('data-kind');
      var path = el.getAttribute('data-path');
      if (kind === 'supports') {
        var cur = cfg;
        var toks = path.match(/[^.\[\]]+/g);
        var g = Number(toks[1]);
        var m = toks[3];
        if (cfg.gateways && cfg.gateways[g] && cfg.gateways[g].methods) {
          if (!el.checked) cfg.gateways[g].methods[m] = null;
          else if (cfg.gateways[g].methods[m] === null || typeof cfg.gateways[g].methods[m] !== 'object') cfg.gateways[g].methods[m] = {};
        }
      } else if (kind === 'target') {
        var parts = String(el.value).split(':');
        var ix = Number(path.match(/\d+/)[0]);
        if (cfg.events && cfg.events[ix]) {
          cfg.events[ix].target = parts[0];
          cfg.events[ix].id = parts[1];
          if (parts[0] === 'bank') cfg.events[ix].latencyFactor = 1;
        }
      }
    });
    // pass 2: leaves
    els.forEach(function (el) {
      var kind = el.getAttribute('data-kind');
      var path = el.getAttribute('data-path');
      if (kind === 'supports' || kind === 'target') return;
      if (kind === 'methodsbox') {
        (methodBoxes[path] = methodBoxes[path] || []).push(el);
        return;
      }
      if (kind === 'focusStart') { focusStart = el; return; }
      if (kind === 'focusEnd') { focusEnd = el; return; }
      if (el.disabled) return;
      var v;
      if (kind === 'bool') v = !!el.checked;
      else if (kind === 'select') v = String(el.value);
      else if (kind === 'selectint') v = Number(el.value);
      else if (kind === 'time') {
        v = codec.fromHHMM(el.value, false);
        if (v === null) { bad(el, 'Enter a time as HH:MM.'); return; }
      } else {
        var r = parseNumber(el, kind);
        if (r.bad || (r.empty && kind !== 'nullint' && kind !== 'nullnum')) { bad(el, 'Enter a number.'); return; }
        if (r.empty) v = null;
        else if (kind === 'pct') v = codec.fromPercent(r.v);
        else if (kind === 'sec') v = codec.fromSeconds(r.v);
        else v = r.v;
      }
      setPath(cfg, path, v);
    });
    Object.keys(methodBoxes).forEach(function (path) {
      var boxes = methodBoxes[path];
      var ticked = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.getAttribute('data-method'); });
      if (ticked.length === 0) { bad(boxes[0], 'Choose at least one payment method.'); return; }
      setPath(cfg, path, ticked.length === METHODS.length ? [] : METHODS.filter(function (m) { return ticked.indexOf(m) >= 0; }));
    });
    if (focusStart && focusEnd) {
      var sv = String(focusStart.value);
      var ev = String(focusEnd.value).trim();
      if (sv === '' && ev === '') cfg.focus = null;
      else if (sv === '' || ev === '') bad(sv === '' ? focusStart : focusEnd, 'Enter both times, or leave both empty.');
      else {
        var a = codec.fromHHMM(sv, false);
        var b = codec.fromHHMM(ev, true);
        if (a === null) bad(focusStart, 'Enter a time as HH:MM.');
        else if (b === null) bad(focusEnd, 'Enter a time as HH:MM.');
        else cfg.focus = { start: a, end: b };
      }
    }
    return { cfg: cfg, uiErrors: errs };
  }

  // ------------------------------------------------------------------ validation display
  function clearErrors() {
    Array.prototype.forEach.call($('rl-cfg-form').querySelectorAll('[aria-invalid]'), function (e) { e.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call($('rl-cfg-form').querySelectorAll('.rl-field-err'), function (e) { e.hidden = true; e.textContent = ''; });
    var box = $('rl-cfg-errors');
    clear(box);
    box.hidden = true;
  }

  function elementForPath(path) {
    var form = $('rl-cfg-form');
    var p = path;
    while (p) {
      var found = form.querySelector('[data-path="' + p.replace(/"/g, '') + '"]');
      if (found) return found;
      var cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
      if (cut <= 0) break;
      p = p.slice(0, cut);
    }
    return null;
  }

  function showErrors(list) {
    clearErrors();
    var box = $('rl-cfg-errors');
    if (!list.length) return 0;
    box.appendChild(mk('p', { text: 'Problems to fix:' }));
    var ul = mk('ul');
    list.forEach(function (it) {
      var el = it.el;
      var label = el ? el.getAttribute('data-label') : '';
      var text = it.message;
      if (label && !/^[a-z.]+(\[\d+\])?[a-zA-Z.]*: /.test(it.message)) text = label + ': ' + it.message;
      else text = it.message;
      if (!/[.]$/.test(text)) text += '.';
      if (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.setAttribute('aria-invalid', 'true');
        var errEl = $(el.getAttribute('data-err') || '');
        // Field-level UI messages ("Enter a number.") stand alone next to the field; the list adds the label.
        if (errEl) { errEl.hidden = false; errEl.textContent = it.ui ? it.message : text; }
      }
      var li = mk('li');
      var a = mk('a', { href: '#', 'data-target': el ? (el.id || '') : '', text: text });
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.hidden = false;
    return list.length;
  }

  // Reads the fields, validates, shows errors. Returns the number of problems.
  function collect() {
    var r = readForm();
    S.cfg = r.cfg;
    var items = r.uiErrors.map(function (e) { return { el: e.el, message: e.message, ui: true }; });
    var v = RL.validateConfig(r.cfg);
    if (!v.ok) {
      v.errors.forEach(function (e) {
        var el = elementForPath(e.path);
        // errors for a field that already has a UI-level error are skipped
        if (el && r.uiErrors.some(function (u) { return u.el === el; })) return;
        items.push({ el: el, message: codec.displayMessage(e.path, e.message) });
      });
    }
    var n = showErrors(items);
    refreshStale();
    return n;
  }

  function onFormChange(ev) {
    var t = ev && ev.target;
    if (t && t.getAttribute) {
      var kind = t.getAttribute('data-kind');
      if (kind === 'supports') toggleSupports(t);
      else if (kind === 'target') toggleTarget(t);
      else if (t.id && /^rl-cfg-st-static-p\d+$/.test(t.id)) swapPriority(t);
      else if (t.id && /^rl-cfg-st-.*-on$/.test(t.id)) { /* handled below */ }
      if (t.id && /-mem$/.test(t.id)) updateMemoryFields();
    }
    refreshBaseline();
    collect();
    scheduleHash();
  }

  function toggleSupports(box) {
    var path = box.getAttribute('data-path');
    var toks = path.match(/[^.\[\]]+/g);
    var g = Number(toks[1]);
    var m = toks[3];
    var idBase = box.id.replace(/-on$/, '');
    var suffixes = ['sr', 'p50', 'p95', 'fixed', 'pct'];
    var key = g + ':' + m;
    if (!box.checked) {
      var cur = S.cfg.gateways[g] && S.cfg.gateways[g].methods ? S.cfg.gateways[g].methods[m] : null;
      if (cur && typeof cur === 'object') S.cache[key] = clone(cur);
      suffixes.forEach(function (s) { var e = $(idBase + '-' + s); if (e) e.disabled = true; });
    } else {
      var vals = S.cache[key] || baseMethod(m);
      var map = { sr: leaf(vals.sr, codec.toPercent), p50: leaf(vals.p50, codec.toSeconds), p95: leaf(vals.p95, codec.toSeconds), fixed: leaf(vals.fixedFee), pct: leaf(vals.pctFee) };
      suffixes.forEach(function (s) { var e = $(idBase + '-' + s); if (e) { e.disabled = false; e.value = map[s]; } });
    }
  }

  function toggleTarget(sel) {
    var pre = sel.id.replace(/-target$/, '');
    var lat = $(pre + '-lat');
    if (!lat) return;
    var bank = String(sel.value).indexOf('bank:') === 0;
    lat.disabled = bank;
    if (bank) lat.value = '1';
  }

  function swapPriority(sel) {
    var k = Number(sel.id.replace('rl-cfg-st-static-p', ''));
    var selects = [];
    for (var i = 1; $('rl-cfg-st-static-p' + i); i++) selects.push($('rl-cfg-st-static-p' + i));
    var prev = S.cfg && S.cfg.strategies && S.cfg.strategies.static && Array.isArray(S.cfg.strategies.static.priority) ? S.cfg.strategies.static.priority[k - 1] : null;
    for (var j = 0; j < selects.length; j++) {
      if (j !== k - 1 && selects[j].value === sel.value && prev !== null) { selects[j].value = String(prev); break; }
    }
  }

  function refreshBaseline() {
    var sel = $('rl-cfg-baseline');
    if (!sel) return;
    var cur = sel.value;
    var opts = [];
    RL.STRATEGY_IDS.forEach(function (id) { if (readChecked('rl-cfg-st-' + slug(id) + '-on')) opts.push([id, RL.POLICY_LABELS[id]]); });
    var same = opts.length === sel.options.length && opts.every(function (o, i) { return sel.options[i].value === o[0]; });
    if (same) return;
    clear(sel);
    opts.forEach(function (o) { sel.appendChild(mk('option', { value: o[0], text: o[1] })); });
    var keep = opts.some(function (o) { return o[0] === cur; });
    if (keep) sel.value = cur;
  }

  function refreshStale() {
    var stale = !!S.results && C.canonicalJson(S.cfg) !== C.canonicalJson(S.results.config);
    setHidden('rl-res-stale', !stale);
  }

  // ------------------------------------------------------------------ structure edits
  function structureEdit(fn) {
    var r = readForm();
    S.cfg = r.cfg;
    fn(S.cfg);
    renderForm();
    collect();
    scheduleHash();
  }

  function addGateway() {
    structureEdit(function (cfg) {
      if (cfg.gateways.length >= 5) return;
      var id = RL.GATEWAY_IDS[cfg.gateways.length];
      var base = clone(RL.getScenario('steady').gateways[2]);
      base.id = id; base.activeFrom = 0; base.capacityTpm = null;
      cfg.gateways.push(base);
      cfg.strategies.static.priority.push(id);
      cfg.strategies.weighted.weights[id] = 0;
    });
    var b = $('rl-cfg-gw-add') && !$('rl-cfg-gw-add').disabled ? $('rl-cfg-gw-add') : $('rl-cfg-gw-remove');
    if (b) b.focus();
  }

  function removeGateway() {
    var removedRules = 0; var removedEvents = 0; var gid = '';
    structureEdit(function (cfg) {
      if (cfg.gateways.length <= 2) return;
      gid = cfg.gateways[cfg.gateways.length - 1].id;
      cfg.gateways.pop();
      cfg.strategies.static.priority = cfg.strategies.static.priority.filter(function (x) { return x !== gid; });
      delete cfg.strategies.weighted.weights[gid];
      var nr = cfg.strategies.rules.rules.length;
      cfg.strategies.rules.rules = cfg.strategies.rules.rules.filter(function (r) { return r.gateway !== gid; });
      removedRules = nr - cfg.strategies.rules.rules.length;
      var ne = cfg.events.length;
      cfg.events = cfg.events.filter(function (e) { return !(e.target === 'gateway' && e.id === gid); });
      removedEvents = ne - cfg.events.length;
    });
    if (gid) message('Removed Gateway ' + gid + ', ' + removedRules + ' rule(s) and ' + removedEvents + ' event(s) that used it.');
    var b = $('rl-cfg-gw-remove') && !$('rl-cfg-gw-remove').disabled ? $('rl-cfg-gw-remove') : $('rl-cfg-gw-add');
    if (b) b.focus();
  }

  function addEvent() {
    structureEdit(function (cfg) {
      if (cfg.events.length >= 20) return;
      cfg.events.push({ target: 'gateway', id: 'A', methods: [], start: 1080, duration: 30, srFactor: 0.2, latencyFactor: 1, recovery: 0, repeatEvery: 0, repeatCount: 1 });
    });
    var f = $('rl-cfg-form').querySelectorAll('[id$="-target"]');
    if (f.length) f[f.length - 1].focus();
  }

  function addRule() {
    structureEdit(function (cfg) {
      if (cfg.strategies.rules.rules.length >= 20) return;
      cfg.strategies.rules.rules.push({ method: 'any', minAmount: 0, maxAmount: null, gateway: cfg.gateways[0].id });
    });
    var f = $('rl-cfg-form').querySelectorAll('[id$="-method"]');
    if (f.length) f[f.length - 1].focus();
  }

  function onFormClick(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === 'rl-cfg-gw-add') addGateway();
    else if (t.id === 'rl-cfg-gw-remove') removeGateway();
    else if (t.id === 'rl-cfg-ev-add') addEvent();
    else if (t.id === 'rl-cfg-rule-add') addRule();
    else if (/^rl-cfg-ev-\d+-remove$/.test(t.id)) { var k = Number(t.getAttribute('data-index')); structureEdit(function (cfg) { cfg.events.splice(k, 1); }); var a = $('rl-cfg-ev-add'); if (a) a.focus(); }
    else if (/^rl-cfg-rule-\d+-remove$/.test(t.id)) { var j = Number(t.getAttribute('data-index')); structureEdit(function (cfg) { cfg.strategies.rules.rules.splice(j, 1); }); var b = $('rl-cfg-rule-add'); if (b) b.focus(); }
  }

  // ------------------------------------------------------------------ scenarios panel
  function selectedScenarioId() {
    var r = document.querySelector('input[name="rl-scn"]:checked');
    return r ? r.value : 'peak-outage';
  }
  function showScenarioDetail() {
    var id = selectedScenarioId();
    var sc = null;
    RL.scenarios.forEach(function (s) { if (s.id === id) sc = s; });
    var box = $('rl-scn-detail');
    clear(box);
    if (!sc) return;
    box.appendChild(mk('h3', { text: sc.title }));
    box.appendChild(mk('h4', { text: 'What to expect' }));
    box.appendChild(mk('p', { text: sc.expectationText }));
    box.appendChild(mk('p', { 'class': 'rl-hint', text: 'Checked by the test suite on seeds 1-20 and 101-130.' }));
  }
  function setScenarioRadio(id) {
    var r = $('rl-scn-' + id);
    if (r) { r.checked = true; showScenarioDetail(); }
  }

  function loadPreset(id, silent) {
    var wasCustom = S.preset === null;
    S.cfg = RL.getScenario(id);
    S.preset = id;
    renderForm();
    clearErrors();
    setScenarioRadio(id);
    writeHash();
    var title = '';
    RL.scenarios.forEach(function (s) { if (s.id === id) title = s.title; });
    if (!silent) message('Loaded the ' + title + ' preset.' + (wasCustom && S.results && S.results.preset === false ? ' Your previous settings were replaced.' : ''));
  }

  function findPreset(cfg) {
    var key = C.presetKey(cfg);
    for (var i = 0; i < RL.scenarios.length; i++) {
      if (C.presetKey(RL.getScenario(RL.scenarios[i].id)) === key) return RL.scenarios[i].id;
    }
    return null;
  }

  // ------------------------------------------------------------------ run loop
  function setRunning(running) {
    S.running = running;
    ['rl-scn-run', 'rl-cfg-run', 'rl-help-run', 'rl-exp-csv', 'rl-exp-json', 'rl-exp-memo', 'rl-exp-copy'].forEach(function (id) {
      var e = $(id);
      if (e) e.disabled = running;
    });
    setHidden('rl-run-progress', !running);
  }

  function startRun(opts) {
    opts = opts || {};
    if (S.running) return;
    var problems = collect();
    if (problems > 0) {
      selectTab('config', false);
      var box = $('rl-cfg-errors');
      box.focus();
      message('Fix ' + problems + ' problem(s) before running.');
      return;
    }
    var cfg = clone(S.cfg);
    var runner;
    try { runner = RL.createRunner(cfg, { scenarioId: S.preset || undefined }); } catch (e) { warn(e); setRunning(false); message(MSG.wrongRun); return; }
    var t0 = performance.now();
    var maxSlice = 0;
    setRunning(true);
    var bar = $('rl-run-bar');
    bar.max = runner.total;
    bar.value = 0;
    var seedsTotal = cfg.run.seeds;
    setText('rl-run-text', 'Running seed 1 of ' + seedsTotal + '...');
    if (!opts.keepStatus) message('Running ' + seedsTotal + ' seeds...');
    writeHash();
    function tick() {
      try {
        var s = performance.now();
        do { runner.step(); } while (!runner.isDone() && performance.now() - s < 30);
        var len = performance.now() - s;
        if (len > maxSlice) maxSlice = len;
        bar.value = runner.done;
        setText('rl-run-text', 'Running seed ' + Math.min(seedsTotal, Math.floor(runner.done / (runner.total / seedsTotal)) + 1) + ' of ' + seedsTotal + '...');
        if (!runner.isDone()) { setTimeout(tick, 0); return; }
        var s2 = performance.now();
        var results = runner.result();
        S.results = results;
        renderResults(results);
        writeHash();
        var last = performance.now() - s2;
        if (last > maxSlice) maxSlice = last;
        var ms = Math.round(performance.now() - t0);
        var rt = $('rl-run-time');
        rt.textContent = String(ms);
        rt.setAttribute('data-ms', String(ms));
        rt.setAttribute('data-max-slice-ms', String(Math.round(maxSlice)));
        setRunning(false);
        selectTab('results', false);
        $('rl-res-heading').focus();
        if (!opts.keepStatus) message('Finished: ' + seedsTotal + ' seeds in ' + ms + ' ms.');
        S.runId++;
        rt.setAttribute('data-run-id', String(S.runId));
        refreshStale();
      } catch (e) {
        warn(e);
        setRunning(false);
        message(MSG.wrongRun);
      }
    }
    setTimeout(tick, 0);
  }

  // ------------------------------------------------------------------ results rendering
  function cellText(td, mean, ci) {
    td.appendChild(document.createTextNode(mean));
    if (ci) { td.appendChild(mk('br')); td.appendChild(mk('span', { 'class': 'rl-ci', text: ci })); }
  }
  function statCell(stat, fmtMean, fmtEnd, unit) {
    var td = mk('td');
    if (!stat || stat.mean === null) { td.textContent = 'n/a'; return td; }
    cellText(td, fmtMean(stat.mean), stat.ciLow === null ? '' : fmtEnd(stat.ciLow) + '-' + fmtEnd(stat.ciHigh) + (unit || ''));
    return td;
  }
  function pairedCell(stat, fmt) {
    var td = mk('td');
    td.textContent = RL.memo.pairedCell(stat, fmt);
    return td;
  }
  function fillTable(id, head, rows, captionText) {
    var table = $(id);
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    clear(thead); clear(tbody);
    var hr = mk('tr');
    head.forEach(function (h) { hr.appendChild(mk('th', { scope: 'col', text: h })); });
    thead.appendChild(hr);
    rows.forEach(function (r) {
      var tr = mk('tr', r.cls ? { 'class': r.cls } : {});
      r.cells.forEach(function (c, i) {
        if (typeof c === 'string') tr.appendChild(mk(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', text: c } : { text: c }));
        else tr.appendChild(c);
      });
      tbody.appendChild(tr);
    });
    if (captionText !== undefined) { var cap = table.querySelector('caption'); if (cap) cap.textContent = captionText; }
  }

  function renderResults(res) {
    var cfg = res.config;
    setHidden('rl-res-empty', true);
    setHidden('rl-res-body', false);
    var seeds = res.seeds;
    setText('rl-res-summary-text', res.title + ': ' + seeds.length + ' seeds (' + seeds[0] + '-' + seeds[seeds.length - 1] + '), about ' + F.int(cfg.run.txnPerDay) +
      ' transactions per seed, ' + (res.policies.length - 1) + ' strategies plus the oracle.');
    // expectations
    var list = $('rl-res-expect-list');
    clear(list);
    if (res.preset) {
      setText('rl-res-expect-text', res.expectationText);
      res.expectations.forEach(function (e) {
        var status = e.held === true ? 'Held on these seeds' : (e.held === false ? 'Did not hold on these seeds' : 'Not checked');
        var li = mk('li');
        li.appendChild(mk('span', { 'class': e.held === false ? 'rl-notheld' : 'rl-held', text: status }));
        li.appendChild(document.createTextNode(': ' + e.detail));
        list.appendChild(li);
      });
    } else {
      setText('rl-res-expect-text', 'Expectations apply to the unmodified presets; these settings are custom.');
    }
    // summary table
    var pols = res.policies;
    fillTable('rl-res-table', ['Strategy', 'Order SR', 'First-attempt SR', 'Cost per success', 'Effective fee rate', 'Time to success p95', 'Drop-off', 'Retries per transaction', 'Regret per 1,000'],
      pols.map(function (p) {
        var s = res.summary[p.id];
        return { cls: p.reference ? 'rl-ref' : '', cells: [p.label, statCell(s.orderSr, F.pct, F.pctNum, '%'), statCell(s.firstSr, F.pct, F.pctNum, '%'),
          statCell(s.costPerSuccess, F.rs, F.rsNum), statCell(s.feeRatePct, F.two, function (x) { return x.toFixed(2); }, '%'), statCell(s.ttsP95, F.sec, F.secNum),
          statCell(s.dropRate, F.pct, F.pctNum, '%'), statCell(s.retriesPerTxn, F.three, F.three), statCell(s.regretPer1000, F.one, F.one)] };
      }));
    var baseLabel = RL.POLICY_LABELS[res.baseline];
    fillTable('rl-res-paired', ['Strategy', 'Order SR (pp)', 'First-attempt SR (pp)', 'Cost per success (Rs)', 'Regret per 1,000'],
      pols.filter(function (p) { return p.id !== res.baseline; }).map(function (p) {
        var d = res.paired[p.id];
        return { cls: p.reference ? 'rl-ref' : '', cells: [p.label, pairedCell(d.orderSr, F.pp), pairedCell(d.firstSr, F.pp), pairedCell(d.costPerSuccess, F.rsDiff), pairedCell(d.regretPer1000, F.oneDiff)] };
      }), 'Difference from ' + baseLabel + ', paired by seed');
    if (res.focus) {
      setHidden('rl-res-focus-wrap', false);
      var gids = cfg.gateways.map(function (g) { return g.id; });
      var head = ['Strategy', 'Order SR', 'First-attempt SR'];
      METHODS.forEach(function (m) { head.push('Order SR, ' + RL.METHOD_LABELS[m]); });
      gids.forEach(function (g) { head.push('Share of first attempts, Gateway ' + g); });
      fillTable('rl-res-focus', head, pols.map(function (p) {
        var f = res.focusSummary[p.id];
        var cells = [p.label, statCell(f.orderSr, F.pct, F.pctNum, '%'), statCell(f.firstSr, F.pct, F.pctNum, '%')];
        METHODS.forEach(function (m) { cells.push(statCell(f.orderSrByMethod[m], F.pct, F.pctNum, '%')); });
        gids.forEach(function (g) { cells.push(statCell(f.share[g], F.pct, F.pctNum, '%')); });
        return { cls: p.reference ? 'rl-ref' : '', cells: cells };
      }), 'During ' + RL.metrics.windowLabel([res.focus.start, res.focus.end]));
    } else setHidden('rl-res-focus-wrap', true);
    fillTable('rl-res-status', ['Strategy'].concat(RL.REASONS.map(function (r) { return RL.REASON_LABELS[r]; })),
      pols.map(function (p) {
        return { cls: p.reference ? 'rl-ref' : '', cells: [p.label].concat(RL.REASONS.map(function (r) { return statCell(res.status[p.id][r], F.pct, F.pctNum, '%'); })) };
      }));
    // chart selectors
    var ms = $('rl-ch-sr-method');
    var prevM = ms.value;
    clear(ms);
    ms.appendChild(mk('option', { value: 'all', text: 'All methods' }));
    METHODS.forEach(function (m) { ms.appendChild(mk('option', { value: m, text: RL.METHOD_LABELS[m] })); });
    if (prevM) ms.value = prevM;
    var ps = $('rl-ch-share-policy');
    var prevP = ps.value;
    clear(ps);
    pols.forEach(function (p) { ps.appendChild(mk('option', { value: p.id, text: p.label })); });
    var def = null;
    ['thompson', 'egreedy', 'thompson_cost'].forEach(function (id) { if (def === null && pols.some(function (p) { return p.id === id; })) def = id; });
    if (def === null) def = 'static';
    if (!pols.some(function (p) { return p.id === def; })) def = pols[0].id;
    ps.value = prevP && pols.some(function (p) { return p.id === prevP; }) ? prevP : def;
    renderCharts();
    // memo
    $('rl-memo-preview').textContent = RL.buildMemo(res, { generatedOn: localDate() });
  }

  function buildSvg(t) {
    var e = document.createElementNS(SVG_NS, t.tag);
    Object.keys(t.attrs).forEach(function (k) { e.setAttribute(k, t.attrs[k]); });
    if (t.text !== null && t.text !== undefined) e.textContent = t.text;
    t.children.forEach(function (c) { e.appendChild(buildSvg(c)); });
    return e;
  }

  function legend(id, items) {
    var ul = $(id);
    clear(ul);
    items.forEach(function (it) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '34'); svg.setAttribute('height', '12'); svg.setAttribute('viewBox', '0 0 34 12'); svg.setAttribute('aria-hidden', 'true');
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('x2', '34'); line.setAttribute('y1', '6'); line.setAttribute('y2', '6');
      line.setAttribute('stroke', it.color); line.setAttribute('stroke-width', '3');
      if (it.dash && it.dash !== 'none') line.setAttribute('stroke-dasharray', it.dash);
      svg.appendChild(line);
      var li = mk('li');
      li.appendChild(svg);
      li.appendChild(document.createTextNode(it.label + (it.dash && it.dash !== 'none' ? ' (dashed)' : '')));
      ul.appendChild(li);
    });
  }

  function hourLabel(h) { return (h < 10 ? '0' : '') + h + ':00'; }

  function renderCharts() {
    var res = S.results;
    if (!res) return;
    var method = $('rl-ch-sr-method').value;
    var policy = $('rl-ch-share-policy').value;
    var c1 = $('rl-ch-sr-chart'); clear(c1);
    c1.appendChild(buildSvg(RL.charts.srChart(res, { id: 'rl-ch-sr', method: method })));
    legend('rl-ch-sr-legend', RL.charts.legendItems(res));
    var c2 = $('rl-ch-share-chart'); clear(c2);
    c2.appendChild(buildSvg(RL.charts.shareChart(res, { id: 'rl-ch-share', policy: policy })));
    legend('rl-ch-share-legend', RL.charts.legendItems(res, 'gateways'));
    var c3 = $('rl-ch-scatter-chart'); clear(c3);
    c3.appendChild(buildSvg(RL.charts.scatterChart(res, { id: 'rl-ch-scatter' })));
    legend('rl-ch-scatter-legend', RL.charts.legendItems(res));
    // data tables (hourly series only)
    var hr = res.series.hourly;
    var rows = [];
    var h;
    for (h = 0; h < 24; h++) {
      rows.push({ cells: [hourLabel(h)].concat(res.policies.map(function (p) {
        var v = method === 'all' ? hr.orderSr[p.id][h] : hr.orderSrByMethod[p.id][method][h];
        return F.pct(v);
      })) });
    }
    fillTable('rl-ch-sr-table', ['Hour'].concat(res.policies.map(function (p) { return p.label; })), rows);
    var gids = Object.keys(hr.share[policy]);
    rows = [];
    for (h = 0; h < 24; h++) rows.push({ cells: [hourLabel(h)].concat(gids.map(function (g) { return F.pct(hr.share[policy][g][h]); })) });
    fillTable('rl-ch-share-table', ['Hour'].concat(gids.map(function (g) { return 'Gateway ' + g; })), rows);
    rows = [];
    for (h = 0; h < 24; h++) rows.push({ cells: [hourLabel(h)].concat(gids.map(function (g) { return F.pct(hr.gatewayAttemptSr[policy][g][h]); })) });
    fillTable('rl-ch-gwsr-table', ['Hour'].concat(gids.map(function (g) { return 'Gateway ' + g; })), rows);
    fillTable('rl-ch-scatter-table', ['Strategy', 'Cost per success', 'Order SR'], res.policies.map(function (p) {
      var s = res.summary[p.id];
      return { cls: p.reference ? 'rl-ref' : '', cells: [p.label, statCell(s.costPerSuccess, F.rs, F.rsNum), statCell(s.orderSr, F.pct, F.pctNum, '%')] };
    }));
  }

  function localDate() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ------------------------------------------------------------------ exports
  function scenarioName() { return S.results ? S.results.scenarioId : 'custom'; }
  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    message('Downloaded ' + name + '.');
  }
  function exportAs(kind) {
    if (!S.results) { message(MSG.runFirst); return; }
    var id = scenarioName();
    if (kind === 'csv') download('routelab-' + id + '-summary.csv', 'text/csv;charset=utf-8', RL.toCsv(S.results));
    else if (kind === 'json') download('routelab-' + id + '-results.json', 'application/json', RL.toJson(S.results));
    else download('routelab-' + id + '-memo.md', 'text/markdown;charset=utf-8', RL.buildMemo(S.results, { generatedOn: localDate() }));
  }
  function copyMemo() {
    if (!S.results) { message(MSG.runFirst); return; }
    var text = RL.buildMemo(S.results, { generatedOn: localDate() });
    $('rl-memo-preview').textContent = text;
    function fallback() {
      var d = $('rl-memo');
      if (d) d.open = true;
      var pre = $('rl-memo-preview');
      var ok = false;
      try {
        var range = document.createRange();
        range.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand('copy');
      } catch (e) { ok = false; }
      message(ok ? MSG.copied : MSG.copyFail);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { message(MSG.copied); }, function () { fallback(); });
    } else fallback();
  }

  // ------------------------------------------------------------------ link handling
  // Applies a decoded link; returns the status text. keepOnBad: hashchange behaviour.
  function applyHash(hash, midSession) {
    var d = RL.decodeState(hash);
    if (!d.ok) {
      if (midSession) { message(MSG.badLinkKept); writeHash(); return false; }
      message(MSG.badLink);
      return false;
    }
    if (!C.isRenderable(d.config)) {
      if (midSession) { message(MSG.unshownLinkKept); writeHash(); return false; }
      message(MSG.unshownLink);
      return false;
    }
    var v = RL.validateConfig(d.config);
    // The address of an untouched start-up (default preset, nothing edited) is not a shared result: treat it as no link.
    if (v.ok && !midSession && C.canonicalJson(v.config) === C.canonicalJson(RL.getScenario('peak-outage'))) return false;
    if (v.ok) {
      S.cfg = v.config;
      S.preset = findPreset(v.config);
      renderForm();
      if (S.preset) setScenarioRadio(S.preset);
      clearErrors();
      var seen = storageGet(HELP_KEY);
      selectTab('results', false);
      if (!seen && !midSession) setHidden('rl-newhere', false);
      message(MSG.linkLoaded);
      writeHash();
      startRun({ keepStatus: true });
      return true;
    }
    S.cfg = clone(d.config);
    S.preset = null;
    renderForm();
    selectTab('config', false);
    message(MSG.linkProblems);
    collect();
    writeHash();
    return true;
  }

  function onHashChange() {
    if (location.hash === S.lastHash) return;
    applyHash(location.hash, true);
  }

  // ------------------------------------------------------------------ start-up
  function init() {
    // static content filled from the library
    var tb = $('rl-help-scenarios').querySelector('tbody');
    RL.scenarios.forEach(function (s) {
      tb.appendChild(mk('tr', {}, [mk('th', { scope: 'row', text: s.title }), mk('td', { text: s.expectationText })]));
    });
    TABS.forEach(function (name) { on('rl-tab-' + name, 'click', function () { selectTab(name, false); }); });
    on('rl-tablist', 'keydown', onTabKey);
    on('rl-skip', 'click', function (ev) { ev.preventDefault(); $('rl-main').focus(); });
    on('rl-help-start', 'click', function () { storageSet(HELP_KEY, '1'); selectTab('scenarios', false); });
    on('rl-help-run', 'click', function () { storageSet(HELP_KEY, '1'); loadPreset('peak-outage', true); startRun(); });
    on('rl-newhere-close', 'click', function () { storageSet(HELP_KEY, '1'); setHidden('rl-newhere', true); });
    on('rl-newhere-help', 'click', function () { storageSet(HELP_KEY, '1'); setHidden('rl-newhere', true); selectTab('help', false); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="rl-scn"]'), function (r) { r.addEventListener('change', guard(showScenarioDetail)); });
    on('rl-scn-load', 'click', function () { loadPreset(selectedScenarioId()); selectTab('config', false); });
    on('rl-scn-run', 'click', function () { loadPreset(selectedScenarioId(), true); startRun(); });
    var form = $('rl-cfg-form');
    form.addEventListener('change', guard(onFormChange));
    form.addEventListener('input', guard(function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var k = t.getAttribute('data-kind');
      if (t.tagName === 'INPUT' && k !== 'bool' && k !== 'supports' && k !== 'methodsbox') {
        if (S.valTimer) clearTimeout(S.valTimer);
        S.valTimer = setTimeout(guard(function () { S.valTimer = null; collect(); }), 300);
        scheduleHash();
      }
    }));
    form.addEventListener('click', guard(onFormClick));
    $('rl-cfg-errors').addEventListener('click', guard(function (ev) {
      var a = ev.target;
      if (a && a.tagName === 'A') {
        ev.preventDefault();
        var id = a.getAttribute('data-target');
        var el = id ? $(id) : null;
        if (el) el.focus();
      }
    }));
    on('rl-cfg-run', 'click', function () { startRun(); });
    on('rl-cfg-reset', 'click', function () {
      var id = S.preset;
      if (!id) return;
      loadPreset(id, true);
      var title = '';
      RL.scenarios.forEach(function (s) { if (s.id === id) title = s.title; });
      message('Restored the ' + title + ' preset.');
    });
    on('rl-ch-sr-method', 'change', renderCharts);
    on('rl-ch-share-policy', 'change', renderCharts);
    on('rl-exp-csv', 'click', function () { exportAs('csv'); });
    on('rl-exp-json', 'click', function () { exportAs('json'); });
    on('rl-exp-memo', 'click', function () { exportAs('memo'); });
    on('rl-exp-copy', 'click', copyMemo);
    window.addEventListener('hashchange', guard(onHashChange));

    // start-up (SPEC 8.3)
    S.cfg = RL.getScenario('peak-outage');
    S.preset = 'peak-outage';
    renderForm();
    setScenarioRadio('peak-outage');
    var used = false;
    try {
      if (location.hash && location.hash !== '#') used = applyHash(location.hash, false);
    } catch (e) { warn(e); S.cfg = RL.getScenario('peak-outage'); S.preset = 'peak-outage'; renderForm(); message(MSG.unshownLink); used = false; }
    if (!used) {
      // Not decodable or not renderable: the default scenario stays loaded (8.3 steps 2 and 3).
      S.cfg = RL.getScenario('peak-outage');
      S.preset = 'peak-outage';
      renderForm();
      clearErrors();
      selectTab(storageGet(HELP_KEY) ? 'scenarios' : 'help', false);
      writeHash();
    }
  }

  guard(init)();
})();
