# easy-otp-web

The marketing and documentation site for [Easy OTP](https://github.com/iambriansreed/easy-otp), built with [Skrapa](https://skrapa.iambrian.com) and deployed to GitHub Pages by [`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml) on every push to `main`.

## Project structure

```
src/index.html                  # shared HTML shell (head + body)
src/index.tsx                   # home page: features, usage guide, download, build from source
src/copy.ts                     # shared "copy to clipboard" helper for code blocks
src/client.ts                   # home page browser JS
src/components/github-link.tsx  # GitHub icon link (used on every page)
src/development/index.html      # per-page shell for /development
src/development/index.tsx       # /development page: setup, scripts, how it works
src/development/client.ts       # development page browser JS
src/development/style.css       # development page-specific styles
assets/                         # copied as-is to dist/ (CSS, images, favicon)
```

## Commands

```bash
npm install
npm run dev       # dev server with live reload (http://localhost:4159)
npm run build     # production build to dist/
```
