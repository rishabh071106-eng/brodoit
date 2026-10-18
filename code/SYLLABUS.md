# Python: Zero to Hero — the 60-day syllabus

Rule: a day may only use what earlier days taught (peek-aheads are fine as "you'll master this on Day N").
Every day is developer-focused: real programs, real data, habits professionals use.

## Phase 1 · Launch — Foundations (Days 1–10)
1. **Hello, Python** — what a program is, the interpreter, print(), text vs numbers, sep/end, comments, reading errors. *(written; the template for every other day)*
2. **Variables: names for values** — assignment (`=` is not equality), names as labels (memory visual), reassignment, naming rules + snake_case, multiple assignment, swapping `a, b = b, a`, `type()`. Examples: UPI wallet balance, cricket run rate. Bug: NameError from a typo.
3. **Numbers and maths** — int vs float, `+ - * / // % **`, precedence (PEMDAS) with a table visual, `round()`, `abs()`, `min()/max()`, float precision (`0.1 + 0.2`), `import math` (`sqrt`, `ceil`, `floor`, `pi`). Examples: EMI-style split, minutes→hours:minutes with `//` and `%`, BMI.
4. **Strings I** — quotes, escapes (`\n`, `\t`, `\"`), multi-line strings, `+` and `*`, `len()`, indexing and negative indexing (list visual of characters), slicing `[a:b:c]`, immutability. Examples: PNR codes, initials, reversing a word.
5. **Strings II and f-strings** — methods: `upper/lower/title/strip/replace/split/join/find/startswith/endswith/count/isdigit`, method chaining, f-strings with expressions and format specs (`:.2f`, `:,`, `:>10`, `:^`). Examples: cleaning user input, a formatted receipt with ₹ amounts.
6. **Input and type conversion** — `input()` always returns str, `int()/float()/str()/bool()`, ValueError on bad input, building interactive programs (stdin), simple validation with `isdigit`. Examples: age calculator, unit converter, tip splitter.
7. **Decisions with if** — booleans, comparison operators, `and/or/not`, truthiness, `if/elif/else`, nested if, conditional expression, flow visuals. Examples: ticket pricing by age, grade calculator, login check.
8. **Loops I: while** — while loops, counters, sentinel loops, `break`, `continue`, avoiding infinite loops (the runner stops them), input validation loops. Examples: countdown, PIN attempts, savings goal simulator.
9. **Loops II: for and range** — `for` over strings and ranges, `range(start, stop, step)`, accumulator pattern, counting pattern, nested loops (multiplication table, patterns), `for…else`. Examples: total of marks, star patterns, FizzBuzz.
10. **Project: Command-line games** — review quiz across Days 1–9; **project**: number-guessing game with attempts, hints and replay (seeded `random`, input via stdin) plus a smaller tip-calculator exercise. Explain how to design a program before coding it.

## Phase 2 · Ascent — Data and functions (Days 11–20)
11. **Lists I** — creating, indexing, slicing, mutating, `append/insert/remove/pop/extend`, `len`, `in`, iterating, `sum/min/max`. Examples: playlist, shopping cart, daily steps.
12. **Lists II** — `sort()` vs `sorted()`, `key=` and `reverse=`, searching, copying vs aliasing (memory visual!), shallow copy, nested lists (grids, seat maps), `enumerate`. Bug: aliasing surprise.
13. **Tuples and unpacking** — immutability, packing/unpacking, star-unpacking, returning multiple values (peek), `zip`, tuples as records, when to use tuple vs list.
14. **Dictionaries I** — key/value, lookup, `get` with default, add/update/delete, `in`, iterating `keys/values/items`, counting pattern (word frequency). Examples: phone book, menu prices.
15. **Dictionaries II and sets** — nested data (JSON-shaped records: list of dicts), `setdefault`, sorting dicts by value, sets: dedupe, membership, union/intersection/difference. Examples: student records, common friends, unique visitors.
16. **Comprehensions** — list/dict/set comprehensions, filtering with `if`, transforming, nested comprehension (with care), readability rules (when a loop is better). Examples: clean data, price after GST, squares.
17. **Functions I** — why functions (DRY), `def`, parameters vs arguments, `return` vs print, `None`, docstrings, calling functions from functions, stack visual. Examples: `gst(amount)`, `is_even(n)`, `format_rupees(x)`.
18. **Functions II** — default and keyword arguments, `*args/**kwargs`, scope (LEGB) with boxes visual, avoid globals, pure functions, mutable default argument trap (bug slide). Examples: `make_greeting`, `average(*nums)`.
19. **Errors and exceptions** — reading tracebacks deeper, `try/except/else/finally`, catching specific exceptions, `raise`, custom error messages, EAFP vs LBYL, input validation that never crashes. Examples: safe division, robust number input.
20. **Project: Expense tracker CLI** — review quiz; **project**: menu-driven expense tracker (add, list, total by category, delete) using functions, list of dicts and exception handling, driven by stdin commands; plus an exercise on validating amounts.

