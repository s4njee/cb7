import { get } from './client';

/** One passage hit from inside a book. */
export interface SearchHit {
  comicId: number;
  book: string;
  chapter: string | null;
  snippet: string;
  via: 'both' | 'keyword' | 'semantic';
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
}

/** Hybrid (keyword + semantic) search inside the text of e-books. */
export const searchInside = (q: string): Promise<SearchResponse> =>
  get<SearchResponse>('/api/search', { query: { q } });
