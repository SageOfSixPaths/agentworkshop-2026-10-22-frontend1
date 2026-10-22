// Fragility layer for a Leaflet map: every station coloured by how much of its service one route carries.
//   const layer = VijayFragility.attach(map);          // weekday
//   layer.setDay('sunday'); layer.setVisible(false);
//   layer.highlight('14');                             // dim everything except stations that route serves alone or mostly
// Colours: red = served by one route only (a single disruption cuts it off), orange >= 80% on one route, yellow >= 50%, green = well spread.
// Data: GET /t/vijay-team/fragility. Pure helpers are exported for tests: bucketOf(row).
(function () {
  var BASE = '/t/vijay-team';
  var BUCKETS = [
    { key: 'single', color: '#a50026', en: 'one route only', sv: 'bara en linje' },
    { key: 'high', color: '#f46d43', en: '80% or more on one route', sv: '80 % eller mer på en linje' },
    { key: 'mid', color: '#fee08b', en: '50-79% on one route', sv: '50-79 % på en linje' },
    { key: 'spread', color: '#1a9850', en: 'well spread over routes', sv: 'väl fördelad på flera linjer' },
  ];

  function bucketOf(row) {
    if (row.singleLine) return BUCKETS[0];
    if (row.topShare >= 0.8) return BUCKETS[1];
    if (row.topShare >= 0.5) return BUCKETS[2];
    return BUCKETS[3];
  }

  function attach(map, opts) {
    opts = opts || {};
    var state = { day: opts.day || 'weekday', route: null };
    var group = L.layerGroup();
    var renderer = L.canvas({ padding: 0.5 });
    var cache = {};
    var counts = null;

    function get(day) {
      if (!cache[day]) {
        cache[day] = Promise.all([
          fetch(BASE + '/stops?day=' + day).then(function (r) { return r.json(); }),
          fetch(BASE + '/fragility?day=' + day).then(function (r) { return r.json(); }),
        ]);
      }
      return cache[day];
    }

    function draw() {
      return get(state.day).then(function (res) {
        var byIndex = new Map();
        res[1].stops.forEach(function (r) { byIndex.set(r.index, r); });
        group.clearLayers();
        counts = BUCKETS.map(function () { return 0; });
        res[0].forEach(function (s) {
          var r = byIndex.get(s.index);
          if (!r) return;
          var b = bucketOf(r);
          counts[BUCKETS.indexOf(b)]++;
          var on = !state.route || r.topRoute === state.route;
          L.circleMarker([s.lat, s.lon], { renderer: renderer, radius: on ? 4 : 2, weight: 0, fillOpacity: on ? 0.9 : 0.15, fillColor: b.color })
            .bindTooltip(s.name + ': ' + (r.singleLine ? 'only route ' : Math.round(r.topShare * 100) + '% on route ') + r.topRoute + ' (' + r.routes + ' route' + (r.routes === 1 ? '' : 's') + ')')
            .addTo(group);
        });
        return counts;
      });
    }

    var api = {
      layer: group,
      buckets: BUCKETS,
      counts: function () { return counts; },
      setDay: function (day) { state.day = day; return draw(); },
      highlight: function (route) { state.route = route || null; return draw(); },
      refresh: draw,
      setVisible: function (on) { if (on) group.addTo(map); else map.removeLayer(group); },
    };
    if (opts.visible !== false) group.addTo(map);
    draw();
    return api;
  }

  var api = { attach: attach, buckets: BUCKETS, bucketOf: bucketOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayFragility = api;
})();
