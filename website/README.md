# Diff Branch website

The product website for Diff Branch, built with React and Vite.

## Local development

Requires Node.js 22.12 or later.

```bash
npm install
npm run dev
```

Run `npm test` to type-check and build the site.

## Deploy to Oddiss hosting

Run `npm ci` followed by `npm run build`. Upload the contents of `dist/` to the site's web root on the existing Oddiss hosting. The output is a static site; it does not need Node.js on the server.

The current build assumes a dedicated domain or subdomain served at `/`. If hosting under a subdirectory, configure Vite's base path and asset URLs before deploying.

Keep `index.html`, `assets/`, `diff-branch.svg`, and `og.png` together. Serve HTML with revalidation so new builds take effect; the hashed files under `assets/` can use long-lived caching.

Publish the GitHub release before deploying the website so the download button points to the stable release. After upload, check the homepage, favicon, download and documentation links, and the Powered by Oddiss footer link.
