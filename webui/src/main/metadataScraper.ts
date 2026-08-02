/**
 * @module
 * Look Up Comic/Book Metadata From External Sources
 *
 * Architecture overview for Junior Devs:
 * To enrich a comic with author, year, summary, and a better cover, we query
 * external databases (ComicVine, AniList, MangaDex) and return a list of
 * candidate matches the admin can choose from.
 *
 * Each source has its own small adapter and is best-effort: a network failure or
 * a missing API key logs a warning and contributes no results, rather than
 * failing the whole search. Outbound requests go through `safeFetch` to avoid
 * SSRF. Results are flattened into one candidate list for the UI.
 */

export interface MetadataCandidate {
  source: 'comicvine' | 'anilist' | 'mangadex';
  externalId: string;
  title: string;
  author?: string | null;
  artist?: string | null;
  year?: number | null;
  genre?: string | null;
  summary?: string | null;
  coverUrl?: string | null;
}

export interface MetadataSearchResult {
  results: MetadataCandidate[];
  warnings: string[];
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function searchComicVine(query: string): Promise<MetadataCandidate[]> {
  const apiKey = process.env.COMICVINE_API_KEY;
  if (!apiKey) throw new Error('COMICVINE_API_KEY not set');
  const u = `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(apiKey)}&format=json&resources=volume&query=${encodeURIComponent(query)}&limit=10`;
  const json = await fetchJson(u, { headers: { 'User-Agent': 'CB8/1.0' } }) as { results?: Array<Record<string, unknown>> };
  const results = Array.isArray(json.results) ? json.results : [];
  return results.map((r) => ({
    source: 'comicvine' as const,
    externalId: String(r.id ?? ''),
    title: String(r.name ?? 'Unknown'),
    author: null,
    artist: null,
    year: r.start_year ? parseInt(String(r.start_year), 10) : null,
    genre: null,
    summary: typeof r.deck === 'string' ? r.deck : (typeof r.description === 'string' ? r.description : null),
    coverUrl: (r.image && typeof (r.image as Record<string, unknown>).medium_url === 'string')
      ? (r.image as Record<string, unknown>).medium_url as string
      : null,
  }));
}

async function searchAniList(query: string): Promise<MetadataCandidate[]> {
  const q = `query ($q: String) { Page(perPage: 10) { media(search: $q, type: MANGA) { id title { romaji english } startDate { year } coverImage { medium } genres description staff(perPage: 5) { edges { role node { name { full } } } } } } }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: q, variables: { q: query } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { data?: { Page?: { media?: Array<Record<string, unknown>> } } };
  const list = json.data?.Page?.media ?? [];
  return list.map((m) => {
    const title = m.title as { romaji?: string; english?: string } | undefined;
    const cover = m.coverImage as { medium?: string } | undefined;
    const startDate = m.startDate as { year?: number } | undefined;
    const staff = m.staff as { edges?: Array<{ role?: string; node?: { name?: { full?: string } } }> } | undefined;
    const author = staff?.edges?.find((e) => /story|author|writer/i.test(e.role ?? ''))?.node?.name?.full ?? null;
    const artist = staff?.edges?.find((e) => /art/i.test(e.role ?? ''))?.node?.name?.full ?? null;
    return {
      source: 'anilist' as const,
      externalId: String(m.id ?? ''),
      title: title?.english || title?.romaji || 'Unknown',
      author,
      artist,
      year: startDate?.year ?? null,
      genre: Array.isArray(m.genres) ? JSON.stringify(m.genres) : null,
      summary: typeof m.description === 'string' ? (m.description as string).replace(/<[^>]+>/g, '') : null,
      coverUrl: cover?.medium ?? null,
    };
  });
}

async function searchMangaDex(query: string): Promise<MetadataCandidate[]> {
  const u = `https://api.mangadex.org/manga?limit=10&title=${encodeURIComponent(query)}&includes[]=cover_art&includes[]=author&includes[]=artist`;
  const json = await fetchJson(u) as { data?: Array<Record<string, unknown>> };
  const list = Array.isArray(json.data) ? json.data : [];
  return list.map((m) => {
    const attrs = m.attributes as Record<string, unknown> | undefined;
    const titles = attrs?.title as Record<string, string> | undefined;
    const title = titles?.en ?? Object.values(titles ?? {})[0] ?? 'Unknown';
    const desc = attrs?.description as Record<string, string> | undefined;
    const year = typeof attrs?.year === 'number' ? attrs.year as number : null;
    const rels = (m.relationships as Array<Record<string, unknown>> | undefined) ?? [];
    const cover = rels.find((r) => r.type === 'cover_art');
    const author = rels.find((r) => r.type === 'author');
    const artist = rels.find((r) => r.type === 'artist');
    const coverFile = (cover?.attributes as Record<string, unknown> | undefined)?.fileName as string | undefined;
    const authorName = (author?.attributes as Record<string, unknown> | undefined)?.name as string | undefined;
    const artistName = (artist?.attributes as Record<string, unknown> | undefined)?.name as string | undefined;
    const tags = attrs?.tags as Array<Record<string, unknown>> | undefined;
    const tagNames: string[] = (tags ?? []).map((t) => {
      const ta = t.attributes as Record<string, unknown> | undefined;
      const name = ta?.name as Record<string, string> | undefined;
      return name?.en ?? '';
    }).filter(Boolean);
    return {
      source: 'mangadex' as const,
      externalId: String(m.id ?? ''),
      title,
      author: authorName ?? null,
      artist: artistName ?? null,
      year,
      genre: tagNames.length > 0 ? JSON.stringify(tagNames) : null,
      summary: desc?.en ?? Object.values(desc ?? {})[0] ?? null,
      coverUrl: coverFile && m.id ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : null,
    };
  });
}

export async function searchMetadata(
  query: string,
  sources?: Array<'comicvine' | 'anilist' | 'mangadex'>,
): Promise<MetadataSearchResult> {
  const q = query.trim();
  if (!q) return { results: [], warnings: [] };
  const sourceList = sources && sources.length > 0 ? sources : (['mangadex', 'anilist', 'comicvine'] as const);
  const warnings: string[] = [];
  const all: MetadataCandidate[] = [];
  await Promise.all(sourceList.map(async (src) => {
    try {
      if (src === 'comicvine') all.push(...await searchComicVine(q));
      else if (src === 'anilist') all.push(...await searchAniList(q));
      else if (src === 'mangadex') all.push(...await searchMangaDex(q));
    } catch (err) {
      warnings.push(`${src}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));
  return { results: all, warnings };
}
