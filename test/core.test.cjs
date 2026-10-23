const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('../dist/index.js');

const site = kit.defineSite({
  productionUrl: 'https://club.example.ca/',
  name: 'Example Club',
  organization: {
    type: 'NGO',
    logo: '/images/mark.png',
    sameAs: ['https://facebook.com/x', 'https://zeffy.com/x'],
    memberOf: [{ name: 'Canadian Progress Club', url: 'https://progressclub.ca' }],
    areaServed: 'Greater Moncton',
    address: { addressLocality: 'Moncton', addressRegion: 'NB', addressCountry: 'CA' },
  },
  redirects: [{ from: '/donate/', to: '/donate-now' }, { from: '/old', to: 'https://zeffy.com/x' }],
});

test('production hosts include www and extras, nothing else', () => {
  assert.equal(kit.isProductionHost(site, 'club.example.ca'), true);
  assert.equal(kit.isProductionHost(site, 'www.club.example.ca:443'), true);
  assert.equal(kit.isProductionHost(site, '12.club.example.ca'), false);
  assert.equal(kit.isProductionHost(site, 'abc.185.111.188.159.sslip.io'), false);
  assert.equal(kit.isProductionHost(site, null), false);
  assert.equal(kit.isProductionHost({ ...site, productionHosts: ['alt.ca'] }, 'alt.ca'), true);
  assert.equal(kit.isProductionHost({ ...site, productionHosts: ['alt.ca:443'] }, 'alt.ca'), true, 'ports in productionHosts are ignored');
});

test('canonical URLs are on production', () => {
  assert.equal(kit.canonicalUrl(site, '/'), 'https://club.example.ca/');
  assert.equal(kit.canonicalUrl(site, 'antler-breakfast'), 'https://club.example.ca/antler-breakfast');
});

test('redirects are 301s and match with or without a trailing slash', () => {
  assert.deepEqual(kit.nextRedirects(site), [
    { source: '/donate', destination: '/donate-now', statusCode: 301 },
    { source: '/donate/', destination: '/donate-now', statusCode: 301 },
    { source: '/old', destination: 'https://zeffy.com/x', statusCode: 301 },
    { source: '/old/', destination: 'https://zeffy.com/x', statusCode: 301 },
  ]);
});

test('a redirect to its own path is skipped instead of looping', () => {
  assert.deepEqual(kit.nextRedirects({ ...site, redirects: [{ from: '/donate/', to: '/donate' }] }), []);
  // Review finding: the same page written as a full production URL also loops.
  assert.deepEqual(kit.nextRedirects({ ...site, redirects: [{ from: '/donate', to: 'https://club.example.ca/donate' }] }), []);
  assert.deepEqual(kit.nextRedirects({ ...site, redirects: [{ from: '/donate', to: 'https://www.club.example.ca/donate/' }] }), []);
  // A different host or path is a real redirect.
  assert.equal(kit.nextRedirects({ ...site, redirects: [{ from: '/donate', to: 'https://zeffy.com/donate' }] }).length, 2);
  assert.equal(kit.nextRedirects({ ...site, redirects: [{ from: '/give', to: 'https://club.example.ca/donate' }] }).length, 2);
});

test('organization JSON-LD: logo on the serving host, url on production, entity links', () => {
  const ld = kit.organizationJsonLd(site, 'https://12.club.example.ca');
  assert.equal(ld['@type'], 'NGO');
  assert.equal(ld.url, 'https://club.example.ca/');
  assert.equal(ld.logo, 'https://12.club.example.ca/images/mark.png');
  assert.deepEqual(ld.sameAs, ['https://facebook.com/x', 'https://zeffy.com/x']);
  assert.deepEqual(ld.memberOf, [{ '@type': 'Organization', name: 'Canadian Progress Club', url: 'https://progressclub.ca' }]);
  assert.equal(ld.areaServed, 'Greater Moncton');
  assert.equal('telephone' in ld, false, 'unset fields are left out');
});

