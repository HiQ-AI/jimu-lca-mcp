/**
 * Dependency-free BM25 ranking for small in-memory catalogs (e.g. the ~500
 * model templates). The 积木 open API has no server-side text search
 * (getModelList ignores `name`), so we pull the full list and rank locally.
 *
 * Tokenizer is mixed CJK + latin: CJK runs emit unigrams + adjacent bigrams
 * (so "光伏组件" matches "单晶硅光伏组件" via the 光伏 / 伏组 / 组件 bigrams),
 * latin/digit runs emit lowercased word tokens. Good enough for short product
 * names; no segmentation dependency.
 */

const CJK = /[㐀-鿿豈-﫿]/;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  const flushLatin = () => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  const chars = Array.from(text.toLowerCase());
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (CJK.test(c)) {
      flushLatin();
      tokens.push(c); // unigram
      const next = chars[i + 1];
      if (next && CJK.test(next)) tokens.push(c + next); // bigram
    } else if (/[a-z0-9]/.test(c)) {
      latin += c;
    } else {
      flushLatin();
    }
  }
  flushLatin();
  return tokens;
}

interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Rank `items` against `query` by BM25. Returns items with score > 0, sorted
 * descending, capped at `topN`. `getText` extracts the searchable string for
 * an item (concatenate name + category + whatever else should match).
 */
export function rankBm25<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  topN = 25,
  k1 = 1.5,
  b = 0.75,
): T[] {
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0) return [];

  const docTokens = items.map((it) => tokenize(getText(it)));
  const docLen = docTokens.map((t) => t.length);
  const avgdl = docLen.reduce((a, x) => a + x, 0) / (items.length || 1);

  // document frequency per query term
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let n = 0;
    for (const toks of docTokens) if (toks.includes(term)) n++;
    df.set(term, n);
  }
  const N = items.length;
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const scored: Scored<T>[] = items.map((item, i) => {
    const toks = docTokens[i]!;
    const dl = docLen[i]!;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of qTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      score += idf(term) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl));
    }
    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topN)
    .map((s) => s.item);
}
