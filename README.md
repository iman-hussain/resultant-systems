# Resultant Systems

One-page landing site for [Resultant Systems Limited](https://www.resultantsystems.com) — AI, Data and Tech consulting.

## Stack

Static HTML / CSS / JS. No build step. Hosted on GitHub Pages.

## Local preview

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

Published from the `main` branch root via GitHub Pages.

### Custom domain DNS

Point your domain at GitHub Pages:

| Type  | Host | Value                     |
|-------|------|---------------------------|
| CNAME | www  | `iman-hussain.github.io`  |

For the apex (`resultantsystems.com`), add an ALIAS/ANAME to `iman-hussain.github.io`, or redirect apex → `www`.

After DNS propagates, GitHub will issue HTTPS for `www.resultantsystems.com`.

## SEO

- [`robots.txt`](robots.txt) — allows crawling; points at the sitemap
- [`sitemap.xml`](sitemap.xml) — homepage
- JSON-LD on the homepage (Organization, WebSite, ProfessionalService) with `sameAs` links to personal site, LinkedIn, and GitHub

Submit `https://resultantsystems.com/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) for faster discovery.

## Company

- Company number: 17364920
- Founder: Iman Hussain
