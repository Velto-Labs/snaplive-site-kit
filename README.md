# @snaplive/site-kit

SEO and hosting plumbing shared by every Snaplive client site (Next.js App Router, 15.2+ or 16).
It fixes, once for all sites, what the platform SEO audit found ([Velto-Labs/snaplive#23]):

| | What the kit does |
|---|---|
| Social cards and logo | `og:image`, `twitter:image` and the JSON-LD logo use the host serving the page, so they load on previews and staging as well as production |
| Canonical tags | Every page points at its production URL |
| Previews | Any non-production host gets `X-Robots-Tag: noindex` and `<meta name="robots" content="noindex">` |
| `robots.txt` | Allows everything on production and declares the sitemap; disallows everything elsewhere |
| `sitemap.xml` | Production URLs for the pages a site lists |
| Structured data | Organization / LocalBusiness / NGO (with `sameAs`, `memberOf`, `areaServed`), `Event`, `FAQPage` |
| Redirects | A per-site map of old URLs, served as 301s |

The source lives in `Velto-Labs/snaplive` at `packages/site-kit`. Builds are published to the public
repo `Velto-Labs/snaplive-site-kit` by `scripts/release.sh`, and sites install a pinned version by URL:

```sh
npm install https://raw.githubusercontent.com/Velto-Labs/snaplive-site-kit/main/releases/snaplive-site-kit-0.1.0.tgz
```

## Setting up a site

**1. `snaplive.config.ts`** at the repo root:

```ts
import { defineSite } from '@snaplive/site-kit';

export default defineSite({
  productionUrl: 'https://example.ca',
  name: 'Example Co.',
  description: 'One or two sentences for search results and link previews.',
  locale: 'en_CA',
  defaultImage: '/images/hero.jpg', // social-card image for pages that don't set one
  organization: {
    type: 'LocalBusiness', // or 'NGO', 'HomeAndConstructionBusiness', …
    telephone: '+1-506-555-0100',
    email: 'hello@example.ca',
    logo: '/images/logo.png',
    address: { streetAddress: '1 Main St', addressLocality: 'Moncton', addressRegion: 'NB', postalCode: 'E1C 1A1', addressCountry: 'CA' },
    sameAs: ['https://www.facebook.com/example', 'https://www.google.com/maps?cid=…'],
    areaServed: 'Greater Moncton',
  },
  // Old URLs from the site this one replaced. Served as 301s.
  redirects: [{ from: '/old-page/', to: '/new-page' }],
});
```

**2. Root layout** (`src/app/layout.tsx`): replace `export const metadata` with

```tsx
import { OrganizationJsonLd, siteMetadata } from '@snaplive/site-kit/next';
import siteConfig from '../../snaplive.config';

export async function generateMetadata() {
  return siteMetadata(siteConfig);
}
// …and inside <body>: <OrganizationJsonLd site={siteConfig} />
```

**3. Every page** sets its own canonical with `pageMetadata`:

```tsx
import { pageMetadata } from '@snaplive/site-kit/next';

export async function generateMetadata() {
  return pageMetadata(siteConfig, { path: '/services', title: 'Services', description: '…' });
}
```

For the homepage use `title: { absolute: '…' }` to skip the title template.

**4. `src/app/robots.ts` and `src/app/sitemap.ts`:**

```ts
// robots.ts
import { robots } from '@snaplive/site-kit/next';
export default function robotsTxt() { return robots(siteConfig); }

// sitemap.ts
import { sitemap } from '@snaplive/site-kit/next';
export default function sitemapXml() {
  return sitemap(siteConfig, [{ path: '/' }, { path: '/services' }, { path: '/contact' }]);
}
```

**5. Noindex on previews:** `src/middleware.ts` (Next 15) or `src/proxy.ts` (Next 16):

```ts
import { previewNoindex } from '@snaplive/site-kit/next';
export const middleware = previewNoindex(siteConfig); // Next 16: export const proxy = …
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

**6. `next.config.ts`:**

```ts
import { nextRedirects } from '@snaplive/site-kit';
import siteConfig from './snaplive.config';

const nextConfig = {
  htmlLimitedBots: /.*/, // titles and descriptions in the initial <head> for every visitor
  async redirects() { return nextRedirects(siteConfig); },
  // …
};
```

**7. `Dockerfile`:** `next start` loads `next.config.ts`, which now imports `snaplive.config.ts`.
If the runtime stage copies only built output, add the config and whatever it imports:

```dockerfile
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/snaplive.config.ts ./
COPY --from=build /app/src ./src
```

Without this the container fails to start with `Cannot find module './snaplive.config'`.

**8. Optional structured data** on the pages that need it:

```tsx
import { eventJsonLd, faqJsonLd, JsonLd, requestOrigin } from '@snaplive/site-kit/next';

<JsonLd data={eventJsonLd(siteConfig, {
  name: 'Antler Breakfast', path: '/antler-breakfast', date: '2026-11-27', startTime: '06:30', endTime: '09:30',
  timeZone: 'America/Moncton', // endTime before startTime means the next day; endDate for multi-day events
  venue: { name: 'Delta Beauséjour', address: { addressLocality: 'Moncton' } },
  ticketsUrl: 'https://…',
}, await requestOrigin(siteConfig))} />

<JsonLd data={faqJsonLd([{ question: 'Where do donations go?', answer: 'Every dollar stays local…' }])} />
```

Then run the **SEO launch check** (web app → Admin → SEO check) against the live site and a preview.

## Developing

```sh
npm install
npm test        # builds, then runs test/*.test.cjs
scripts/release.sh   # publishes the current version to Velto-Labs/snaplive-site-kit
```

Bump `version` in `package.json` before releasing; published versions are never overwritten.

[Velto-Labs/snaplive#23]: https://github.com/Velto-Labs/snaplive/issues/23
