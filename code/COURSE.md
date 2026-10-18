# Python: Zero to Hero — course format

60 days, 6 phases of 10 days. One JSON file per day: `code/days/dNN.json` (`d01.json` … `d60.json`).
`node scripts/code-check.mjs` validates every file (shape, voice text, and it **runs every
snippet in real CPython** through `code/assets/harness.py`) and writes `code/days/index.json`.
Nothing ships unless it passes.

## Phases
| Phase | Days | Name | Focus |
|---|---|---|---|
| 1 | 1–10 | Launch | Foundations: print, variables, numbers, strings, input, conditions, loops |
| 2 | 11–20 | Ascent | Lists, tuples, dicts, sets, comprehensions, functions, scope, exceptions |
| 3 | 21–30 | Orbit | Modules, files, CSV/JSON, OOP, iterators, generators, functional tools, decorators |
| 4 | 31–40 | Deep space | Standard library, dates, regex, typing, dataclasses, testing, debugging, quality, packaging |
| 5 | 41–50 | Developer | Big-O, algorithms, data structures, data work, HTTP/APIs, databases (sqlite3), async |
| 6 | 51–60 | Pro | Automation, scraping, data science taste, design patterns, architecture, performance, security, capstone, career |

Days 10, 20, 30, 40, 50 end with a phase project. Days 58–59 are the capstone; 60 is graduation.

## Day file
```json
{
  "day": 7,
  "phase": 1,
  "title": "Decisions with if",
  "subtitle": "Teach your program to choose",
  "minutes": 50,
  "goal": "One sentence: what the learner can do after today.",
  "outcomes": ["3–5 short, concrete can-do statements"],
  "slides": [ ...14–22 slides... ]
}
```

A day is a **guided build**, not a lecture. Every 2–3 explanation slides are followed by
something the learner does (predict, run, fix, write). It always contains:
- `intro` first and `recap` last;
- at least **4** runnable `code` slides, **2** `quiz`/`predict` slides and **2** `exercise`/`bug` slides
  (project days: one `project` slide plus at least 2 more exercises);
- at least **3** slides with a `visual` (animations make the idea visible);
- real-world, developer-focused examples (apps, data, files, APIs, games, automation), with Indian
  context sometimes (rupees, cricket, trains, UPI, chai), never cheesy.

## Slide types
Every slide has `type`, `title` and `say`.

`say` is the narration a studio voice records once and every learner hears: warm, clear,
spoken English, like a great teacher sitting next to you. 1–4 sentences, **at most 420 characters**.
Say code aloud the way people speak it ("print, open bracket…" is wrong; "we call print with the text Hello" is right).
No markdown, emoji or symbols that sound odd when read aloud.

`body`/`task`/`why` text supports a tiny markup: `**bold**`, `` `code` ``, line breaks, and
lines starting with `- ` become bullets. Keep screens short: at most ~60 words of body.

| type | fields | notes |
|---|---|---|
| `intro` | `body`, optional `visual` | The mission briefing: why today matters for a developer. |
| `concept` | `body`, optional `visual` | One idea per slide. |
| `visual` | `visual`, optional `body` | A slide that is mostly animation. |
| `code` | `code`, `expect`, optional `body`, `stdin`, `files`, `needs`, `explain`, `trace` | Runnable example. `expect` = exact stdout (the validator checks it). Use `"expect": null` only when output is random/time-based. `explain`: `[[line, "what this line does"], …]` shown one by one. `trace: true` adds "Watch it run" (step-by-step animation of variables); default true when the code is ≤ 25 lines. |
| `predict` | `code`, `options`, `answer`, `why` | "What will this print?" Options are outputs; `answer` is the index of the option equal to the real output (validator checks). |
| `quiz` | `q`, `options` (2–4), `answer` (index), `why`, optional `code` | Concept check. |
| `exercise` | `task`, `starter`, `solution`, `tests`, `hints` (1–3), optional `stdin`, `files`, `needs` | Learner writes code. Validator: `solution` passes, `starter` fails. |
| `bug` | same as exercise | "Fix the bug": `starter` is broken code. |
| `project` | `brief`, `steps` (3–7 strings), `starter`, `solution`, `tests`, `hints`, optional `stdin`, `files` | Bigger build that uses the whole phase. |
| `recap` | `points` (3–6 strings) | What we learned; the last slide. |

