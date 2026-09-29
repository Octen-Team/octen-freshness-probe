// Octen live web freshness probe.
//
// Asks Octen for pages captured in the last N minutes that match a query,
// then prints how old each result is and how long it took to go from
// published to crawled. With --watch it polls on an interval and reports
// each new URL the moment it becomes searchable, which gives you an upper
// bound on the crawl-to-searchable window for that page.
//
// Usage:
//   npx tsx src/probe.ts "your query"
//   npx tsx src/probe.ts "your query" --window 30 --news
//   npx tsx src/probe.ts "your query" --domain example.com --watch --interval 60

export type Result = {
  title: string;
  url: string;
  time_published?: string;
  time_last_crawled?: string;
};

type SearchResponse = {
  code: number;
  msg: string;
  data?: { results: Result[] };
  meta?: { latency?: number; usage?: { num_search_queries?: number } };
};

export type Options = {
  query: string;
  windowMinutes: number;
  news: boolean;
  domain?: string;
  count: number;
  watch: boolean;
  intervalSeconds: number;
};

const API_URL = (process.env.OCTEN_API_URL ?? "https://api.octen.ai").replace(/\/$/, "");

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    query: "",
    windowMinutes: 60,
    news: false,
    count: 10,
    watch: false,
    intervalSeconds: 60,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--window") opts.windowMinutes = Number(argv[++i]);
    else if (arg === "--news") opts.news = true;
    else if (arg === "--domain") opts.domain = argv[++i];
    else if (arg === "--count") opts.count = Number(argv[++i]);
    else if (arg === "--watch") opts.watch = true;
    else if (arg === "--interval") opts.intervalSeconds = Number(argv[++i]);
    else if (!arg.startsWith("--")) opts.query = arg;
  }
  if (!opts.query) {
    throw new Error('Pass a query, for example: npx tsx src/probe.ts "latest node.js release"');
  }
  return opts;
}

export async function search(opts: Options, now: Date): Promise<SearchResponse> {
  const apiKey = process.env.OCTEN_API_KEY;
  if (!apiKey) throw new Error("Set OCTEN_API_KEY first (https://octen.ai/platform/api-keys)");

  const body: Record<string, unknown> = {
    query: opts.query,
    count: opts.count,
    // Filter on when Octen captured the page, so the window measures index freshness.
    time_basis: "crawled",
    start_time: new Date(now.getTime() - opts.windowMinutes * 60_000).toISOString(),
    end_time: now.toISOString(),
    highlight: { enable: false },
  };
  if (opts.news) body.topic = "news";
  if (opts.domain) body.include_domains = [opts.domain];

  const res = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as SearchResponse;
  if (!res.ok || json.code !== 0) {
    throw new Error(`Octen returned HTTP ${res.status}, code ${json.code}: ${json.msg}`);
  }
  return json;
}

export function minutesBetween(from?: string, to?: string | Date): number | undefined {
  if (!from || !to) return undefined;
  const a = new Date(from).getTime();
  const b = typeof to === "string" ? new Date(to).getTime() : to.getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return (b - a) / 60_000;
}

function fmt(minutes?: number): string {
  if (minutes === undefined) return "n/a";
  if (Math.abs(minutes) < 90) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function report(results: Result[], now: Date): string[] {
  const lines: string[] = [];
  const sorted = [...results].sort(
    (a, b) =>
      new Date(b.time_last_crawled ?? 0).getTime() - new Date(a.time_last_crawled ?? 0).getTime(),
  );
  for (const r of sorted) {
    lines.push(r.title);
    lines.push(`  ${r.url}`);
    lines.push(`  published        ${r.time_published ?? "n/a"}`);
    lines.push(`  last crawled     ${r.time_last_crawled ?? "n/a"}`);
    lines.push(`  published→crawl  ${fmt(minutesBetween(r.time_published, r.time_last_crawled))}`);
    lines.push(`  crawled→now      ${fmt(minutesBetween(r.time_last_crawled, now))}`);
    lines.push("");
  }
  return lines;
}

async function once(opts: Options): Promise<void> {
  const now = new Date();
  const res = await search(opts, now);
  const results = res.data?.results ?? [];
  console.log(`Query: "${opts.query}"  window: last ${opts.windowMinutes} min  at ${now.toISOString()}`);
  console.log(`${results.length} results captured in the window, latency ${res.meta?.latency ?? "n/a"} ms\n`);
  for (const line of report(results, now)) console.log(line);
}

async function watch(opts: Options): Promise<void> {
  const seen = new Set<string>();
  let first = true;
  console.log(`Watching "${opts.query}" every ${opts.intervalSeconds}s. Ctrl+C to stop.\n`);
  for (;;) {
    const now = new Date();
    const res = await search(opts, now);
    for (const r of res.data?.results ?? []) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      if (first) continue; // the first poll sets the baseline
      const sincePublished = minutesBetween(r.time_published, now);
      console.log(`[${now.toISOString()}] new: ${r.title}`);
      console.log(`  ${r.url}`);
      console.log(`  published ${r.time_published ?? "n/a"}, searchable by ${fmt(sincePublished)} after publication`);
      console.log("");
    }
    if (first) console.log(`Baseline: ${seen.size} URL(s) already in the window. Reporting new ones as they appear.\n`);
    first = false;
    await new Promise((r) => setTimeout(r, opts.intervalSeconds * 1000));
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  (opts.watch ? watch(opts) : once(opts)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
