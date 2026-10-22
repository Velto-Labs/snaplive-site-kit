/**
 * @snaplive/site-kit — the parts of SEO and hosting every Snaplive client site
 * needs, written once. This entry point has no Next.js runtime imports, so it
 * is safe to use from next.config.ts. Request-aware helpers are in
 * '@snaplive/site-kit/next'.
 */

export type PostalAddress = {
  streetAddress?: string;
  postOfficeBoxNumber?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
};

export type OrganizationConfig = {
  /** schema.org type: 'Organization', 'LocalBusiness', 'NGO', 'HomeAndConstructionBusiness', … */
  type?: string;
  alternateName?: string;
  email?: string;
  telephone?: string;
  /** Path on the site (e.g. '/images/logo.png') or an absolute URL. */
  logo?: string;
  foundingDate?: string;
  address?: PostalAddress;
  /** Profiles that identify the same organization elsewhere: social, directories, donation pages. */
  sameAs?: string[];
  /** Parent or national organizations. */
  memberOf?: { name: string; url?: string }[];
  /** e.g. 'Greater Moncton' or ['Moncton', 'Dieppe', 'Riverview']. */
  areaServed?: string | string[];
};

export type Redirect = {
  /** Path on this site, e.g. '/donate/' or '/old-page'. */
  from: string;
  /** Path on this site or an absolute URL. */
  to: string;
};

export type SiteConfig = {
  /** The live custom domain, e.g. 'https://monctonprogressclub.org'. No trailing slash needed. */
  productionUrl: string;
  name: string;
  description?: string;
  /** Open Graph locale, e.g. 'en_CA'. */
  locale?: string;
  /** Default social-card image: a path on the site or an absolute URL. */
  defaultImage?: string;
  organization?: OrganizationConfig;
  /** Old URLs (often from the site this one replaced) and where they now live. Served as 301s. */
  redirects?: Redirect[];
  /** Other hostnames that count as production (e.g. an alternate domain). 'www.' is always included. */
  productionHosts?: string[];
};

/** Identity function that type-checks a site's snaplive.config.ts. */
export function defineSite(config: SiteConfig): SiteConfig {
  return config;
}

/** 'https://example.ca/' → 'https://example.ca' */
export function productionOrigin(site: SiteConfig): string {
  return new URL(site.productionUrl).origin;
}

/** Whether a Host header value (with or without port) is one of the site's production hosts. */
export function isProductionHost(site: SiteConfig, host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0].toLowerCase();
  const prod = new URL(site.productionUrl).hostname.toLowerCase();
  const bare = prod.replace(/^www\./, '');
  const allowed = new Set([bare, `www.${bare}`, ...(site.productionHosts ?? []).map((h) => h.toLowerCase())]);
  return allowed.has(hostname);
}

/** The canonical (production) URL for a path on the site. */
export function canonicalUrl(site: SiteConfig, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return new URL(clean, productionOrigin(site)).toString();
}

/** Resolves a site path or absolute URL against an origin. */
export function absoluteUrl(pathOrUrl: string, origin: string): string {
  return new URL(pathOrUrl, origin).toString();
}

/**
 * The site's redirect map in the shape next.config.ts `redirects()` expects,
 * as 301s. Both '/old' and '/old/' are matched. An entry that points at its
 * own path (e.g. '/donate/' → '/donate') is skipped: it would loop, and
 * Next.js already sends trailing-slash URLs to the plain path.
 */
export function nextRedirects(site: SiteConfig) {
  const seen = new Set<string>();
  const out: { source: string; destination: string; statusCode: 301 }[] = [];
  for (const { from, to } of site.redirects ?? []) {
    const base = from.replace(/\/+$/, '') || '/';
    if (base === (to.replace(/\/+$/, '') || '/')) continue;
    for (const source of base === '/' ? ['/'] : [base, `${base}/`]) {
      if (seen.has(source)) continue;
      seen.add(source);
      out.push({ source, destination: to, statusCode: 301 });
    }
  }
  return out;
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

type JsonObject = { [key: string]: unknown };

const compact = <T extends JsonObject>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)),
  ) as T;

