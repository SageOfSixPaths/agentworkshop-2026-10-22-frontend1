// Tests the browser libraries (bands, diff, scenarios, housing) against live marlin and our stops.
// Usage: node libs-test.js [baseUrl]
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const dir = '../../board/public/colony/vijay-team/';
const Bands = require(dir + 'bands.js');
const Diff = require(dir + 'diff.js');
const Scen = require(dir + 'scenarios.js');
const Hous = require(dir + 'housing.js');
const C = require(dir + 'compare.js');

const base = {
  origin: { lat: 59.3303, lon: 18.0586 }, startTime: '08:00', maxTravelMinutes: 30, maxWaitMinutes: 7, maxTransfers: 3,
  modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'], walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5,
};
const iso = async (b) => (await fetch(BASE + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) fails++; };
const set = (fc, stops) => new Set(stops.filter((s) => C.stopMinutes(fc, s) !== null).map((s) => s.index));

(async () => {
  const stops = await (await fetch(BASE + '/t/vijay-team/stops?day=weekday')).json();

  // bands: slicing a 60 min answer must match a direct 30 min query
  const cache = Bands.cache(iso, 60);
  const big = await cache.get(base);
  const same = cache.get(base) === cache.get({ ...base, maxTravelMinutes: 10 });
  check(same, 'bands cache reuses one request per origin and settings');
  const sliced = set(Bands.cut(big, 30), stops);
  const direct = set(await iso(base), stops);
  const diffN = [...direct].filter((i) => !sliced.has(i)).length + [...sliced].filter((i) => !direct.has(i)).length;
  check(diffN <= direct.size * 0.01, 'sliced 60 -> 30 equals a direct 30 min answer within 1%', `${sliced.size} vs ${direct.size}, ${diffN} differ`);
  check(Bands.cut(big, 15).features.every((f) => f.properties.toMinutes <= 15) && Bands.cut(big, 15).meta.maxTravelMinutes === 15, 'cut keeps only bands up to the maximum');

  // diff: morning vs late evening, and weekday vs Sunday
  const night = await iso({ ...base, startTime: '23:00' });
  const morning = await iso(base);
  let t = Date.now();
  const d = Diff.stations(morning, night, stops);
  const g = Diff.grid(morning, night);
  check(d.lost.length > d.gained.length, 'night loses more stations than it gains vs morning', `lost ${d.lost.length}, gained ${d.gained.length}, slower ${d.slower.length}`);
  check(g.gainedKm2 + g.lostKm2 > 0 && g.cellM >= 500 && g.cells.length < 40000, 'grid diff has cells', `${g.cells.length} cells of ${g.cellM} m, lost ${g.lostKm2} km2, gained ${g.gainedKm2} km2, ${Date.now() - t} ms`);
  const sun = await iso({ ...base, day: 'sunday' });
  const ds = Diff.stations(morning, sun, stops);
  check(ds.lost.length + ds.slower.length > 0, 'Sunday is worse than weekday morning', `lost ${ds.lost.length}, slower ${ds.slower.length}`);
  check(Diff.stations(morning, morning, stops).lost.length === 0 && Diff.grid(morning, morning).cells.length === 0, 'identical answers give an empty diff');

  // round trip: a stay shrinks the workable set, and every listed place fits the window
  const rt0 = await C.roundTrip(iso, { ...base, maxTravelMinutes: 60 }, stops, { start: '17:00', returnBy: '19:00' });
  const rt30 = await C.roundTrip(iso, { ...base, maxTravelMinutes: 60 }, stops, { start: '17:00', returnBy: '19:00', stayMinutes: 30 });
  check(rt0.both.length > rt30.both.length && rt30.tooTight.length > 0, 'round trip: a 30 min stay removes places', `${rt0.both.length} -> ${rt30.both.length}`);
  check(rt30.both.every((r) => r.minutesOut + r.minutesBack + 30 <= rt30.windowMinutes), 'round trip: every listed place fits out + stay + back in the window');

  // scenarios
  const s = Scen.save('Home to work', { origin: base.origin, body: base, note: 'test' });
  check(Scen.list().length === 1 && Scen.get(s.id).name === 'Home to work', 'scenario saved and listed');
  check(Scen.rename(s.id, 'Home') && Scen.get(s.id).name === 'Home', 'scenario renamed');
  const exported = Scen.exportJSON();
  Scen.remove(s.id);
  check(Scen.list().length === 0 && Scen.importJSON(exported) === 1 && Scen.importJSON(exported) === 0, 'export, remove, import restores once and ignores duplicates');
  let threw = false;
  try { Scen.save('', { origin: base.origin, body: base }); } catch (e) { threw = true; }
  check(threw, 'invalid scenario is rejected');

  // housing (synthetic fixture generated from random stations, NOT real prices)
  const pick = stops.filter((_, i) => i % 40 === 0).slice(0, 100);
  const csv = 'lat,lon,price,label\n' + pick.map((p, i) => `${p.lat},${p.lon},${2000000 + i * 25000},${p.name.replace(/,/g, ' ')}`).join('\n');
  const homes = Hous.fromCSV(csv);
  const rows = Hous.analyze(homes, morning);
  const cheap = Hous.cheapestWithin(rows, 30, 5);
  check(homes.length === pick.length && rows.some((r) => r.minutes !== null), 'housing CSV parsed and matched to bands', `${homes.length} homes, ${rows.filter((r) => r.minutes !== null).length} in reach`);
  check(cheap.every((r, i) => r.minutes <= 30 && (i === 0 || cheap[i - 1].price <= r.price)), 'cheapestWithin is sorted and within the limit');
  check(Hous.byBand(rows).every((b) => b.count > 0 && b.medianPrice > 0), 'byBand medians computed');
  let bad = false;
  try { Hous.fromCSV('a,b\n1,2'); } catch (e) { bad = true; }
  check(bad, 'CSV without lat/lon/price is rejected');

  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
