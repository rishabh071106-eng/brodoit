# Brodoit Python harness. Runs learner code as main.py, captures output, records steps for
# the animated walkthrough, and checks exercises. Loaded once by the web worker and by
# scripts/code-check.mjs (Node), so lessons are validated with exactly the code learners run.
import ast, builtins, io, json, linecache, os, sys, traceback, types

MAIN = '<main.py>'
WORK = os.environ.get('BD_WORK', '/home/pyodide/work')
OUT_LIMIT = 200_000


class _Stop(BaseException):
    """Raised when a program prints far too much (protects the page)."""


class _Stream(io.TextIOBase):
    def __init__(self, log, name, sink):
        self.log, self.name, self.sink, self.size = log, name, sink, 0

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        if not s:
            return 0
        self.size += len(s)
        if self.size > OUT_LIMIT:
            raise _Stop('Your program printed more than 200,000 characters, so it was stopped.')
        self.log.append((self.name, s))
        if self.sink is not None:
            try:
                self.sink(self.name, s)
            except Exception:
                pass
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


def _text(log, name):
    return ''.join(s for n, s in log if n == name)


def _short(r, n=60):
    return r if len(r) <= n else r[: n - 1] + '…'


def _val(v):
    t = type(v).__name__
    if isinstance(v, (types.FunctionType, types.BuiltinFunctionType)):
        return {'t': 'function', 'r': 'function ' + getattr(v, '__name__', '?')}
    if isinstance(v, type):
        return {'t': 'class', 'r': 'class ' + v.__name__}
    try:
        r = repr(v)
    except Exception:
        r = '<' + t + '>'
    d = {'t': t, 'r': _short(r)}
    try:
        if isinstance(v, (list, tuple)) and len(v) <= 12:
            d['items'] = [_short(repr(x), 24) for x in v]
        elif isinstance(v, (set, frozenset)) and len(v) <= 12:
            d['items'] = sorted(_short(repr(x), 24) for x in v)
        elif isinstance(v, dict) and len(v) <= 10:
            d['kv'] = [[_short(repr(k), 20), _short(repr(x), 28)] for k, x in v.items()]
    except Exception:
        pass
    return d


def _vars(mapping):
    out = []
    for k, v in list(mapping.items()):
        if k.startswith('__') or isinstance(v, types.ModuleType):
            continue
        out.append([k, _val(v)])
        if len(out) >= 24:
            break
    return out


def _describe(e):
    tb = traceback.extract_tb(e.__traceback__)
    frames = [f for f in tb if f.filename == MAIN]
    line = frames[-1].lineno if frames else None
    col = None
    if isinstance(e, SyntaxError) and e.filename == MAIN:
        line, col = e.lineno, e.offset
    only = ''.join(traceback.format_exception_only(type(e), e)).replace(MAIN, 'main.py').rstrip()
    parts = ['Traceback (most recent call last):']
    for f in frames:
        parts.append('  File "main.py", line %s, in %s' % (f.lineno, f.name))
        if f.line:
            parts.append('    ' + f.line.strip())
    parts.append(only)
    return {'type': type(e).__name__, 'msg': str(e), 'line': line, 'col': col,
            'text': only.splitlines()[-1] if only else type(e).__name__, 'tb': '\n'.join(parts)}


