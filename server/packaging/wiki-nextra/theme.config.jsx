export default {
  logo: (
    <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>
      CB<span style={{ color: '#EF4D4D' }}>8</span>&nbsp;Docs
    </span>
  ),
  project: {
    link: 'https://github.com/s4njee/CB8',
  },
  docsRepositoryBase: 'https://github.com/s4njee/CB8',
  footer: {
    content: 'CB8 — self-hosted comic & e-book reader.',
  },
  search: {
    placeholder: 'Search the docs…',
  },
  // A self-hosted docs site for a single project: keep the chrome simple.
  darkMode: true,
  nextThemes: { defaultTheme: 'dark' },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="CB8 self-hosted comic & e-book reader — documentation." />
      <title>CB8 Docs</title>
    </>
  ),
}
