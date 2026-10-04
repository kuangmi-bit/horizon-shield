"""nenrin_verify.policy: your rule, your decision, computed on your machine from a NENRIN resume.

NENRIN never says whether to trust an agent. A resume is a list of anchored witness records and counts, nothing
more. This module is where a developer turns that into a yes or no, under a rule the developer writes and owns:

    from nenrin_verify import policy
    rule = {"min_independent_witnesses": 2, "within_days": 30, "max_fail": 0, "exclude_domains": ["mycompany.example"]}
    d = policy.evaluate(policy.fetch_resume("https://agent.example/a2a"), rule)
    if not d["allow"]: ...

The decision is a pure function of (resume bytes, rule, evaluated_at), so anyone holding the three gets the same
answer: d carries rule_sha256 and resume_sha256, and resume_sha256 is recomputed here rather than taken on trust.
There is no score, weight or ranking anywhere; the rule counts records and the decision lists every record it
counted and why each other record was not counted.

Rule (nenrin-local-policy-v1), every key optional:
    min_independent_witnesses  int, default 2. Distinct witnesses among the counted PASS records
    within_days                int, default 30. Only records measured within this many days of evaluated_at count
    max_fail                   int, default 0. More FAIL records than this among the counted records denies
    independence               "signed_domain" (default): a witness is the domain its key_url is under, and records
                               without a key_url do not count; "name_and_vantage": the witness name and vantage pair
                               (weaker: anyone can type a name)
    exclude_domains            list of domains; a witness under any of them (suffix match) does not count. The
                               measured agent's own domain is always excluded
    exclude_names              list of strings; a witness whose name contains any of them (case-insensitive) does
                               not count. Useful under name_and_vantage, e.g. ["self-witness"]
    purposes                   list of purpose prefixes that count, e.g. ["a2a-conduct-walk-v1", "a2a-call-record-v1"];
                               default: all
    require_anchor             bool, default true. Records without a Bitcoin block do not count
    require_verified_signature bool, default false. Only records whose Ed25519 signature you verified here count:
                               pass records={sha: the "record" object of GET {ledger}/witness/{sha}} (it carries
                               record_canonical, signature_ed25519_b64 and public_key_ed25519_b64)
"""
import hashlib
import json
from datetime import datetime, timezone
from urllib.parse import urlsplit

SCHEMA = "nenrin-local-policy-v1"
DECISION_SCHEMA = "nenrin-local-policy-decision-v1"
DEFAULT_LEDGER = "https://ledger.horizonshield.dev"
RESUME_KEYS = ("schema", "perma_id", "measured_endpoint", "agent_card_url", "counts", "witness_diversity",
               "measurements", "discrepancies", "rings", "agreements", "freshness")