function postalAddress(a?: PostalAddress) {
  return a ? compact({ '@type': 'PostalAddress', ...a }) : undefined;
}

/**
 * Organization (or LocalBusiness, NGO, …) JSON-LD. `origin` is where the site
 * is being served from, so the logo resolves on previews too; `url` is always
 * the production URL.
 */
export function organizationJsonLd(site: SiteConfig, origin: string = productionOrigin(site)): JsonObject {
  const org = site.organization ?? {};
  return compact({
    '@context': 'https://schema.org',
    '@type': org.type ?? 'Organization',
    name: site.name,
    alternateName: org.alternateName,
    url: canonicalUrl(site, '/'),
    logo: org.logo ? absoluteUrl(org.logo, origin) : undefined,
    email: org.email,
    telephone: org.telephone,
    foundingDate: org.foundingDate,
    address: postalAddress(org.address),
    sameAs: org.sameAs,
    memberOf: org.memberOf?.map((m) => compact({ '@type': 'Organization', name: m.name, url: m.url })),
    areaServed: org.areaServed,
  });
}

export type EventInput = {
  name: string;
  /** Path of the event's page, e.g. '/antler-breakfast'. */
  path: string;
  description?: string;
  /** 'YYYY-MM-DD'. Without a date there is nothing to mark up, so eventJsonLd returns null. */
  date?: string;
  /** 'HH:mm', 24-hour, local to timeZone. Without it the event is marked up as all-day. */
  startTime?: string;
  endTime?: string;
  /** IANA zone, e.g. 'America/Moncton'. */
  timeZone: string;
  venue?: { name: string; address?: PostalAddress };
  /** Paths or absolute URLs. */
  images?: string[];
  ticketsUrl?: string;
  status?: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled';
};

const STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
  rescheduled: 'https://schema.org/EventRescheduled',
} as const;

/** '+00:00'-style offset of timeZone at the given local date and time. */
export function zoneOffset(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // Guess the instant as if local were UTC, then correct by the zone's offset at that instant.
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(guess))
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = name?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return match ? `${match[1]}:${match[2] ?? '00'}` : '+00:00';
}

function eventDateTime(date: string, time: string | undefined, timeZone: string): string {
  return time ? `${date}T${time}:00${zoneOffset(date, time, timeZone)}` : date;
}

/**
 * Event JSON-LD for an event page. Ticket offers are left out once the event
 * is over. Returns null when the event has no date yet.
 */
export function eventJsonLd(
  site: SiteConfig,
  event: EventInput,
  origin: string = productionOrigin(site),
  now: Date = new Date(),
): JsonObject | null {
  if (!event.date) return null;
  const startDate = eventDateTime(event.date, event.startTime, event.timeZone);
  const endDate = event.endTime ? eventDateTime(event.date, event.endTime, event.timeZone) : undefined;
  const endsAt = new Date(endDate ?? (event.startTime ? startDate : `${event.date}T23:59:59${zoneOffset(event.date, '23:59', event.timeZone)}`));
  const over = endsAt.getTime() < now.getTime();
  const status = event.status ?? 'scheduled';

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    description: event.description,
    url: canonicalUrl(site, event.path),
    startDate,
    endDate,
    eventStatus: STATUS[status],
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: event.images?.map((i) => absoluteUrl(i, origin)),
    location: event.venue
      ? compact({ '@type': 'Place', name: event.venue.name, address: postalAddress(event.venue.address) })
      : undefined,
    organizer: compact({ '@type': site.organization?.type ?? 'Organization', name: site.name, url: canonicalUrl(site, '/') }),
    offers:
      event.ticketsUrl && !over && status !== 'cancelled'
        ? { '@type': 'Offer', url: event.ticketsUrl, availability: 'https://schema.org/InStock' }
        : undefined,
  });
}

export type FaqItem = { question: string; answer: string };

/** FAQPage JSON-LD. Answers are plain text, matching what the page shows. */
export function faqJsonLd(items: FaqItem[]): JsonObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

/** JSON for a <script type="application/ld+json">, escaped so content can't close the tag. */
export function serializeJsonLd(data: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}
