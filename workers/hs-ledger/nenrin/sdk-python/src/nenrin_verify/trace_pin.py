"""Pin a TRACE Trust Record to a NENRIN ledger in one command, and check a pin later: the Python twin of
sdk/trace_pin_cli.mjs.

    nenrin-trace-pin <record.json>                 check locally, show what would be sent, send nothing
    nenrin-trace-pin <record.json> --yes           pin it (the record becomes public; it cannot be withdrawn)
    nenrin-trace-pin status <sha>                  pending or anchored, and do the stored bytes hash to <sha>?
    options: --ledger <origin> (default https://ledger.horizonshield.dev)   --out <receipt.json>

Before anything leaves the machine the record goes through the same intake the ledger runs (trace.py, SPEC.md
section 2), so a record the ledger would refuse is refused here and never sent. What is sent is the RFC 8785 form of
the record, and the ledger's answer must name the sha computed here. The ledger is a parameter: any service with the
same contract (POST {"record"} -> {sha, status}; GET /evidence/trace/<sha>[?format=raw]) can be named.

Exit 0 = done (or a dry run that would be pinnable), 1 = refused, mismatched or not found, 2 = input or network error.
"""
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from ._js import loads
from .trace import Refusal, check_trace_record, jcs, unwrap_vector

DEFAULT_LEDGER = "https://ledger.horizonshield.dev"
PUBLIC_NOTICE = "A pinned record is public and cannot be withdrawn. Pin only a record you are willing to publish."
USER_AGENT = "nenrin-verify-python (+https://github.com/ogasurfproject-jpg/horizon-shield)"
_HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")
_MAX_BODY = 1 << 20


def _origin(s):
    u = urllib.parse.urlsplit(s)
    if not u.scheme or not u.hostname:
        raise ValueError("--ledger is not a URL: " + s)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        raise ValueError("--ledger must be https (http only for localhost)")
    return u.scheme + "://" + u.netloc


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _urllib_fetch(method, url, body=None):
    headers = {"accept": "application/json", "user-agent": USER_AGENT}
    if body is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(req, timeout=20) as r:
            return r.status, r.read(_MAX_BODY)
    except urllib.error.HTTPError as e:
        return e.code, e.read(_MAX_BODY)


def _json(b):
    try:
        return json.loads(b)
    except (ValueError, UnicodeDecodeError):
        return {}


def _producer(v):
    if isinstance(v, dict):
        return v.get("producer_id") or v
    return v or None


def pin_record(record_value, ledger=DEFAULT_LEDGER, send=False, now=None, fetch=_urllib_fetch):
    """Local intake, then (only when send is True) POST the RFC 8785 form and check the receipt."""
    origin = _origin(ledger)
    record = unwrap_vector(record_value)
    now = int(time.time()) if now is None else now
    try:
        c = check_trace_record(record, now)
    except Refusal as e:
        return {"ok": False, "stage": "local_intake", "refused": e.code, "sent": False}
    base = {"sha": c["sha"], "key_thumbprint": c["key_thumbprint"], "iat": c["iat"], "subject": c["subject"],
            "ledger": origin}
    if not send:
        return dict(ok=True, stage="dry_run", sent=False, notice=PUBLIC_NOTICE, next="rerun with --yes to pin", **base)
    status, raw = fetch("POST", origin + "/evidence/trace", ('{"record":' + jcs(record) + "}").encode("utf-8"))
    body = _json(raw)
    if not 200 <= status < 300:
        return dict(ok=False, stage="ledger", sent=True, http=status,
                    refused=body.get("reason_code") or body.get("error"), why=body.get("why"), **base)
    if body.get("sha") != c["sha"]:
        return dict(ok=False, stage="receipt", sent=True,
                    error="the ledger answered with sha %s, not this record's %s" % (body.get("sha"), c["sha"]), **base)
    return dict(ok=True, stage="pinned", sent=True, status=body.get("status"), dedup=bool(body.get("dedup")),
                url=body.get("url"), registered_producer=_producer(body.get("registered_producer")),
                raw_url=origin + "/evidence/trace/" + c["sha"] + "?format=raw",
                check_later="nenrin-trace-pin status " + c["sha"] + ("" if origin == DEFAULT_LEDGER else " --ledger " + origin),
                **base)


def pin_status(sha, ledger=DEFAULT_LEDGER, fetch=_urllib_fetch):
    """Is <sha> pinned, and do the bytes the ledger serves hash to it?"""
    origin = _origin(ledger)
    s = str(sha).lower()
    if not _HEX64.match(s):
        raise ValueError("sha must be 64 hex characters")
    status, raw = fetch("GET", origin + "/evidence/trace/" + s)
    if status == 404:
        return {"ok": False, "sha": s, "found": False, "ledger": origin}
    body = _json(raw)
    if not 200 <= status < 300:
        return {"ok": False, "sha": s, "found": None, "http": status, "error": body.get("error"), "ledger": origin}
    rstatus, rbytes = fetch("GET", origin + "/evidence/trace/" + s + "?format=raw")
    got = hashlib.sha256(rbytes).hexdigest()
    anchor = body.get("anchor") or {}
    return {
        "ok": 200 <= rstatus < 300 and got == s, "sha": s, "found": True, "ledger": origin,
        "status": body.get("status"), "bytes_match": got == s, "served_sha256": got,
        "registered_producer": _producer(body.get("registered_producer")),
        "bitcoin_block": anchor.get("block"), "ledger_entry": anchor.get("ledger_entry"),
        "note": ("the bytes existed no later than the Bitcoin block above" if body.get("status") == "anchored"
                 else "queued for the daily batch at 00:30 UTC; run again after it is stamped"),
    }


def main(argv=None):
    a = list(sys.argv[1:] if argv is None else argv)

    def opt(n):
        return a[a.index(n) + 1] if n in a and a.index(n) + 1 < len(a) else None

    ledger = opt("--ledger") or DEFAULT_LEDGER
    try:
        if len(a) >= 2 and a[0] == "status":
            r = pin_status(a[1], ledger=ledger)
            print(json.dumps(r, indent=2, ensure_ascii=False))
            return 0 if r["ok"] else 1
        if not a or a[0].startswith("--"):
            print("usage: nenrin-trace-pin <record.json> [--yes] [--ledger URL] [--out receipt.json] | "
                  "nenrin-trace-pin status <sha> [--ledger URL]", file=sys.stderr)
            return 2
        with open(a[0], "rb") as f:
            v = loads(f.read())
        r = pin_record(v, ledger=ledger, send="--yes" in a)
    except (ValueError, OSError, urllib.error.URLError) as e:
        print(str(e), file=sys.stderr)
        return 2
    out = opt("--out")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(json.dumps(r, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(r, indent=2, ensure_ascii=False))
    if r.get("stage") == "dry_run":
        print(PUBLIC_NOTICE + " Nothing was sent; add --yes to pin.", file=sys.stderr)
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