## Phase 3 · Orbit — Programs that scale (Days 21–30)
21. **Modules and imports** — `import x`, `from x import y`, `as`, standard library tour (`math`, `random` with seed, `datetime` peek, `os`), writing your own module with `files: {"helpers.py": …}`, `if __name__ == "__main__":`, packages idea.
22. **Files I** — `open` modes, `with`, `read/readline/readlines`, writing and appending, iterating lines, `pathlib.Path` (`exists`, `read_text`, `write_text`, `glob`), encodings (utf-8). Examples: log file analysis, notes app.
23. **Files II: CSV and JSON** — `csv.reader/DictReader/DictWriter`, `json.load/dump/loads/dumps`, `indent=`, converting between them. Examples: marks.csv report, settings.json, saving and loading app state.
24. **OOP I: classes and objects** — why OOP, `class`, `__init__`, attributes, methods, `self`, instances vs class, memory visual of two objects. Examples: `BankAccount` with deposit/withdraw, `Player`.
25. **OOP II: making classes Pythonic** — class vs instance attributes, `@property` with validation, `__str__/__repr__`, `__eq__`, `__lt__` (sorting objects), `__len__`, `@classmethod` factories, `@staticmethod`.
26. **OOP III: inheritance and composition** — inheritance, `super()`, overriding, polymorphism, composition ("has-a") vs inheritance ("is-a"), abstract base classes (`abc`). Examples: `Vehicle → Car/Bike`, payment methods (UPI, Card).
27. **Iterators and generators** — iteration protocol (`iter/next`, StopIteration), writing `__iter__`, `yield`, generator expressions, lazy pipelines, memory benefit, infinite generators with `itertools.islice`. Examples: reading big logs lazily, Fibonacci.
28. **Functional tools** — functions as values, `lambda`, `map/filter`, `sorted(key=…)`, `any/all`, `zip`, `functools.reduce/partial/lru_cache`, closures. Examples: leaderboard sorting, memoised Fibonacci with timing.
29. **Decorators and context managers** — closures recap, writing a decorator, `functools.wraps`, decorators with arguments (retry, timer, logger), `with` protocol (`__enter__/__exit__`), `contextlib.contextmanager`.
30. **Project: Library management system** — review quiz; **project**: OOP library (Book, Member, Library classes) with borrow/return rules, persistence to JSON file, and a report; exercises on a custom exception and a `__str__`.

## Phase 4 · Deep space — Professional Python (Days 31–40)
31. **The standard library's power tools** — `collections` (`Counter`, `defaultdict`, `deque`, `namedtuple`, `OrderedDict` note), `itertools` (`chain`, `groupby`, `combinations`, `permutations`, `product`, `accumulate`). Examples: top words, sliding window with deque.
32. **Dates and times** — `datetime/date/time/timedelta`, `strftime/strptime`, ISO 8601, `zoneinfo` (Asia/Kolkata vs UTC), age and countdown calculations, timestamps. Use fixed dates in examples so output is deterministic.
33. **Regular expressions** — `re.search/match/findall/finditer/sub/split`, character classes, quantifiers, groups and named groups, flags, validating Indian mobile numbers/PIN codes/emails, when NOT to use regex.
34. **Type hints, dataclasses and enums** — annotations, `list[int]`, `dict[str, float]`, `Optional`/`|`, `Callable`, why type checkers (mypy/pyright) matter, `@dataclass` (defaults, `field`, `frozen`, `order`), `enum.Enum`. Examples: typed `Order` model.
35. **Testing I** — why tests, `assert`, `unittest.TestCase`, `setUp`, assertion methods, running tests (`unittest.main(argv=['x'], exit=False)`), Arrange-Act-Assert, testing edge cases. Exercise: write tests that catch a bug.
36. **Testing II: test-driven development** — TDD loop (red, green, refactor), pytest-style plain test functions and a tiny runner, fixtures idea, `unittest.mock` (`Mock`, `patch`) to fake time/random/network, coverage idea, doctest.
37. **Debugging and logging** — systematic debugging (reproduce, isolate, fix, test), reading tracebacks in nested calls, `print` debugging vs `logging` (levels, format, `basicConfig(stream=sys.stdout)` so output shows), `breakpoint`/pdb concept, rubber-duck debugging. Bug slides galore.
38. **Clean code** — PEP 8, naming, functions that do one thing, magic numbers → constants, guard clauses, refactoring a messy script step by step (compare visuals), `import this` (Zen of Python), linters/formatters (ruff, black) explained.
39. **Environments and packages** — how pip and PyPI work, `venv`, `requirements.txt`, `pyproject.toml`, project layout (`src/`, `tests/`), git basics for Python projects; terminal visuals of real commands; `importlib.metadata`; why pinned versions matter. Runnable code: parsing a requirements file, version comparison.
40. **Project: Bank system with tests** — review quiz; **project**: `Account`/`Bank` with deposit, withdraw, transfer, interest, transaction history (dataclasses, custom exceptions, logging) plus a `unittest` suite the learner extends.