test('time zone offsets follow daylight saving', () => {
  assert.equal(kit.zoneOffset('2026-11-27', '06:30', 'America/Moncton'), '-04:00');
  assert.equal(kit.zoneOffset('2026-07-01', '18:00', 'America/Moncton'), '-03:00');
  assert.equal(kit.zoneOffset('2026-03-08', '12:00', 'America/Halifax'), '-03:00');
  // Review finding: the hour after the spring-forward jump (02:00 → 03:00 on 2026-03-08).
  assert.equal(kit.zoneOffset('2026-03-08', '03:30', 'America/Halifax'), '-03:00');
  assert.equal(kit.zoneOffset('2026-03-08', '03:30', 'America/Moncton'), '-03:00');
  assert.equal(kit.zoneOffset('2026-03-08', '01:30', 'America/Moncton'), '-04:00');
  // Fall back (2026-11-01 02:00 → 01:00) and zones east of UTC.
  assert.equal(kit.zoneOffset('2026-11-01', '03:00', 'America/Moncton'), '-04:00');
  assert.equal(kit.zoneOffset('2026-03-29', '03:30', 'Europe/Paris'), '+02:00');
  assert.equal(kit.zoneOffset('2026-07-01', '12:00', 'Asia/Kolkata'), '+05:30');
});

test('event JSON-LD: dates with offset, place, offers only while upcoming', () => {
  const event = {
    name: 'Antler Breakfast', path: '/antler-breakfast', date: '2026-11-27', startTime: '06:30', endTime: '09:30',
    timeZone: 'America/Moncton', venue: { name: 'Moncton Coliseum', address: { addressLocality: 'Moncton' } },
    images: ['/images/events/a-1.webp'], ticketsUrl: 'https://tickets.example/a',
  };
  const before = kit.eventJsonLd(site, event, 'https://club.example.ca', new Date('2026-11-01T00:00:00Z'));
  assert.equal(before.startDate, '2026-11-27T06:30:00-04:00');
  assert.equal(before.endDate, '2026-11-27T09:30:00-04:00');
  assert.equal(before.url, 'https://club.example.ca/antler-breakfast');
  assert.deepEqual(before.location, { '@type': 'Place', name: 'Moncton Coliseum', address: { '@type': 'PostalAddress', addressLocality: 'Moncton' } });
  assert.equal(before.offers.url, 'https://tickets.example/a');
  assert.deepEqual(before.image, ['https://club.example.ca/images/events/a-1.webp']);

  const after = kit.eventJsonLd(site, event, 'https://club.example.ca', new Date('2026-11-27T14:00:00Z'));
  assert.equal(after.offers, undefined, 'no ticket offer once the event has ended');

  assert.equal(kit.eventJsonLd(site, { ...event, date: undefined }), null);
  assert.equal(kit.eventJsonLd(site, { ...event, status: 'cancelled' }, undefined, new Date('2026-01-01')).offers, undefined);
  const allDay = kit.eventJsonLd(site, { ...event, startTime: undefined, endTime: undefined }, undefined, new Date('2026-11-27T12:00:00Z'));
  assert.equal(allDay.startDate, '2026-11-27');
  assert.ok(allDay.offers, 'an all-day event keeps its offer until the day ends');
});

test('event end times past midnight, and multi-day events', () => {
  const gala = { name: 'Gala', path: '/gala', date: '2026-03-21', startTime: '19:00', endTime: '01:00', timeZone: 'America/Moncton' };
  const g = kit.eventJsonLd(site, gala, undefined, new Date('2026-03-01T00:00:00Z'));
  assert.equal(g.startDate, '2026-03-21T19:00:00-03:00');
  assert.equal(g.endDate, '2026-03-22T01:00:00-03:00', 'an end time before the start time is the next day');

  const fest = { name: 'Fest', path: '/fest', date: '2026-07-10', endDate: '2026-07-12', timeZone: 'America/Moncton', ticketsUrl: 'https://t.example' };
  const f = kit.eventJsonLd(site, fest, undefined, new Date('2026-07-12T15:00:00Z'));
  assert.equal(f.startDate, '2026-07-10');
  assert.equal(f.endDate, '2026-07-12');
  assert.ok(f.offers, 'still on until the last day ends');
  assert.equal(kit.eventJsonLd(site, fest, undefined, new Date('2026-07-13T04:00:00Z')).offers, undefined);
});

test('FAQPage JSON-LD', () => {
  assert.deepEqual(kit.faqJsonLd([{ question: 'Q?', answer: 'A.' }]).mainEntity, [
    { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } },
  ]);
});

test('JSON-LD serialization cannot close the script tag', () => {
  const out = kit.serializeJsonLd({ name: '</script><script>alert(1)</script>' });
  assert.equal(out.includes('</script>'), false);
  assert.deepEqual(JSON.parse(out), { name: '</script><script>alert(1)</script>' });
});
