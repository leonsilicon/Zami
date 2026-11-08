// The run's report: an HTML page beside the screenshots, one section per view.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewResult, Verdict } from "#baseline";

export interface ReportData {
  commit: string;
  results: ViewResult[];
  verdicts: Verdict[];
  /** Every translated component, for coverage. */
  components: string[];
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STYLE = `
:root { --bg: #f6f6f7; --fg: #1d1d20; --muted: #5c5e66; --card: #fff; --line: #dcdde0;
  --match: #1f7a44; --known: #8a6100; --bad: #b42318; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #17181b; --fg: #e6e6e9; --muted: #9a9ca5;
  --card: #202226; --line: #33363c; --match: #4cc38a; --known: #f0b429; --bad: #ff6b5f; } }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 system-ui, -apple-system, sans-serif; }
main { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 0; }
.muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin: 16px 0 32px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td.num { font-variant-numeric: tabular-nums; text-align: right; }
.status { font-weight: 600; } .match, .improved { color: var(--match); }
.known { color: var(--known); } .regressed, .new, .error { color: var(--bad); }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 16px; margin: 0 0 20px; }
.head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
figure { margin: 0; } figcaption { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
ul { margin: 8px 0 0; padding-left: 20px; } li { margin: 2px 0; }
code { font-size: 12px; }
@media (max-width: 640px) { .shots { grid-template-columns: 1fr; } }
`;

export function writeReport(runDir: string, data: ReportData): string {
  const verdictOf = new Map(data.verdicts.map((verdict) => [verdict.name, verdict]));
  const mounted = new Set(data.results.flatMap((result) => result.components));
  const covered = data.components.filter((name) => mounted.has(name));
  const uncovered = data.components.filter((name) => !mounted.has(name));
  const counts = new Map<string, number>();
  for (const verdict of data.verdicts)
    counts.set(verdict.status, (counts.get(verdict.status) ?? 0) + 1);

  const rows = data.results
    .map((result) => {
      const verdict = verdictOf.get(result.name);
      return `<tr><td><a href="#${escape(result.name)}">${escape(result.name)}</a></td>
<td class="status ${verdict?.status ?? ""}">${verdict?.status ?? ""}</td>
<td class="num">${(result.pixels * 100).toFixed(2)}%</td>
<td class="num">${result.issues.length}</td>
<td class="num">${verdict?.added.length ?? 0}</td>
<td class="num">${result.seconds}s</td></tr>`;
    })
    .join("\n");

  const sections = data.results
    .map((result) => {
      const verdict = verdictOf.get(result.name);
      const errors = Object.entries(result.errors)
        .map(
          ([side, error]) =>
            `<li><strong>${side}</strong>: <code>${escape(error.split("\n")[0] ?? "")}</code></li>`,
        )
        .join("");
      const added = new Set(verdict?.added ?? []);
      const issues = result.issues
        .map(
          (issue) =>
            `<li>${added.has(issue.id) ? "<strong>new</strong> " : ""}${escape(issue.message)}</li>`,
        )
        .join("");
      const name = encodeURIComponent(result.name);
      return `<section id="${escape(result.name)}">
<div class="head"><h2>${escape(result.name)}</h2>
<span class="status ${verdict?.status ?? ""}">${verdict?.status ?? ""}</span>
<span class="muted">${(result.pixels * 100).toFixed(2)}% of pixels differ · ${result.issues.length} issue(s)</span></div>
${errors === "" ? "" : `<ul>${errors}</ul>`}
<div class="shots">
<figure><figcaption>Zam (reference)</figcaption><img loading="lazy" src="${name}/zam.png" alt="Zam"></figure>
<figure><figcaption>Zami</figcaption><img loading="lazy" src="${name}/zami.png" alt="Zami"></figure>
<figure><figcaption>Differences (safe area)</figcaption><img loading="lazy" src="${name}/diff.png" alt="Differences"></figure>
</div>
${issues === "" ? "" : `<details${result.issues.length <= 12 ? " open" : ""}><summary>${result.issues.length} issue(s)</summary><ul>${issues}</ul></details>`}
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zami parity</title><style>${STYLE}</style></head>
<body><main>
<h1>Zami parity with Zam</h1>
<p class="muted">Upstream ${escape(data.commit.slice(0, 12))} · ${data.results.length} views · ${[
    ...counts,
  ]
    .map(([status, count]) => `${count} ${status}`)
    .join(", ")} · components covered: ${covered.length}/${data.components.length}</p>
<table><thead><tr><th>View</th><th>Status</th><th>Pixels</th><th>Issues</th><th>New</th><th>Time</th></tr></thead>
<tbody>${rows}</tbody></table>
${sections}
<section><h2>Components no view shows (${uncovered.length})</h2>
<p class="muted">${uncovered.map((name) => `<code>${escape(name)}</code>`).join(" ")}</p></section>
</main></body></html>
`;
  const path = join(runDir, "report.html");
  writeFileSync(path, html);
  return path;
}
