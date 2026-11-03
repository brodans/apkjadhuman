const SEARCH_STRIP_PATTERN = /[\s\u00ad\u200b-\u200d\u2060\ufeff]+/gu;
const SEARCH_GRAPHEME_PATTERN = /\P{M}\p{M}*|\p{M}+/gu;

export interface SearchOffset {
  source: number;
  start: number;
  end: number;
}

export interface SearchIndex {
  text: string;
  map: SearchOffset[];
}

export interface SearchSegment {
  source: number;
  start: number;
  end: number;
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase('id-ID');
}

export function toSearchKey(value: string): string {
  return normalizeSearchText(value).replace(SEARCH_STRIP_PATTERN, '');
}

export function buildSearchIndex(sources: string[], withMap = true): SearchIndex {
  const textParts: string[] = [];
  const map: SearchOffset[] = [];

  sources.forEach((value, source) => {
    for (const match of value.matchAll(SEARCH_GRAPHEME_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      const key = toSearchKey(match[0]);
      if (!key) continue;

      textParts.push(key);
      if (withMap) {
        for (let index = 0; index < key.length; index += 1) {
          map.push({ source, start, end });
        }
      }
    }
  });

  return { text: textParts.join(''), map };
}

export function countSearchMatches(text: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  let at = text.indexOf(query);
  while (at >= 0) {
    count += 1;
    at = text.indexOf(query, at + query.length);
  }
  return count;
}

export function findSearchMatches(index: SearchIndex, query: string): SearchSegment[][] {
  const matches: SearchSegment[][] = [];
  if (!query) return matches;

  let at = index.text.indexOf(query);
  while (at >= 0) {
    const segments: SearchSegment[] = [];
    const last = at + query.length - 1;
    for (let position = at; position <= last; position += 1) {
      const offset = index.map[position];
      if (!offset) break;
      const tail = segments[segments.length - 1];
      if (tail && tail.source === offset.source) {
        tail.start = Math.min(tail.start, offset.start);
        tail.end = Math.max(tail.end, offset.end);
      } else {
        segments.push({ source: offset.source, start: offset.start, end: offset.end });
      }
    }

    if (segments.length) matches.push(segments);
    at = index.text.indexOf(query, at + query.length);
  }

  return matches;
}
