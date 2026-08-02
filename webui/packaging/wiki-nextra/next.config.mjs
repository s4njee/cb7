import nextra from 'nextra'

// Static export: `next build` emits a fully static site to ./out, which we serve
// from a plain nginx container (no Node runtime needed in production).
const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.jsx',
})

const config = {
  output: 'export',
  images: { unoptimized: true },
  // Emit /path/index.html so static hosts serve clean URLs without extra config.
  trailingSlash: true,
}

// Two deploy targets from one build:
//   • nginx container / k8s    → served at the domain root (no base path).
//   • GitHub Pages project site → served under /<repo> (e.g. /CB8), so the CI
//     workflow sets PAGES_BASE_PATH and every asset/link is prefixed to match.
// Only set basePath when non-empty — Next rejects an empty-string basePath.
if (process.env.PAGES_BASE_PATH) {
  config.basePath = process.env.PAGES_BASE_PATH
}

export default withNextra(config)