DEFAULTS = {"min_independent_witnesses": 2, "within_days": 30, "max_fail": 0, "independence": "signed_domain",
            "exclude_domains": [], "exclude_names": [], "purposes": None, "require_anchor": True,
            "require_verified_signature": False}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _epoch(t):
    if not isinstance(t, str):
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S UTC", "%Y-%m-%d %H:%M UTC"):
        try:
            return int(datetime.strptime(t, fmt).replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    return None


def _host(u):
    try:
        s = urlsplit(u)
        return (s.hostname or "").lower() or None
    except Exception:
        return None


def _under(host, domain):
    host, domain = (host or "").lower(), (domain or "").lower().lstrip(".")
    return bool(host and domain) and (host == domain or host.endswith("." + domain))


def resume_sha256(resume):
    """sha256 of the resume as the ledger hashed it: the resume fields only (not the envelope the route adds:
    evaluated_at, subject_responses, not_counted, scan, recompute), canonical JSON."""
    core = {k: resume[k] for k in RESUME_KEYS if k in resume}
    return hashlib.sha256(canonical(core).encode("utf-8")).hexdigest()


def normalize_rule(rule):
    r = dict(DEFAULTS)
    unknown = sorted(set(rule or {}) - set(DEFAULTS) - {"schema"})
    if unknown:
        raise ValueError("unknown rule keys: " + ", ".join(unknown) + " (a typo here would silently loosen the rule)")
    r.update({k: v for k, v in (rule or {}).items() if k != "schema"})
    if r["independence"] not in ("signed_domain", "name_and_vantage"):
        raise ValueError("independence must be signed_domain or name_and_vantage")
    for k in ("require_anchor", "require_verified_signature"):
        if not isinstance(r[k], bool):
            raise ValueError(k + " must be true or false")
    for k in ("min_independent_witnesses", "within_days", "max_fail"):
        if not isinstance(r[k], int) or isinstance(r[k], bool) or r[k] < 0:
            raise ValueError(k + " must be a non-negative integer")
    r["exclude_domains"] = sorted(set(str(d).lower().lstrip(".") for d in r["exclude_domains"]))
    r["exclude_names"] = sorted(set(str(d).lower() for d in r["exclude_names"] if str(d)))
    if r["purposes"] is not None:
        r["purposes"] = sorted(set(r["purposes"]))
    r["schema"] = SCHEMA
    return r


def evaluate(resume, rule=None, evaluated_at=None, records=None):
    """The decision. resume: the JSON from GET {ledger}/resume?endpoint=...; rule: see the module docstring;
    evaluated_at: 'YYYY-MM-DDTHH:MM:SSZ' (default: the resume's own evaluated_at, else now); records: optional
    {record_sha256: record_canonical string} for records you fetched yourself, each rechecked against its sha."""
    r = normalize_rule(rule)
    reasons, counted, skipped = [], [], []
    now = evaluated_at or resume.get("evaluated_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    now_e = _epoch(now)
    claimed = resume.get("resume_sha256")
    recomputed = resume_sha256(resume)
    if claimed != recomputed:
        reasons.append("the resume does not recompute: resume_sha256 %s, recomputed %s" % (claimed, recomputed))
    subject = _host(resume.get("measured_endpoint") or resume.get("perma_id") or "")
    for m in resume.get("measurements") or []:
        sha = m.get("record_sha256")
        w = m.get("witness") or {}
        why, sig_ok = None, None
        if records is not None and sha in records:
            why, sig_ok = _check_record(records[sha], sha)
        if why is None and r["require_verified_signature"] and sig_ok is not True:
            why = "no signature verified here (the rule requires one)"
        if why is None and r["purposes"] is not None and not any(str(m.get("purpose") or "").startswith(p) for p in r["purposes"]):
            why = "purpose not in the rule's purposes"
        if why is None and r["require_anchor"] and not (m.get("anchor") or {}).get("bitcoin_block"):
            why = "not anchored in a Bitcoin block"
        t = _epoch(m.get("measured_at"))
        if why is None and (t is None or now_e is None or (now_e - t) // 86400 > r["within_days"] or t > now_e):
            why = "measured outside the last %d days" % r["within_days"]
        kh = _host(w.get("key_url") or "")
        if why is None:
            if r["independence"] == "signed_domain":
                if not kh:
                    why = "no key_url: the witness is a typed name, not a domain"
                wid = "domain:" + kh if kh else None
            else:
                wid = "name:%s|%s" % (w.get("name"), w.get("vantage"))
            host_for_exclusion = kh
            if why is None and host_for_exclusion and subject and _under(host_for_exclusion, subject):
                why = "the witness is the measured agent's own domain"
            if why is None and host_for_exclusion and any(_under(host_for_exclusion, d) for d in r["exclude_domains"]):
                why = "the witness is under an excluded domain"
            if why is None and any(x in str(w.get("name") or "").lower() for x in r["exclude_names"]):
                why = "the witness name matches an excluded name"
        if why:
            skipped.append({"record_sha256": sha, "why": why})
            continue
        counted.append({"record_sha256": sha, "witness": wid, "outcome": m.get("outcome"), "measured_at": m.get("measured_at"),
                        "signature_verified_here": sig_ok,
                        "purpose": m.get("purpose"), "bitcoin_block": (m.get("anchor") or {}).get("bitcoin_block")})
    passing = sorted(set(c["witness"] for c in counted if c["outcome"] == "PASS"))
    fails = sum(1 for c in counted if c["outcome"] == "FAIL")
    if len(passing) < r["min_independent_witnesses"]:
        reasons.append("%d independent witness(es) with a PASS record in the window; the rule asks for %d"
                       % (len(passing), r["min_independent_witnesses"]))
    if fails > r["max_fail"]:
        reasons.append("%d FAIL record(s) in the window; the rule allows %d" % (fails, r["max_fail"]))
    allow = not reasons
    dne = ["that the agent is trustworthy: this is the rule's count of other parties' signed records, nothing more",
           "that any recorded answer was correct; a witness record says what came back, not whether it was right",
           "that witnesses with different domains are unrelated parties; a domain is the identity the ledger can check",
           "that the absence of records is a finding: an agent nobody has recorded is unknown, not bad"]
    if r["independence"] == "name_and_vantage":
        dne.append("that the witnesses are different parties: under name_and_vantage anyone can type any name")
    if records is None:
        dne.append("the record bytes themselves: pass records= to recheck each record you fetched against its sha256")
    if not r["require_verified_signature"]:
        dne.append("the signature on each record, unless signature_verified_here is true: otherwise the ledger checked "
                   "it at intake")
    dne.append("the key_url domain binding: the ledger fetched the key from the witness's domain at intake; fetch "
               "the key_url yourself to recheck that the domain still serves this key")
    dec = {"schema": DECISION_SCHEMA, "allow": allow, "reasons": reasons or ["every condition of the rule holds"],
           "evaluated_at": now, "rule": r, "rule_sha256": hashlib.sha256(canonical(r).encode("utf-8")).hexdigest(),
           "resume_sha256": recomputed, "resume_recomputes": claimed == recomputed,
           "measured_endpoint": resume.get("measured_endpoint"), "independent_passing_witnesses": passing,
           "fail_records": fails, "counted": counted, "not_counted": skipped,
           "establishes": ["that rule %s, applied to the resume with sha256 %s at %s, gives allow=%s"
                           % (hashlib.sha256(canonical(r).encode("utf-8")).hexdigest(), recomputed, now, str(allow).lower())],
           "does_not_establish": dne}
    dec["decision_sha256"] = hashlib.sha256(canonical(dec).encode("utf-8")).hexdigest()
    return dec


def _check_record(rec, sha):
    """(why_not_counted or None, signature_verified True/False/None) for a record you fetched yourself: the bytes as
    a string, or the "record" object of GET /witness/{sha}."""
    rc = rec if isinstance(rec, str) else (rec or {}).get("record_canonical")
    if not isinstance(rc, str) or hashlib.sha256(rc.encode("utf-8")).hexdigest() != sha:
        return "the record bytes you supplied do not hash to record_sha256", None
    if isinstance(rec, dict) and rec.get("signature_ed25519_b64") and rec.get("public_key_ed25519_b64"):
        from .provenance import b64_exact, ed25519_key_ok
        pk, sb = b64_exact(rec["public_key_ed25519_b64"], 32), b64_exact(rec["signature_ed25519_b64"], 64)
        if pk is None or sb is None:
            return ("the signature or public key is not canonical standard base64 "
                    "(a 64-byte signature and a 32-byte key)"), False
        if not ed25519_key_ok(pk):
            return "the public key is not a usable Ed25519 key (it must be the canonical encoding of a point in the prime-order subgroup)", False
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
            Ed25519PublicKey.from_public_bytes(pk).verify(sb, rc.encode("utf-8"))
            return None, True
        except Exception:
            return "the signature does not verify over the record bytes", False
    return None, None


def fetch_resume(endpoint, ledger=DEFAULT_LEDGER, timeout=20):
    """GET {ledger}/resume?endpoint=... (the only network call in this module)."""
    import urllib.request
    from urllib.parse import quote
    req = urllib.request.Request(ledger.rstrip("/") + "/resume?endpoint=" + quote(endpoint, safe=""),
                                 headers={"Accept": "application/json", "User-Agent": "nenrin-verify-policy"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main(argv=None):
    import argparse
    import sys
    ap = argparse.ArgumentParser(prog="nenrin-policy", description="Apply your own rule to a NENRIN resume.")
    ap.add_argument("endpoint_or_file", help="an https endpoint (the resume is fetched) or a saved resume JSON file")
    ap.add_argument("--rule", help="a rule JSON file; default: 2 signed-domain witnesses with PASS in 30 days, 0 FAIL")
    ap.add_argument("--at", help="evaluated_at, YYYY-MM-DDTHH:MM:SSZ (default: the resume's own)")
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    a = ap.parse_args(argv)
    res = fetch_resume(a.endpoint_or_file, a.ledger) if a.endpoint_or_file.startswith("https://") \
        else json.load(open(a.endpoint_or_file, encoding="utf-8"))
    rule = json.load(open(a.rule, encoding="utf-8")) if a.rule else None
    d = evaluate(res, rule, a.at)
    json.dump(d, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if d["allow"] else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
