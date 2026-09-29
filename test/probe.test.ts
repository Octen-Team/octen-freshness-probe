// Offline end-to-end test. Starts a local mock of Octen's /search endpoint,
// runs the probe CLI against it, and checks the request and the output.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { minutesBetween, parseArgs, report } from "../src/probe.ts";

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

let lastBody: any;
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastBody = JSON.parse(raw);
    assert.equal(req.url, "/search");
    assert.equal(req.headers["x-api-key"], "test-key");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          results: [
            { title: "Older page", url: "https://example.com/a", time_published: iso(50), time_last_crawled: iso(45) },
            { title: "Fresh release notes", url: "https://example.com/b", time_published: iso(7), time_last_crawled: iso(4) },
          ],
        },
        meta: { latency: 71, usage: { num_search_queries: 1 } },
      }),
    );
  });
});

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;

// Unit checks
assert.equal(minutesBetween("2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"), 5);
assert.equal(minutesBetween(undefined, new Date()), undefined);
assert.deepEqual(parseArgs(["q", "--window", "30", "--news"]).windowMinutes, 30);
const lines = report(
  [{ title: "t", url: "u", time_published: iso(10), time_last_crawled: iso(6) }],
  new Date(now),
);
assert.ok(lines.some((l) => l.includes("published→crawl  4.0 min")));

// End-to-end through the CLI, the way a reader runs it
const { stdout: out } = await promisify(execFile)("npx", ["tsx", "src/probe.ts", "node.js release", "--window", "30", "--news", "--domain", "example.com"], {
  env: { ...process.env, OCTEN_API_KEY: "test-key", OCTEN_API_URL: `http://127.0.0.1:${port}`, NO_PROXY: "127.0.0.1,localhost" },
  encoding: "utf8",
});
server.close();

assert.equal(lastBody.query, "node.js release");
assert.equal(lastBody.time_basis, "crawled");
assert.equal(lastBody.topic, "news");
assert.deepEqual(lastBody.include_domains, ["example.com"]);
const windowMs = new Date(lastBody.end_time).getTime() - new Date(lastBody.start_time).getTime();
assert.equal(windowMs, 30 * 60_000);
assert.ok(out.indexOf("Fresh release notes") < out.indexOf("Older page"), "freshest first");
assert.ok(out.includes("published→crawl  3.0 min"));
assert.ok(out.includes("latency 71 ms"));
console.log(out);
console.log("All probe tests passed.");
