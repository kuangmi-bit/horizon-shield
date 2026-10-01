"""Edits of the frozen TSUGI chains and pools, deterministic, for the live JavaScript/Python comparison.

Every path of a chain is edited in about twenty ways. An edit inside the records is also run re-sealed (the record's
hash recomputed, links to it moved, a known key's signature redone, tsugi_tools.reseal), so the edit reaches the rule
it targets instead of stopping at hash_mismatch; inside an embedded observation it is also run with only the chain
re-sealed, so the observation itself arrives broken."""
import copy
import json

from tsugi_tools import records_of, reseal

VALUES = [None, True, 0, "", "x", [], {}, "toString", {"toString": "x"}]
TIMES = ["2026-09-20T07:00:00Z", "2026-09-20T23:59:59.999Z", "2026-09-20T07:00:00+00:00", "2026-09-20", "٢026-09-20T07:00:00Z",
         "2026-09-20T07:00:00Z\n", "9999-12-31T23:59:59Z", "0000-01-01T00:00:00Z"]
URLS = ["https://gate.horizonshield.dev", "HTTPS://GATE.horizonshield.dev:443/", "https:gate.horizonshield.dev", "http://gate.horizonshield.dev:80",
        "https://u:p@gate.horizonshield.dev", "https://0x7f.1/", "https://witness-b.example/.well-known/hs-witness-key.json",
        "https://WITNESS-B.example:443/k", "https://witness-b.example:8443/k", "foo://gate.horizonshield.dev", "not a url",
        "https://witness-b.example.", "https://witness-b.example\\k", "https://%77itness-b.example/k", "https:///witness-b.example"]
SCHEMA_NAMES = ["nenrin-drift-record-v1", "nenrin-repair-proposal-v1", "nenrin-authorization-v1", "nenrin-repair-execution-v1",
                "nenrin-verify-record-v1", "nenrin-witness-observation-v1", "hasOwnProperty", "constructor"]
SPECIAL = {
    "recorded_at": TIMES, "expires_at": TIMES,
    "endpoint": URLS, "key_url": URLS,
    "schema": SCHEMA_NAMES,
    "primitive": ["quarantine_endpoint", "rotate_credential", "valueOf", "reboot"],
    "decision": ["refused", "Approved"],
    "signed_domain": ["WITNESS-B.example", "witness-c.example", "gate.horizonshield.dev", "witness-b.example."],
    "k": ["0", "1", "2", "4", "03", "9" * 30],
    "height": ["0", "1", "2", "01", "9" * 30],
    "pool_size": ["0", "5", "6", "06"],
    "recovered": [False, "true"],
    "drift": [False, "true"],
}
_DEL = object()


def paths(v, p=()):
    yield p, v
    if isinstance(v, dict):
        for k, x in v.items():
            yield from paths(x, p + (k,))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from paths(x, p + (i,))


def _set(root, p, fn):
    r = copy.deepcopy(root)
    if not p:
        return fn(r)
    cur = r
    for k in p[:-1]:
        cur = cur[k]
    res = fn(cur[p[-1]])
    if res is _DEL:
        del cur[p[-1]]
    else:
        cur[p[-1]] = res
    return r


def _edits(p, v):
    key = p[-1] if p else None
    yield "delete", lambda _x: _DEL
    for val in VALUES:
        yield "set:" + json.dumps(val), lambda _x, val=val: copy.deepcopy(val)
    if isinstance(v, str):
        yield "append", lambda x: x + "0"
        yield "chop", lambda x: x[:-1]
        yield "upper", lambda x: x.upper()
        yield "accent", lambda x: x + "é"
    if isinstance(v, list) and v:
        yield "reverse", lambda x: x[::-1]
        yield "dup0", lambda x: [x[0]] + x
        yield "drop0", lambda x: x[1:]
    if isinstance(v, dict):
        yield "own toString", lambda x: dict(x, toString={"a": "b"})
        yield "own __proto__", lambda x: dict(x, __proto__={"a": "b"})
        yield "extra key", lambda x: dict(x, extra="y")
    for s in SPECIAL.get(key, []):
        yield "special:" + json.dumps(s), lambda _x, s=s: copy.deepcopy(s)


def mutations(root, pool=None, deep=True, raw=True):
    """(path, op, edited root) for every path and edit: the edit as it is (raw) and, with deep, re-sealed variants of
    edits inside the records."""
    recs, pre = records_of(root)
    for p, v in list(paths(root)):
        if not p:
            continue
        in_records = recs is not None and tuple(p[:len(pre)]) == pre and len(p) > len(pre) + 0
        in_obs = "external" in p and "record" in p
        for op, fn in _edits(p, v):
            edited = _set(root, p, fn)
            if raw:
                yield p, op, edited
            if deep and in_records:
                yield p, op + " +reseal", reseal(edited, p, pool)
                if in_obs:
                    yield p, op + " +reseal-outer", reseal(edited, p, pool, inner=False)