## Phase 5 · Developer — Algorithms, data and the web (Days 41–50)
41. **Big-O and performance thinking** — counting steps, O(1)/O(n)/O(n²)/O(log n) with chart visuals, measuring with `timeit`, list vs set membership, choosing data structures. Exercises: rewrite O(n²) duplicate check to O(n).
42. **Searching, sorting and recursion** — linear and binary search (`bisect`), bubble/insertion/merge sort (step visuals), recursion (base case, call stack visual, tree visual), RecursionError, when Python's `sorted` (Timsort) wins.
43. **Data structures you build** — stack, queue (`deque`), linked list class, hash map from scratch (buckets), priority queue with `heapq`. Examples: undo history, task scheduler, browser back button.
44. **Graphs, trees and dynamic programming** — adjacency lists, BFS (shortest path on a metro map), DFS, binary trees and traversal, memoisation vs tabulation (coin change, climbing stairs), interview-style framing.
45. **Working with data** — data cleaning pipeline with csv + `statistics` (mean/median/mode/stdev), grouping and aggregating with dicts/`Counter`/`groupby`, building a text report and a simple ASCII bar chart, intro of pandas as the next step (show code with `needs:["pandas"]` once, with `expect: null` if needed).
46. **HTTP and APIs** — how the web works (request/response, methods, status codes, headers) with terminal/flow visuals, JSON APIs, `urllib.parse`, building query strings, parsing realistic JSON responses (weather, cricket scores) from sample data, pagination, error handling, rate limits, `requests` explained (no live network in the course).
47. **Build your own API** — routing table, request/response as dicts, a tiny WSGI app called directly (or with `wsgiref.util.setup_testing_defaults`), JSON responses and status codes, validation; how Flask and FastAPI map to these ideas (code shown, explained).
48. **Databases with SQL** — tables, rows, SQL `CREATE/INSERT/SELECT/WHERE/ORDER BY/GROUP BY/JOIN/UPDATE/DELETE` via `sqlite3` (`"needs": ["sqlite3"]`, `:memory:`), parameterised queries (SQL injection!), transactions, an ORM idea.
49. **Async and concurrency** — blocking vs non-blocking, `async/await`, `asyncio.gather`, `asyncio.sleep` to simulate I/O, timing concurrent vs sequential, tasks and timeouts, threads/processes overview and the GIL in plain words.
50. **Project: Data dashboard CLI** — review quiz; **project**: load a sales CSV (`files`), clean it, compute KPIs (revenue by month/region, top products), store in sqlite3 or dicts, print a formatted report with ASCII charts; exercise: add a command-line filter with `argparse` (`parse_args([...])`).

## Phase 6 · Pro — Build like a pro (Days 51–60)
51. **Automation scripts** — `pathlib` + `shutil` (organise files by extension in the virtual folder), `argparse` CLIs, batch renaming, generating reports, scheduling ideas (cron, Task Scheduler), safety (dry-run flags).
52. **Web scraping and parsing** — HTML structure, `html.parser.HTMLParser` to extract links/prices from sample HTML, regex vs parsers, BeautifulSoup explained, ethics (robots.txt, rate limits, terms).
53. **A taste of data science** — numpy arrays and pandas DataFrames (`needs:["numpy"]`/`["pandas"]`, `expect` checked when deterministic), selecting/filtering/grouping, the path to ML (scikit-learn), when to reach for which tool.
54. **Design patterns in Python** — SOLID in plain words, strategy (functions as strategies), factory, observer (event bus), adapter, dependency injection; Pythonic patterns vs Java-style ceremony.
55. **Architecture of real applications** — layers (interface, service, data), configuration (env vars, settings objects), error-handling strategy, logging in apps, project structure, a refactor of a 1-file script into modules (`files`).
56. **Performance and profiling** — `cProfile`/`pstats`, `timeit`, caching with `lru_cache`, generators for memory, string building with `join`, algorithmic wins beat micro-optimisations, `tracemalloc`.
57. **Security essentials** — never trust input, SQL injection and parameterised queries (sqlite3), `eval` danger, secrets in env vars, `hashlib` + salts for passwords (and why to use bcrypt/argon2 in production), `secrets` for tokens, dependency risks.
58. **Capstone I: Task manager core** — design (requirements → models → services → storage), dataclasses models, service layer with validation, JSON storage, unit tests. Build it step by step with exercises.
59. **Capstone II: Ship it** — command interface (argparse/menu), reports, polishing (logging, errors, README), packaging with pyproject, Git workflow, deploying Python apps (Docker, Railway/Render) explained with terminal visuals, CI with tests.
60. **Graduation: You are a Python developer** — career paths (backend, data, ML/AI, automation, DevOps), portfolio projects, interview prep (common Python questions, live-coding problems with exercises: two-sum, anagram groups, valid parentheses), how to keep learning, final certificate recap.
