/**
 * Request-aware helpers for Next.js App Router sites (Next 15.2+ and 16).
 *
 * The site is served from more than one host: the custom domain, Coolify's
 * staging address and a preview per pull request. Absolute URLs that must load
 * (social-card images, the logo) are built from the host actually serving the
 * request; canonical URLs always point at production; every non-production
 * host is marked noindex.
 */
import type { Metadata, MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  absoluteUrl,
  canonicalUrl,
  isProductionHost,
  organizationJsonLd,
  productionOrigin,
  serializeJsonLd,
  type SiteConfig,
} from './index';

export * from './index';

const NOINDEX = 'noindex, nofollow';
const HOST_RE = /^[a-z0-9.-]+(:\d+)?$/i;

function hostFrom(h: Headers): string | null {
  // Prefer Host: the proxy routes on it, so a client can't point it elsewhere and still reach
  // this site. X-Forwarded-Host is only a fallback, and its last entry is the one the nearest
  // proxy added (earlier entries can come from the client).
  const host = h.get('host')?.trim() || h.get('x-forwarded-host')?.split(',').pop()?.trim();
  return host && HOST_RE.test(host) ? host : null;
}

function originFrom(h: Headers, site: SiteConfig): string {
  const host = hostFrom(h);
  if (!host) return productionOrigin(site);
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() || (local ? 'http' : 'https');
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

/** The origin serving the current request, e.g. 'https://12.example.ca'. Falls back to production. */
export async function requestOrigin(site: SiteConfig): Promise<string> {
  return originFrom(await headers(), site);
}

/** Whether the current request is on a production host. */
export async function isProductionRequest(site: SiteConfig): Promise<boolean> {
  return isProductionHost(site, hostFrom(await headers()));
}

type PageInput = {
  /** This page's path, e.g. '/' or '/antler-breakfast'. Used for the canonical URL. */
  path: string;
  title?: string | Metadata['title'];
  description?: string;
  /** Social-card image for this page: a path on the site or an absolute URL. Defaults to site.defaultImage. */
  image?: string;
};

/**
 * Metadata for a page: canonical URL (production), Open Graph and Twitter
 * cards whose images resolve on whichever host serves the page, and noindex
 * on non-production hosts. Use from `generateMetadata`.
 *
 * Next.js replaces (rather than merges) openGraph between layout and page, so
 * this always returns the full set.
 */
export async function pageMetadata(site: SiteConfig, page: PageInput): Promise<Metadata> {
  const h = await headers();
  const origin = originFrom(h, site);
  const production = isProductionHost(site, hostFrom(h));
  const image = page.image ?? site.defaultImage;
  const ogTitle =
    typeof page.title === 'string'
      ? `${page.title} | ${site.name}`
      : page.title && typeof page.title === 'object' && 'absolute' in page.title && page.title.absolute
        ? page.title.absolute
        : site.name;
  const description = page.description ?? site.description;

  return {
    metadataBase: new URL(origin),
    ...(page.title !== undefined && { title: page.title }),
    ...(description !== undefined && { description }),
    alternates: { canonical: canonicalUrl(site, page.path) },
    openGraph: {
      type: 'website',
      siteName: site.name,
      url: canonicalUrl(site, page.path),
      title: ogTitle,
      ...(description !== undefined && { description }),
      ...(site.locale && { locale: site.locale }),
      ...(image && { images: [absoluteUrl(image, origin)] }),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: ogTitle,
      ...(description !== undefined && { description }),
      ...(image && { images: [absoluteUrl(image, origin)] }),
    },
    ...(!production && { robots: { index: false, follow: false } }),
  };
}

/**
 * Site-wide defaults for the root layout's `generateMetadata`: metadataBase on
 * the serving host and a title template. Pages add their own canonical with
 * pageMetadata().
 */
export async function siteMetadata(site: SiteConfig, extra: Metadata = {}): Promise<Metadata> {
  const base = await pageMetadata(site, { path: '/' });
  // The layout must not set a canonical: every page would inherit the homepage's.
  const { alternates: _omit, ...rest } = base;
  return {
    ...rest,
    title: { default: site.name, template: `%s | ${site.name}` },
    ...extra,
  };
}

/** For src/app/robots.ts: allow all and declare the sitemap on production; disallow everything elsewhere. */
export async function robots(site: SiteConfig): Promise<MetadataRoute.Robots> {
  if (!(await isProductionRequest(site))) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: canonicalUrl(site, '/sitemap.xml'),
  };
}

export type SitemapEntry = {
  path: string;
  lastModified?: string | Date;
  changeFrequency?: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority?: number;
};

/** For src/app/sitemap.ts: entries as canonical production URLs. */
export function sitemap(site: SiteConfig, entries: SitemapEntry[]): MetadataRoute.Sitemap {
  return entries.map((e) => ({
    url: canonicalUrl(site, e.path),
    ...(e.lastModified && { lastModified: e.lastModified }),
    ...(e.changeFrequency && { changeFrequency: e.changeFrequency }),
    ...(e.priority !== undefined && { priority: e.priority }),
  }));
}

/**
 * Middleware (Next 15 `middleware.ts`) or proxy (Next 16 `proxy.ts`) handler:
 * adds `X-Robots-Tag: noindex` on every non-production host, so previews and
 * staging addresses never get indexed as duplicates of the real site.
 */
export function previewNoindex(site: SiteConfig) {
  return function handler(request: NextRequest) {
    const response = NextResponse.next();
    if (!isProductionHost(site, hostFrom(request.headers))) response.headers.set('X-Robots-Tag', NOINDEX);
    return response;
  };
}

/** Renders JSON-LD. Pass one object or several. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

/** The site's organization JSON-LD, with the logo on the serving host. For the root layout. */
export async function OrganizationJsonLd({ site }: { site: SiteConfig }) {
  return <JsonLd data={organizationJsonLd(site, await requestOrigin(site))} />;
}
