"""Generate mutated bundles from the frozen fixtures, deterministically, for the live JavaScript/Python comparison."""
import json

VALUES = [None, True, False, 0, 1, -1, 1.5, 2 ** 53, "", "x", [], {}, "did:key:zNotValid"]
TIMES = ["2026-02-31T00:00:00Z", "2026-09-18T24:00:00Z", "2026-09-18T24:00:00.0001Z", "2026-09-18T00:30:00.1234Z",
         "2026-09-18T00:30:00+00:00", "2026-09-18", " 2026-09-18T00:30:00Z", "2026-09-18T00:30:00Z\n",
         "2026-13-01T00:00:00Z", "2026-09-18T23:60:00Z", "٢026-09-18T00:30:00Z", "0000-01-01T00:00:00Z"]
SEQS = ["0", "1", [0], True, None, 0.0, -0.0, 1e0, 2, "0x1", " 1 ", [1], {}]
TIME_KEYS = {"executed_at", "declared_at", "not_before", "not_after", "observed_at"}


def paths(v, p=()):
    yield p, v
    if isinstance(v, dict):
        for k, x in v.items():
            yield from paths(x, p + (k,))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from paths(x, p + (i,))


def _set(root, p, fn):
    r = json.loads(json.dumps(root))
    if not p:
        return fn(r)
    cur = r
    for k in p[:-1]:
        cur = cur[k]
    res = fn(cur[p[-1]])
    if res is _DELETE:
        del cur[p[-1]]
    else:
        cur[p[-1]] = res
    return r


_DELETE = object()


def mutations(bundle):
    yield (), "root inside __proto__", {"__proto__": json.loads(json.dumps(bundle))}
    yield (), "root __proto__ beside own keys", dict(json.loads(json.dumps(bundle)), __proto__={"task_id": "other"})
    for val in ([], None, "ab", 7, True):
        yield (), "root is " + json.dumps(val), val
    for p, v in list(paths(bundle)):
        if not p:
            continue
        key = p[-1]
        yield p, "delete", _set(bundle, p, lambda _x: _DELETE)
        for val in VALUES:
            yield p, "set:" + json.dumps(val), _set(bundle, p, lambda _x, val=val: json.loads(json.dumps(val)))
        if isinstance(v, str):
            yield p, "append", _set(bundle, p, lambda x: x + "0")
            yield p, "chop", _set(bundle, p, lambda x: x[:-1])
            yield p, "upper", _set(bundle, p, lambda x: x.upper())
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            yield p, "inc", _set(bundle, p, lambda x: x + 1)
        if isinstance(v, list) and v:
            yield p, "reverse", _set(bundle, p, lambda x: x[::-1])
            yield p, "dup0", _set(bundle, p, lambda x: [x[0]] + x)
            yield p, "drop0", _set(bundle, p, lambda x: x[1:])
        if key in TIME_KEYS:
            for t in TIMES:
                yield p, "time:" + t, _set(bundle, p, lambda _x, t=t: t)
        if isinstance(v, dict):
            for pv in ("x", None, {}, {"task_id": "task_py_parity_1"}):
                yield p, "own __proto__:" + json.dumps(pv), _set(bundle, p, lambda x, pv=pv: dict(x, __proto__=json.loads(json.dumps(pv))))
            yield p, "own __proto__ holding a copy", _set(bundle, p, lambda x: {"__proto__": json.loads(json.dumps(x))})
        if key == "seq":
            for s in SEQS:
                yield p, "seq:" + json.dumps(s), _set(bundle, p, lambda _x, s=s: json.loads(json.dumps(s)))