def _prepare(files):
    os.makedirs(WORK, exist_ok=True)
    for name in os.listdir(WORK):
        p = os.path.join(WORK, name)
        if os.path.isdir(p):
            import shutil
            shutil.rmtree(p, ignore_errors=True)
        else:
            os.remove(p)
        mod = name[:-3] if name.endswith('.py') else None
        if mod and mod in sys.modules:
            del sys.modules[mod]
    for name, body in (files or {}).items():
        p = os.path.join(WORK, name)
        os.makedirs(os.path.dirname(p) or WORK, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(body)
        if name.endswith('.py') and name[:-3] in sys.modules:
            del sys.modules[name[:-3]]
    for name, mod in list(sys.modules.items()):  # package submodules too (app/services.py), not only top-level files
        f = getattr(mod, '__file__', None) or ''
        if f.startswith(WORK + '/'):
            del sys.modules[name]
    import logging  # a fresh root logger per run: basicConfig works again and never writes to a previous run's stream
    root = logging.getLogger()
    for h in root.handlers[:]:
        root.removeHandler(h)
    root.setLevel(logging.WARNING)
    os.chdir(WORK)
    if WORK not in sys.path:
        sys.path.insert(0, WORK)
    import importlib
    importlib.invalidate_caches()


class _AsyncRun(ast.NodeTransformer):
    """asyncio.run(x) at module level becomes `await x`: same result, and it works in
    browsers without WebAssembly stack switching (we already run with top-level await)."""

    def visit_FunctionDef(self, node):
        return node

    visit_AsyncFunctionDef = visit_ClassDef = visit_Lambda = visit_FunctionDef

    def visit_Call(self, node):
        self.generic_visit(node)
        f = node.func
        if (isinstance(f, ast.Attribute) and f.attr == 'run' and isinstance(f.value, ast.Name)
                and f.value.id == 'asyncio' and len(node.args) == 1 and not node.keywords):
            return ast.copy_location(ast.Await(value=node.args[0]), node)
        return node


def _compile(code):
    linecache.cache[MAIN] = (len(code), None, code.splitlines(True), MAIN)
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
    if 'asyncio.run' in code:
        tree = ast.parse(code, MAIN)
        tree = ast.fix_missing_locations(_AsyncRun().visit(tree))
        return compile(tree, MAIN, 'exec', flags=flags)
    return compile(code, MAIN, 'exec', flags=flags)


def _main_module():
    mod = types.ModuleType('__main__')
    mod.__dict__.update({'__builtins__': builtins, '__file__': 'main.py'})
    return mod


class _Tracer:
    def __init__(self, log, max_steps):
        self.log, self.max, self.steps, self.cut = log, max_steps, [], False

    def _stack(self, frame):
        names = []
        f = frame
        while f is not None:
            if f.f_code.co_filename == MAIN:
                names.append('main' if f.f_code.co_name == '<module>' else f.f_code.co_name)
            f = f.f_back
        return names[::-1]

    def __call__(self, frame, event, arg):
        if frame.f_code.co_filename != MAIN:
            return None
        if self.cut:
            return None
        if event not in ('line', 'return', 'exception'):
            return self
        if len(self.steps) >= self.max:
            self.cut = True
            sys.settrace(None)
            return None
        step = {'l': frame.f_lineno, 'e': event[:3], 's': self._stack(frame),
                'o': len(_text(self.log, 'out'))}
        mod = frame.f_code.co_name == '<module>'
        step['g'] = _vars(frame.f_globals)
        if not mod:
            step['loc'] = _vars(frame.f_locals)
        if event == 'return' and not mod:
            step['ret'] = _val(arg)
        if event == 'exception':
            step['exc'] = arg[0].__name__ if arg and arg[0] else 'Exception'
        self.steps.append(step)
        return self


async def _exec(code, stdin, sink, trace=None):
    log = []
    out, err = _Stream(log, 'out', sink), _Stream(log, 'err', sink)
    lines = stdin.split('\n') if stdin else []
    if lines and lines[-1] == '':
        lines.pop()

    def _input(prompt=''):
        if prompt:
            out.write(str(prompt))
        if not lines:
            raise EOFError('input() needed a value, but the Input box is empty.')
        v = lines.pop(0)
        log.append(('echo', v + '\n'))
        if sink is not None:
            try:
                sink('echo', v + '\n')
            except Exception:
                pass
        return v

    saved = sys.stdout, sys.stderr, sys.stdin, builtins.input
    sys.stdout, sys.stderr, sys.stdin, builtins.input = out, err, io.StringIO(stdin or ''), _input
    mod = _main_module()
    ns = mod.__dict__
    saved_main = sys.modules.get('__main__')
    sys.modules['__main__'] = mod
    error = None
    try:
        co = _compile(code)
        if trace is not None:
            sys.settrace(trace)
        if co.co_flags & 0x80:  # CO_COROUTINE: the program uses top-level await
            await types.FunctionType(co, ns)()
        else:
            exec(co, ns)
    except SystemExit as e:
        if e.code not in (None, 0):
            error = {'type': 'SystemExit', 'msg': str(e.code), 'line': None, 'col': None,
                     'text': 'SystemExit: %s' % e.code, 'tb': 'SystemExit: %s' % e.code}
    except _Stop as e:
        error = {'type': 'TooMuchOutput', 'msg': str(e), 'line': None, 'col': None, 'text': str(e), 'tb': str(e)}
    except BaseException as e:  # noqa: B036 - learners can raise anything
        error = _describe(e)
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr, sys.stdin, builtins.input = saved
        if saved_main is not None:
            sys.modules['__main__'] = saved_main
    return ns, log, error


class _Guard:
    """Counts executed lines and stops a runaway program (used by the Node validator, which has no kill switch)."""
    def __init__(self, limit):
        self.limit, self.n = limit, 0

    def __call__(self, frame, event, arg):
        if frame.f_code.co_filename != MAIN:
            return None
        if event == 'line':
            self.n += 1
            if self.n > self.limit:
                raise _Stop('Stopped after %d steps: the program never finished (an endless loop?).' % self.limit)
        return self


async def bd_run(opts_json, sink=None):
    o = json.loads(opts_json)
    guard = _Guard(int(o['maxEvents'])) if o.get('maxEvents') else None
    code, stdin, mode = o.get('code', ''), o.get('stdin', ''), o.get('mode', 'run')
    _prepare(o.get('files'))
    if mode == 'trace':
        tracer = _Tracer([], int(o.get('maxSteps', 400)))
        ns, log, error = await _exec(code, stdin, sink, None)  # pass 1: the real output
        _prepare(o.get('files'))
        tlog = []
        tracer.log = tlog
        await _exec_traced(code, stdin, tracer, tlog)
        return json.dumps({'ok': error is None, 'out': _text(log, 'out'), 'err': _text(log, 'err'),
                           'log': log, 'error': error, 'steps': tracer.steps, 'cut': tracer.cut})
    ns, log, error = await _exec(code, stdin, sink, guard)
    res = {'ok': error is None, 'out': _text(log, 'out'), 'err': _text(log, 'err'), 'log': log, 'error': error}
    if mode == 'test':
        res['test'] = await _check(code, ns, log, error, o)
    return json.dumps(res)


async def _exec_traced(code, stdin, tracer, tlog):
    # Same as _exec but the tracer shares the output log so each step knows how much was printed.
    lines = stdin.split('\n') if stdin else []
    if lines and lines[-1] == '':
        lines.pop()
    out = _Stream(tlog, 'out', None)

    def _input(prompt=''):
        if prompt:
            out.write(str(prompt))
        if not lines:
            raise EOFError('input() needed a value, but the Input box is empty.')
        return lines.pop(0)

    saved = sys.stdout, sys.stderr, sys.stdin, builtins.input
    sys.stdout, sys.stderr, sys.stdin, builtins.input = out, _Stream(tlog, 'err', None), io.StringIO(stdin or ''), _input
    mod = _main_module()
    ns = mod.__dict__
    saved_main = sys.modules.get('__main__')
    sys.modules['__main__'] = mod
    try:
        co = _compile(code)
        sys.settrace(tracer)
        if co.co_flags & 0x80:
            await types.FunctionType(co, ns)()
        else:
            exec(co, ns)
    except BaseException:  # noqa: B036
        pass
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr, sys.stdin, builtins.input = saved
        if saved_main is not None:
            sys.modules['__main__'] = saved_main


async def _check(code, ns, log, error, o):
    if error is not None:
        return {'passed': False, 'stage': 'run', 'msg': error['text'], 'line': error['line']}
    tests = o.get('tests') or ''
    out = _text(log, 'out')

    async def run_program(stdin=''):
        _prepare(o.get('files'))
        _, l2, e2 = await _exec(code, stdin, None, _Guard(int(o['maxEvents'])) if o.get('maxEvents') else None)
        if e2 is not None:
            raise AssertionError('With input %r your program crashed: %s' % (stdin, e2['text']))
        return _text(l2, 'out')

    def norm(s):
        return '\n'.join(line.rstrip() for line in str(s).strip().splitlines())

    tns = dict(ns)
    tns.update({'__out__': out, '__code__': code, 'run_program': run_program, 'norm': norm,
                'out_lines': [line.rstrip() for line in out.strip().splitlines()], 'ast': ast,
                '__tree__': ast.parse(code)})
    saved = sys.stdout
    sys.stdout = io.StringIO()
    try:
        co = compile(tests, '<tests>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        if co.co_flags & 0x80:
            await types.FunctionType(co, tns)()
        else:
            exec(co, tns)
    except AssertionError as e:
        return {'passed': False, 'stage': 'test', 'msg': str(e) or 'One of the checks did not pass.'}
    except BaseException as e:  # noqa: B036
        return {'passed': False, 'stage': 'test', 'msg': '%s: %s' % (type(e).__name__, e)}
    finally:
        sys.stdout = saved
    return {'passed': True}
