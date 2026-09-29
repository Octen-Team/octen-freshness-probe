# Octen live web freshness probe

A small CLI that measures how fresh [Octen](https://octen.ai)'s search index is on queries you choose. It asks Octen's Web Search API for pages captured in the last N minutes, then prints, for each result, when the page was published, when Octen last crawled it, and the gap between the two.

With `--watch`, it polls on an interval and reports each new URL the moment it becomes searchable, along with how long after publication that happened. That number is an upper bound on the crawl-to-searchable window for that page (the true window is shorter by up to one polling interval).

## Setup

Node 18.17 or later. Get an API key at https://octen.ai/platform/api-keys (new accounts get $5 of free balance).

```bash
git clone https://github.com/Octen-Team/octen-freshness-probe
cd octen-freshness-probe
npm install
export OCTEN_API_KEY=your-key-here
```

## Run it

```bash
# Pages matching the query that Octen captured in the last 60 minutes
npm run probe -- "node.js release"

# News results captured in the last 30 minutes
npm run probe -- "central bank rate decision" --window 30 --news

# Your own site: update a page, then watch for it
npm run probe -- "your page title" --domain yoursite.com --watch --interval 60
```

| Flag | Default | What it does |
|------|---------|--------------|
| `--window` | `60` | Look-back window in minutes, filtered on crawl time |
| `--news` | off | Sends `topic: "news"` for news-focused results |
| `--domain` | none | Restricts results to one domain |
| `--count` | `10` | Results per request (1 to 100) |
| `--watch` | off | Polls and reports new URLs as they appear |
| `--interval` | `60` | Seconds between polls in watch mode |

Each poll is one Search API call. See https://docs.octen.ai/overview/pricing for current rates.

## How to read the output

- **published→crawl** is how long Octen took to capture the page after its stated publication time.
- **crawled→now** is how old Octen's copy is at the moment you ran the probe.
- `time_published` comes from the page's own metadata, so it can be missing or wrong. Treat a negative or implausible gap as a metadata problem on that page.

## Tests

```bash
npm run typecheck
npm test   # offline: runs the CLI against a local mock of the Octen API
```

`OCTEN_API_URL` overrides the API base URL, which is how the test points the probe at the mock.

## License

MIT
