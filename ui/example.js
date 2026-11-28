// ============================================================
// ui/example.js — "📊 Example: results that update" (the start screen):
// a project folder with a small results file and the script that writes
// it (make_results.py, Python's standard library only), and slides that
// read it: a plot per run with a colour key, a choice of run tinting a
// box and showing its numbers. Running the script again changes the
// slides by themselves (core/plotData.js, core/variables.js follow the
// files).
// ============================================================

/** The first results, as make_results.py would write them (fixed, so the example looks the same each time). */
function firstResults() {
    const runs = { adam: [1.0, 0.25], sgd: [1.2, 0.12], ngd: [0.9, 0.35] };
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const noise = () => (rand() + rand() + rand() - 1.5) * 0.03;
    const steps = 20;
    const rows = ['run,step,loss'];
    const summary = {};
    Object.entries(runs).forEach(([name, [a, b]]) => {
        let loss = 0;
        for (let step = 1; step <= steps; step++) {
            loss = Math.max(0.001, a * Math.exp(-b * step) + 0.05 + noise());
            rows.push(`${name},${step},${loss.toFixed(4)}`);
        }
        summary[name] = { loss: Number(loss.toFixed(4)), acc: Number((1 - loss / 1.5).toFixed(3)) };
    });
    return { csv: `${rows.join('\n')}\n`, json: `${JSON.stringify({ summary, steps }, null, 2)}\n` };
}

const SCRIPT = `"""The results the slides of this project show.

Writes data/runs.csv (one row per run and step: run, step, loss) and
data/summary.json (each run's last loss and accuracy). Run it again:

    python make_results.py

and watch the slides change by themselves: the plot, the numbers, the
colours. (Only Python's standard library is needed.)
"""
import csv
import json
import math
import pathlib
import random

here = pathlib.Path(__file__).resolve().parent
data = here / "data"
data.mkdir(exist_ok=True)

runs = {"adam": (1.0, 0.25), "sgd": (1.2, 0.12), "ngd": (0.9, 0.35)}
steps = random.randint(15, 30)
rows, summary = [], {}
for name, (a, b) in runs.items():
    b *= random.uniform(0.7, 1.3)
    loss = 0.0
    for step in range(1, steps + 1):
        loss = max(0.001, a * math.exp(-b * step) + 0.05 + random.gauss(0, 0.02))
        rows.append([name, step, round(loss, 4)])
    summary[name] = {"loss": round(loss, 4), "acc": round(1 - loss / 1.5, 3)}

with open(data / "runs.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["run", "step", "loss"])
    writer.writerows(rows)
with open(data / "summary.json", "w") as f:
    json.dump({"summary": summary, "steps": steps}, f, indent=2)
print(f"{steps} steps written to data/runs.csv and data/summary.json")
`;

export const EXAMPLE_GL = String.raw`# Results that update — a GluonSlides example
.project {Results that update} version:2 width:1920 height:1080 grid:20 nextid:100
.vars {data/summary.json} sync:yes
.style.text {title} fontSize:64 fontColor:@primary textAlign:left verticalAlign:center
.style.text {hint} fontSize:30 fontColor:@muted textAlign:left verticalAlign:top

.slide {Results that update} id:10
.element.text id:11 style:title x:100 y:60 width:1700 height:120
	Results that update
.element.text id:12 style:hint x:100 y:220 width:1700 height:700 fontSize:36
	The next slides read **data/runs.csv** and **data/summary.json**, which the script **make_results.py** (in this project's folder) writes.

	Run it again (${'`'}python make_results.py${'`'} in this folder, or from your editor) and watch the slides change by themselves: the plot, the numbers, the colours.

	🗂 **Project files** in the sidebar shows these files and what uses each.

	Try it the other way too: drop a CSV of yours on a slide.

.slide {Loss per run} id:20
.element.text id:21 style:title x:100 y:40 width:1700 height:120
	Loss per run (\var{steps} steps)
.element.plot id:22 x:80 y:170 width:1300 height:820 lang:python xlabel:step ylabel:loss legend:no fontSize:28
	.line data:{data/runs.csv} x:step y:loss group:run colors:runcol show:"=runcol.shown" width:4
.element.colorkey id:23 var:runcol source:data/runs.csv use:column:run label:Runs x:1440 y:200 width:400 height:220 fontSize:34
.element.text id:24 style:hint x:1440 y:470 width:420 height:500
	**A colour key**: each run its colour, the same in every plot that says ${'`'}colors:runcol${'`'}.

	Click it once, then click a run to hide it (while presenting too).

.slide {Pick a run} id:30
.element.text id:31 style:title x:100 y:40 width:1700 height:120
	Pick a run
.element.choice id:32 var:pick source:data/runs.csv use:column:run value:adam label:Run x:100 y:200 width:620 height:80 fontSize:34
.element.shape id:33 bg:"=runcol[pick]" x:100 y:330 width:620 height:330
.element.text id:34 x:120 y:350 width:580 height:290 fontSize:40 fontColor:#ffffff textAlign:center verticalAlign:center
	**\var{pick}**

	loss \var{summary[pick].loss}[%.3f]

	accuracy \var{summary[pick].acc}[%.1%]
.element.text id:35 style:hint x:100 y:700 width:620 height:300 fontSize:26
	The box takes the run's colour (${'`'}=runcol[pick]${'`'}), the numbers come from data/summary.json (${'`'}\var{summary[pick].acc}${'`'}), the plot shows only the run picked (${'`'}show:"=pick"${'`'}).
.element.plot id:36 x:780 y:200 width:1060 height:780 lang:python xlabel:step ylabel:loss legend:no fontSize:28
	.line data:{data/runs.csv} x:step y:loss group:run colors:runcol show:"=pick" width:5
`;

/** The example's files: { 'project.gl', 'data/runs.csv', 'data/summary.json', 'make_results.py' }. */
export function exampleFiles() {
    const { csv, json } = firstResults();
    return { 'project.gl': EXAMPLE_GL, 'data/runs.csv': csv, 'data/summary.json': json, 'make_results.py': SCRIPT, 'bibliography.bib': '' };
}