### Exercise tests
`tests` is Python that runs after the learner's code, in the same namespace (so it can call their
functions and read their variables). Failing `assert`s show their message to the learner, so write
messages like a mentor: `assert total == 15, "total should be 15 for [1, 2, 3, 4, 5] — did you add every item?"`.
Available names: `__out__` (everything printed), `out_lines` (printed lines, stripped right),
`norm(s)` (trim spaces at line ends), `__code__` (their source), `__tree__` (its `ast`),
`await run_program("input lines\n")` (runs their program again with other input; returns output).
Check behaviour, not exact formatting, unless formatting is the lesson. Test 2–4 cases including an edge case.

### Visuals (`visual.kind`)
| kind | shape |
|---|---|
| `boxes` | `{"kind":"boxes","vars":[["name","'Riya'","str"],["age","21","int"]]}` variables as labelled boxes |
| `memory` | `{"kind":"memory","names":["a","b"],"objects":[{"id":"o1","r":"[1, 2, 3]","t":"list"}],"links":[["a","o1"],["b","o1"]]}` names pointing at objects |
| `list` | `{"kind":"list","name":"nums","items":["3","1","4"],"mark":[0],"slice":[1,3],"neg":true}` indexed cells |
| `dict` | `{"kind":"dict","name":"user","pairs":[["'name'","'Riya'"],["'age'","21"]]}` |
| `flow` | `{"kind":"flow","nodes":[{"t":"Start","s":"pill"},{"t":"age >= 18?","s":"diamond","yes":"Adult","no":"Minor"},{"t":"print(result)"}]}` flowchart top to bottom |
| `stack` | `{"kind":"stack","frames":[{"name":"main","vars":[["x","5"]]},{"name":"square(n=5)","vars":[["n","5"]],"ret":"25"}]}` call stack |
| `terminal` | `{"kind":"terminal","lines":[["$","python hello.py"],["","Hello, world!"]]}` typed shell session |
| `compare` | `{"kind":"compare","left":{"title":"Before","code":"..."},"right":{"title":"After","code":"..."},"verdict":"why right is better"}` |
| `steps` | `{"kind":"steps","items":["Write code","Python reads it","It runs"]}` numbered pipeline |
| `table` | `{"kind":"table","head":["Operator","Meaning","Example"],"rows":[["+","add","2 + 3 → 5"]]}` |
| `tree` | `{"kind":"tree","root":{"t":"fib(3)","c":[{"t":"fib(2)","c":[{"t":"fib(1)"},{"t":"fib(0)"}]},{"t":"fib(1)"}]}}` |
| `chart` | `{"kind":"chart","title":"Steps for n = 1,000","bars":[["O(1)",1],["O(log n)",10],["O(n)",1000]]}` |

### Running code in the course
Real CPython 3.13 (Pyodide) runs on the learner's phone. The standard library works except
`sqlite3`, `ssl`, `lzma`, which load from the internet: list them in `needs` (e.g. `"needs":["sqlite3"]`).
No network access from code (`requests`, sockets): teach HTTP with realistic sample data instead.
`input()` reads lines from `stdin`. `files` creates files next to main.py (CSV, JSON, a `helpers.py` module…).
Top-level `await` and `asyncio.run()` work. `time.sleep` works but keep it under a second.
Output must be deterministic for `expect` (seed `random`, avoid printing times) unless `expect` is null.
`hashlib`/`hmac`/`secrets` need the OpenSSL build: put `"needs": ["hashlib"]` on every slide of a day that imports them. `zoneinfo` needs `"needs": ["tzdata"]`.
Python stays warm between runs, but each run starts with fresh modules from `files` and a fresh root logger (`logging.basicConfig` works every time).
Quiz `q`, options, `why`, hints and bodies all support the inline markup; anything inside backticks is shown literally.
