#!/usr/bin/env python3
"""
ops/agreement_republish.py

Takes an a2a-agreement record that BOTH parties already signed before record-privacy-v1
(intake 0.2.0, 2026-09-28) and writes the UNSIGNED canonical bytes of the same agreement with
"publication": "public" added, so both parties can sign again and the ledger will take it.

Why this exists: since intake 0.2.0 the ledger publishes an agreement only when the signed bytes
say "publication": "public". A record signed before that rule carries no such field and is refused
(422 publication_consent_missing). Adding the field to the old record is not possible: the field
sits inside the signed bytes, so both old signatures would break. The honest path is the same
terms, signed again, with consent to publish written where both signatures cover it.

What changes and what does not:
  changed  agreement_id (a new one, so the old and the new can never be confused)
           agreed_at    (the new signing moment; "both parties signed these bytes at the stated
                         time" must stay true)
           lower_bound  (a Bitcoin block newer than the old one, passed in, never guessed)
           publication  (added: "public")
           signatures   (emptied)
  kept     every other byte: parties, pinned conduct records, terms, recorder, establishes,
           does_not_establish. The script refuses if anything else would differ.

It signs nothing, fetches nothing, never touches a private key. Standard library only.
It refuses unless the old record verifies as accepted (both signatures valid), because the point
is to ask a counterparty to re-sign terms they already signed, not new terms.

    python3 ops/agreement_republish.py workers/hs-ledger/nenrin/agreement-v0/second_record_AB.json \\
        --lb-height <tip height> --lb-hash <tip hash> --keys ops/second_record_prep_out/keys.json
"""
import argparse, hashlib, io, json, os, re, secrets, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
V = os.path.abspath(os.path.join(HERE, "..", "workers", "hs-ledger", "nenrin", "agreement-v0"))
sys.path.insert(0, V)
from agreement_verify import canonical, parse_strict, verify, load_keys, SCHEMA_V11  # noqa: E402

CHANGED = {"agreement_id", "agreed_at", "lower_bound", "publication", "signatures"}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def die(m):
    print("refused: " + m, file=sys.stderr)
    sys.exit(2)


def build(base, lb_height, lb_hash, agreement_id, agreed_at):
    """Pure: the unsigned republished record. Raises ValueError on any refusal."""
    if not isinstance(base, dict) or base.get("schema") != SCHEMA_V11:
        raise ValueError("the base record must be %s" % SCHEMA_V11)
    if base.get("publication") == "public":
        raise ValueError("the base record already says publication public; file it as it is")
    if len(base.get("signatures") or []) < 2:
        raise ValueError("the base record carries fewer than two signatures; it was never both-signed")
    if not HEX64.match(lb_hash or ""):
        raise ValueError("--lb-hash must be 64 lowercase hex")
    old = base.get("lower_bound") or {}
    if not isinstance(lb_height, int) or lb_height <= int(old.get("height", 0)):
        raise ValueError("--lb-height must be newer than the base record's lower_bound %s" % old.get("height"))
    if not HEX32.match(agreement_id or ""):
        raise ValueError("agreement_id must be 32 lowercase hex")
    if agreement_id == base.get("agreement_id"):
        raise ValueError("the republished record needs a new agreement_id")
    if not ISO.match(agreed_at or ""):
        raise ValueError("agreed_at must look like 2026-09-28T05:00:00Z")
    if agreed_at <= (base.get("agreed_at") or ""):
        raise ValueError("agreed_at must be later than the base record's agreed_at")

    rec = json.loads(json.dumps(base))
    rec["agreement_id"] = agreement_id
    rec["agreed_at"] = agreed_at
    rec["lower_bound"] = {"kind": "bitcoin_block", "height": lb_height, "hash": lb_hash}
    rec["publication"] = "public"
    rec["signatures"] = []

    differ = {k for k in set(base) | set(rec) if base.get(k, None) != rec.get(k, None)}
    if not differ <= CHANGED:
        raise ValueError("would change more than the allowed fields: %s" % sorted(differ - CHANGED))
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", help="the both-signed record from before record-privacy-v1")
    ap.add_argument("--lb-height", type=int, required=True, help="Bitcoin tip height at the moment you run this")
    ap.add_argument("--lb-hash", required=True, help="Bitcoin tip hash at that height")
    ap.add_argument("--keys", default=None, help="key_url to public key map, for the key_urls_checked half")
    ap.add_argument("--agreement-id", default=None)
    ap.add_argument("--agreed-at", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)

    with io.open(a.base, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        base = parse_strict(text)
    except (ValueError, RecursionError) as e:
        die("the base record does not parse: %s" % e)
    keys = load_keys(a.keys) if a.keys else None
    rep = verify(base, keys=keys, input_text=text)
    if rep["verdict"] != "accepted" or not rep["signatures_checked"]:
        die("the base record is not accepted with both signatures checked (verdict %s); "
            "republishing is only for terms both parties already signed" % rep["verdict"])

    agreement_id = a.agreement_id or secrets.token_hex(16)
    agreed_at = a.agreed_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        rec = build(base, a.lb_height, a.lb_hash.lower(), agreement_id, agreed_at)
    except ValueError as e:
        die(str(e))

    new_rep = verify(rec, keys=keys)
    codes = sorted({x["code"] for x in new_rep["refusals"]})
    if codes and codes != ["one_sided"]:
        die("the republished record is refused for more than missing signatures: %s" % codes)

    out_text = canonical(rec)
    sha = hashlib.sha256(out_text.encode("utf-8")).hexdigest()
    out = a.out or os.path.join(HERE, "republish_" + base["agreement_id"][:8], "unsigned.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, "w", encoding="utf-8", newline="") as f:
        f.write(out_text)

    signed_a = os.path.join(os.path.dirname(out), "signed_A.json")
    print("base      " + base["agreement_id"] + "  canonical " + rep["canonical_sha256"] + "  accepted, never filed")
    print("new       " + agreement_id + "  agreed_at " + agreed_at + "  lower_bound " + str(a.lb_height))
    print("unsigned  " + out + "  bytes " + str(len(out_text.encode("utf-8"))) + "  sha256 " + sha)
    print("verifier on the unsigned bytes: " + new_rep["verdict"] + "  refusals " + (", ".join(codes) or "none"))
    print("changed   agreement_id, agreed_at, lower_bound, publication (added), signatures (emptied); nothing else")
    print("")
    print("next (V=workers/hs-ledger/nenrin/agreement-v0):")
    print("  1. python3 $V/agreement_sign.py " + out + " --key ~/.hs_agreement_key.pem --domain horizonshield.dev --out " + signed_a)
    print("  2. commit " + signed_a + ", give the counterparty the raw URL at that commit and its sha256")
    print("  3. when both-signed returns: python3 $V/agreement_verify.py <AB.json> --keys <keys.json>, then file it at the ledger")
    return 0


if __name__ == "__main__":
    sys.exit(main())
