(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode ? { config: require('./config.js') } : { config: root.RouteLab.config };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.RouteLab = root.RouteLab || {}; root.RouteLab.charts = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var config = deps.config;
  var METHODS = config.METHODS;

  var POLICY_STYLE = {
    static: { color: '#1f2937', dash: 'none', width: 2, marker: 'square' },
    weighted: { color: '#7c3aed', dash: '6 3', width: 2, marker: 'diamond' },
    rules: { color: '#b45309', dash: '2 3', width: 2, marker: 'triangle-down' },
    egreedy: { color: '#0f766e', dash: '10 3 2 3', width: 2, marker: 'cross' },
    thompson: { color: '#1d4ed8', dash: 'none', width: 3, marker: 'circle' },
    thompson_cost: { color: '#be123c', dash: '4 2', width: 2, marker: 'triangle-up' },
    oracle: { color: '#6b7280', dash: '1 3', width: 2, marker: 'ring' }
  };
  var GATEWAY_STYLE = {
    A: { color: '#1d4ed8', dash: 'none' }, B: { color: '#b45309', dash: '6 3' }, C: { color: '#0f766e', dash: '2 3' },
    D: { color: '#be123c', dash: '10 3 2 3' }, E: { color: '#7c3aed', dash: '4 2' }
  };

  var X0 = 56;
  var X1 = 704;
  var Y0 = 16;
  var Y1 = 272;

  function node(tag, attrs, children, text) {
    return { tag: tag, attrs: attrs || {}, children: children || [], text: text === undefined ? null : text };
  }
  function n(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '0';
    return String(Math.round(x * 100) / 100);
  }
  function pad2(v) { return (v < 10 ? '0' : '') + v; }
  function hhmm(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function xOf(minute) { return X0 + minute / 1440 * (X1 - X0); }

  function frame(id, title, desc) {
    return node('svg', { viewBox: '0 0 720 320', role: 'img', 'aria-labelledby': id + '-title ' + id + '-desc', id: id + '-svg' }, [
      node('title', { id: id + '-title' }, [], title),
      node('desc', { id: id + '-desc' }, [], desc)
    ]);
  }

  function axes(svg, yLo, yHi, yFmt) {
    var c = svg.children;
    var i;
    c.push(node('line', { x1: n(X0), y1: n(Y1), x2: n(X1), y2: n(Y1), stroke: '#4a4a4a', 'stroke-width': '1' }));
    c.push(node('line', { x1: n(X0), y1: n(Y0), x2: n(X0), y2: n(Y1), stroke: '#4a4a4a', 'stroke-width': '1' }));
    for (i = 0; i <= 8; i++) {
      var xx = xOf(i * 180);
      c.push(node('line', { x1: n(xx), y1: n(Y1), x2: n(xx), y2: n(Y1 + 4), stroke: '#4a4a4a', 'stroke-width': '1' }));
      c.push(node('text', { x: n(xx), y: n(Y1 + 18), 'text-anchor': 'middle', 'font-size': '11', fill: '#111111' }, [], hhmm(i * 180 === 1440 ? 1440 : i * 180).replace('24:00', '24:00')));
    }
    for (i = 0; i <= 4; i++) {
      var v = yLo + (yHi - yLo) * i / 4;
      var yy = Y1 - (Y1 - Y0) * i / 4;
      c.push(node('line', { x1: n(X0 - 4), y1: n(yy), x2: n(X0), y2: n(yy), stroke: '#4a4a4a', 'stroke-width': '1' }));
      c.push(node('text', { x: n(X0 - 8), y: n(yy + 4), 'text-anchor': 'end', 'font-size': '11', fill: '#111111' }, [], yFmt(v)));
    }
  }

  function marker(kind, x, y, color) {
    var s = 4;
    var a = { stroke: color, 'stroke-width': '1.5', fill: color };
    switch (kind) {
      case 'square': return node('rect', Object.assign({ x: n(x - s), y: n(y - s), width: n(2 * s), height: n(2 * s) }, a));
      case 'diamond': return node('polygon', Object.assign({ points: [n(x), n(y - s - 1), n(x + s + 1), n(y), n(x), n(y + s + 1), n(x - s - 1), n(y)].join(',') }, a));
      case 'triangle-down': return node('polygon', Object.assign({ points: [n(x - s), n(y - s), n(x + s), n(y - s), n(x), n(y + s)].join(',') }, a));
      case 'triangle-up': return node('polygon', Object.assign({ points: [n(x - s), n(y + s), n(x + s), n(y + s), n(x), n(y - s)].join(',') }, a));
      case 'cross': return node('path', { d: 'M' + n(x - s) + ',' + n(y - s) + 'L' + n(x + s) + ',' + n(y + s) + 'M' + n(x - s) + ',' + n(y + s) + 'L' + n(x + s) + ',' + n(y - s), stroke: color, 'stroke-width': '2', fill: 'none' });
      case 'ring': return node('circle', { cx: n(x), cy: n(y), r: n(s + 1), stroke: color, 'stroke-width': '2', fill: '#ffffff' });
      default: return node('circle', Object.assign({ cx: n(x), cy: n(y), r: n(s) }, a));
    }
  }

  function eventShapes(results, yLo) {
    var out = [];
    (results.config.events || []).forEach(function (e) {
      var cnt = e.repeatEvery > 0 ? e.repeatCount : 1;
      for (var k = 0; k < cnt; k++) {
        var s = e.start + k * e.repeatEvery;
        var end = s + e.duration;
        var recEnd = end + e.recovery;
        if (s >= 1440) break;
        var ex = Math.min(end, 1440);
        out.push(node('rect', { x: n(xOf(s)), y: n(Y0), width: n(Math.max(0, xOf(ex) - xOf(s))), height: n(Y1 - Y0), fill: '#e5e7eb', 'data-role': 'event' }));
        if (e.recovery > 0 && end < 1440) {
          out.push(node('rect', { x: n(xOf(end)), y: n(Y0), width: n(Math.max(0, xOf(Math.min(recEnd, 1440)) - xOf(end))), height: n(Y1 - Y0), fill: '#f3f4f6', 'data-role': 'recovery' }));
        }
      }
    });
    return out;
  }

  function eventSentence(results) {
    var ev = results.config.events || [];
    if (!ev.length) return '';
    var parts = ev.slice(0, 3).map(function (e) {
      var who = (e.target === 'gateway' ? 'Gateway ' : 'Bank ') + e.id;
      var s = who + ' event ' + hhmm(e.start) + '-' + hhmm(Math.min(1440, e.start + e.duration));
      if (e.recovery > 0) s += ', recovery to ' + hhmm(Math.min(1440, e.start + e.duration + e.recovery));
      if (e.repeatEvery > 0) s += ', repeating ' + e.repeatCount + ' times';
      return s;
    });
    return ' Shaded: ' + parts.join('; ') + (ev.length > 3 ? '; and more' : '') + '.';
  }

  function segments(values, xs) {
    var segs = [];
    var cur = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i] === null || values[i] === undefined || !isFinite(values[i])) { if (cur.length) segs.push(cur); cur = []; }
      else cur.push([xs(i), values[i]]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  function lineGroup(id, label, segs, yOf, style, dataAttr, markerEvery) {
    var g = node('g', { 'data-role': 'series', 'data-id': dataAttr, fill: 'none' });
    segs.forEach(function (seg) {
      var pts = seg.map(function (p) { return n(p[0]) + ',' + n(yOf(p[1])); }).join(' ');
      var a = { points: pts, stroke: style.color, 'stroke-width': String(style.width || 2), fill: 'none' };
      if (style.dash && style.dash !== 'none') a['stroke-dasharray'] = style.dash;
      g.children.push(node('polyline', a));
    });
    if (markerEvery && style.marker && style.marker !== 'none') {
      segs.forEach(function (seg) {
        seg.forEach(function (p, i) { if (i % markerEvery === 0) g.children.push(marker(style.marker, p[0], yOf(p[1]), style.color)); });
      });
    }
    return g;
  }

  function range(vals, lo0, hi0) {
    var mn = Infinity;
    var mx = -Infinity;
    vals.forEach(function (v) { if (v !== null && v !== undefined && isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } });
    if (mn === Infinity) return [lo0, hi0];
    return [mn, mx];
  }

  function srChart(results, options) {
    var method = options && options.method && options.method !== 'all' ? options.method : null;
    var id = (options && options.id) || 'rl-ch-sr';
    var pols = results.policies;
    var get = function (p) { return method ? results.series.orderSrByMethod[p.id][method] : results.series.orderSr[p.id]; };
    var all = [];
    pols.forEach(function (p) { all = all.concat(get(p)); });
    var r = range(all, 0, 1);
    var lo = Math.max(0, Math.floor((r[0] - 0.01) * 50) / 50);
    var hi = Math.min(1, Math.ceil((r[1] + 0.005) * 50) / 50);
    if (!(hi > lo)) hi = Math.min(1, lo + 0.02);
    if (!(hi > lo)) lo = Math.max(0, hi - 0.02);
    var yOf = function (v) { return Y1 - (v - lo) / (hi - lo) * (Y1 - Y0); };
    var title = 'Order success rate over the day' + (method ? ' (' + config.METHOD_LABELS[method] + ')' : '');
    var desc = 'Order success rate' + (method ? ' for ' + config.METHOD_LABELS[method] : '') + ' in 15-minute buckets for ' + pols.length +
      ' strategies, pooled over ' + results.seeds.length + ' seeds.' + eventSentence(results);
    var svg = frame(id, title, desc);
    axes(svg, lo, hi, function (v) { return (v * 100).toFixed(1) + '%'; });
    eventShapes(results, lo).forEach(function (s) { svg.children.push(s); });
    pols.forEach(function (p) {
      svg.children.push(lineGroup(id, p.label, segments(get(p), function (i) { return xOf(i * 15 + 7.5); }), yOf, POLICY_STYLE[p.id], p.id, 8));
    });
    return svg;
  }

  function shareChart(results, options) {
    var id = (options && options.id) || 'rl-ch-share';
    var pid = options && options.policy;
    if (!pid || !results.series.share[pid]) pid = results.policies[0].id;
    var gws = Object.keys(results.series.share[pid]);
    var yOf = function (v) { return Y1 - v * (Y1 - Y0); };
    var desc = 'Share of first attempts by gateway in 15-minute buckets for ' + config.POLICY_LABELS[pid] + ', pooled over ' +
      results.seeds.length + ' seeds.' + eventSentence(results);
    var svg = frame(id, 'Share of first attempts by gateway (' + config.POLICY_LABELS[pid] + ')', desc);
    axes(svg, 0, 1, function (v) { return Math.round(v * 100) + '%'; });
    eventShapes(results, 0).forEach(function (s) { svg.children.push(s); });
    gws.forEach(function (g) {
      var vals = results.series.share[pid][g];
      var segs = segments(vals, function (i) { return xOf(i * 15 + 7.5); });
      svg.children.push(lineGroup(id, 'Gateway ' + g, segs, yOf, { color: GATEWAY_STYLE[g].color, dash: GATEWAY_STYLE[g].dash, width: 2 }, g, 0));
      var last = null;
      for (var i = vals.length - 1; i >= 0; i--) if (vals[i] !== null && isFinite(vals[i])) { last = vals[i]; break; }
      if (last !== null) svg.children.push(node('text', { x: n(X1 - 2), y: n(yOf(last) - 4), 'text-anchor': 'end', 'font-size': '11', fill: GATEWAY_STYLE[g].color }, [], g));
    });
    return svg;
  }

  function scatterChart(results, options) {
    var id = (options && options.id) || 'rl-ch-scatter';
    var pols = results.policies;
    var xs = [];
    var ys = [];
    pols.forEach(function (p) {
      var s = results.summary[p.id];
      [s.costPerSuccess.mean, s.costPerSuccess.ciLow, s.costPerSuccess.ciHigh].forEach(function (v) { xs.push(v); });
      [s.orderSr.mean, s.orderSr.ciLow, s.orderSr.ciHigh].forEach(function (v) { ys.push(v); });
    });
    function padded(vals) {
      var r = range(vals, 0, 1);
      var span = r[1] - r[0];
      var pad = span > 0 ? span * 0.1 : Math.abs(r[0]) * 0.01 || 0.01;
      return [r[0] - pad, r[1] + pad];
    }
    var rx = padded(xs);
    var ry = padded(ys);
    var xOfV = function (v) { return X0 + (v - rx[0]) / (rx[1] - rx[0]) * (X1 - X0); };
    var yOfV = function (v) { return Y1 - (v - ry[0]) / (ry[1] - ry[0]) * (Y1 - Y0); };
    var desc = 'Mean cost per success (horizontal) against mean order success rate (vertical) for ' + pols.length +
      ' strategies, with 95% intervals across ' + results.seeds.length + ' seeds.';
    var svg = frame(id, 'Cost per success vs order success rate', desc);
    // axes drawn with their own tick labels
    var c = svg.children;
    c.push(node('line', { x1: n(X0), y1: n(Y1), x2: n(X1), y2: n(Y1), stroke: '#4a4a4a', 'stroke-width': '1' }));
    c.push(node('line', { x1: n(X0), y1: n(Y0), x2: n(X0), y2: n(Y1), stroke: '#4a4a4a', 'stroke-width': '1' }));
    for (var i = 0; i <= 4; i++) {
      var xv = rx[0] + (rx[1] - rx[0]) * i / 4;
      var yv = ry[0] + (ry[1] - ry[0]) * i / 4;
      c.push(node('text', { x: n(xOfV(xv)), y: n(Y1 + 18), 'text-anchor': 'middle', 'font-size': '11', fill: '#111111' }, [], 'Rs ' + xv.toFixed(2)));
      c.push(node('text', { x: n(X0 - 8), y: n(yOfV(yv) + 4), 'text-anchor': 'end', 'font-size': '11', fill: '#111111' }, [], (yv * 100).toFixed(2) + '%'));
    }
    var placed = [];
    function labelY(x, y) {
      // Moves a label down until it does not overlap an earlier one (labels are about 130 x 14 px).
      var yy = y;
      for (var tries = 0; tries < 12; tries++) {
        var clash = false;
        for (var q = 0; q < placed.length; q++) if (Math.abs(placed[q][0] - x) < 130 && Math.abs(placed[q][1] - yy) < 14) clash = true;
        if (!clash) break;
        yy += 14;
      }
      placed.push([x, yy]);
      return yy;
    }
    pols.forEach(function (p) {
      var s = results.summary[p.id];
      var st = POLICY_STYLE[p.id];
      if (s.costPerSuccess.mean === null || s.orderSr.mean === null) return;
      var cx = xOfV(s.costPerSuccess.mean);
      var cy = yOfV(s.orderSr.mean);
      var g = node('g', { 'data-role': 'point', 'data-id': p.id });
      var xl = s.costPerSuccess.ciLow === null ? s.costPerSuccess.mean : s.costPerSuccess.ciLow;
      var xh = s.costPerSuccess.ciHigh === null ? s.costPerSuccess.mean : s.costPerSuccess.ciHigh;
      var yl = s.orderSr.ciLow === null ? s.orderSr.mean : s.orderSr.ciLow;
      var yh = s.orderSr.ciHigh === null ? s.orderSr.mean : s.orderSr.ciHigh;
      g.children.push(node('line', { x1: n(xOfV(xl)), y1: n(cy), x2: n(xOfV(xh)), y2: n(cy), stroke: st.color, 'stroke-width': '1.5', 'data-role': 'whisker' }));
      g.children.push(node('line', { x1: n(cx), y1: n(yOfV(yl)), x2: n(cx), y2: n(yOfV(yh)), stroke: st.color, 'stroke-width': '1.5', 'data-role': 'whisker' }));
      var mk = marker(st.marker, cx, cy, st.color);
      mk.attrs['data-role'] = 'marker';
      g.children.push(mk);
      var lx = cx + 8 > X1 - 120 ? cx - 8 : cx + 8;
      g.children.push(node('text', { x: n(lx), y: n(labelY(lx, cy - 6)), 'font-size': '11', fill: '#111111', 'text-anchor': lx < cx ? 'end' : 'start' }, [], p.label));
      svg.children.push(g);
    });
    return svg;
  }

  function legendItems(results, kind) {
    if (kind === 'gateways') return Object.keys(results.series.share[results.policies[0].id]).map(function (g) {
      return { id: g, label: 'Gateway ' + g, color: GATEWAY_STYLE[g].color, dash: GATEWAY_STYLE[g].dash };
    });
    return results.policies.map(function (p) {
      return { id: p.id, label: p.label, color: POLICY_STYLE[p.id].color, dash: POLICY_STYLE[p.id].dash, marker: POLICY_STYLE[p.id].marker };
    });
  }

  return { POLICY_STYLE: POLICY_STYLE, GATEWAY_STYLE: GATEWAY_STYLE, srChart: srChart, shareChart: shareChart,
    scatterChart: scatterChart, legendItems: legendItems, METHODS: METHODS };
});
