#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI peer_kit: two parties make, sign, anchor and settle a contract with nobody from this project involved.

Every MUSUBI contract so far has had this project as a party, and every execution reached Bitcoin through its
ledger. The adoption count says it plainly: contracts with an outside party 2, contracts with no party from this
project 0. The protocol is only a protocol if that second number can move without us. This file is the whole
path, for two parties A and B, using only these verification files, OpenTimestamps and public block headers:

    keygen          each party, on its own machine: an Ed25519 key (PEM) and its public key (base64)
    contract        either party: the unsigned contract from a small JSON of parameters
    sign            each party: add its signature (contract_v0.sign_contract; refuses a key the contract does not pin)
    verify          anyone: contract_v0.verify_contract
    exec            the contractor: a signed a2a-execution-v0 naming the contract by contract_sha256
    stampable       anyone: the bytes to give `ots stamp` (anchor_direct)
    anchor          anyone: the settle anchor from the confirmed .ots and a header view (anchor_direct)
    settle          anyone: settle v1.10 (v1.9, v1.8 and v1.7 underneath) on the anchored records

Block headers come from any explorer; header_view_fetch.py builds a view from two and checks they agree. Nothing
here sends anything anywhere, and no step needs an account, a key or a server of ours.

    python3 peer_kit.py keygen --out a.pem
    python3 peer_kit.py contract --params params.json --out c.unsigned.json
    python3 peer_kit.py sign --contract c.unsigned.json --key a.pem --domain a.example --out c.A.json
    python3 peer_kit.py sign --contract c.A.json --key b.pem --domain b.example --out c.AB.json
    python3 peer_kit.py exec --contract c.AB.json --key b.pem --actions read --nenrin-ref <64 hex> --out e.json
    python3 peer_kit.py stampable --record e.json --out e.stamp && ots stamp e.stamp     (later: ots upgrade e.stamp.ots)
    python3 peer_kit.py anchor --record e.json --ots e.stamp.ots --contract c.AB.json --view headers.json --out e.anchored.json
    python3 peer_kit.py settle --contract c.AB.json --event e.anchored.json --view headers.json

params.json: {"principal": {"domain", "key_url", "public_key_ed25519_b64"}, "contractor": {same}, "task": {"purpose",
"payload_digest"}, "authorized_actions": [...], "prohibited_actions": [...], "witnesses": [{"name",
"public_key_ed25519_b64"}], "lower_bound": {"kind": "bitcoin_block", "height", "hash"}, "finality_depth": 6,
"expiry_height": null, "requirements": {...} (optional: terms, independence, corroboration, spine, convergence)}.
"""
import argparse, base64, json, os, secrets, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_v0 as v0
import settle_v1_2 as v12
import anchor_direct as ad
from contract_v0 import canonical, parse_strict, contract_sha256, EXEC_SCHEMA

DNE = ["that anyone enforced any of this at runtime; the grant is proved against the records afterwards",
       "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
       "that anyone judges liability or fault; the verdict is a function anyone recomputes from the contract, the records and the headers",
       "that a prohibited action was impossible, only that performing one is a provable deviation",
       "that this is a legal contract or determines legal responsibility"]
EST = ["that both parties signed these grant bytes at the stated time"]


def keygen(out):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def build(params):
    g = {"authorized_actions": list(params["authorized_actions"]), "prohibited_actions": list(params.get("prohibited_actions") or []),
         "conditional": [], "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
         "finality": {"depth": int(params.get("finality_depth", 6)), "max_target_bits": params.get("max_target_bits", "17080000")},
         "witnesses": list(params.get("witnesses") or [])}
    if params.get("expiry_height") is not None:
        g["expiry_height"] = params["expiry_height"]
    task = dict(params["task"])
    return v0.build_contract(dict(params["principal"]), dict(params["contractor"]), task, g, EST, DNE,
                             requirements=params.get("requirements") or {"evidence": "nenrin_required", "recovery": "n/a"},
                             bond=params.get("bond"), lower_bound=params["lower_bound"],
                             contract_id=params.get("contract_id") or secrets.token_hex(16), nonce=secrets.token_hex(16))


def sign(contract, pem, domain):
    key, pub = v0._load_priv(pem)
    v0.sign_contract(contract, key, pub, domain)
    return contract


def make_exec(contract, pem, actions, nenrin_ref):
    key, pub = v0._load_priv(pem)
    me = next((p for p in contract["parties"] if p.get("role") == "contractor"), {})
    if me.get("public_key_ed25519_b64") != pub:
        raise SystemExit("this key is not the contractor key the contract pins")
    r = {"schema": EXEC_SCHEMA,
         "contract_ref": {"contract_id": contract["contract_id"], "payload_digest": (contract.get("task") or {}).get("payload_digest"),
                          "contract_sha256": contract_sha256(contract)},
         "performed_actions": list(actions), "approvals": [], "delegated_to": [], "nenrin_ref": nenrin_ref}
    return v12.sign_record(r, key, "contractor")


def _selftest():
    n = 0
    t = tempfile.mkdtemp()
    pa = keygen(os.path.join(t, "a.pem")); pb = keygen(os.path.join(t, "b.pem")); pw = keygen(os.path.join(t, "w.pem"))
    try:
        keygen(os.path.join(t, "a.pem")); raise AssertionError("keygen overwrote a key")
    except FileExistsError:
        pass
    assert oct(os.stat(os.path.join(t, "a.pem")).st_mode & 0o777) == "0o600"
    n += 1; print("[1] keygen: three keys, file mode 600, an existing key file is never overwritten")
    params = {"principal": {"domain": "a.example", "key_url": "https://a.example/keys/agreement.json", "public_key_ed25519_b64": pa},
              "contractor": {"domain": "b.example", "key_url": "https://b.example/keys/agreement.json", "public_key_ed25519_b64": pb},
              "task": {"purpose": "endpoint_conduct_walk", "payload_digest": "a" * 64},
              "authorized_actions": ["read", "emit_witness"], "prohibited_actions": ["delete", "payment"],
              "witnesses": [{"name": "w", "public_key_ed25519_b64": pw}],
              "lower_bound": {"kind": "bitcoin_block", "height": 969500, "hash": "0" * 64}, "finality_depth": 6}
    c = build(params)
    assert v0.verify_contract(c)["verdict"] == "refused"
    sign(c, os.path.join(t, "a.pem"), "a.example")
    try:
        sign(c, os.path.join(t, "w.pem"), "b.example"); raise AssertionError("signed with a key the contract does not pin")
    except SystemExit:
        pass
    sign(c, os.path.join(t, "b.pem"), "b.example")
    vc = v0.verify_contract(c)
    assert vc["verdict"] == "accepted", vc
    assert not any(p.get("domain", "").endswith("horizonshield.dev") for p in c["parties"])
    n += 1; print("[2] contract built from params, signed by A then B (a third key refused), verify_contract accepted; no party is this project")
    e = make_exec(c, os.path.join(t, "b.pem"), ["read"], "8" * 64)
    assert v12.authenticate(e, c) is None and e["contract_ref"]["contract_sha256"] == contract_sha256(c)
    try:
        make_exec(c, os.path.join(t, "a.pem"), ["read"], "8" * 64); raise AssertionError("principal signed an execution")
    except SystemExit:
        pass
    n += 1; print("[3] execution signed by the contractor authenticates under the contract; the principal's key is refused")
    assert ad.stampable_bytes(e) == canonical({k: v for k, v in e.items() if k != "anchor"}).encode("utf-8")
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(HERE, "anchor_direct.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "ALL PASS" in r.stdout, r.stdout[-300:]
    n += 1; print("[4] the stampable bytes for the execution, and anchor_direct (stamp, anchor, settle v1.7 final) pass")
    print("ALL PASS (peer_kit: %d checks)" % n)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["selftest", "keygen", "contract", "sign", "verify", "exec", "stampable", "anchor", "settle"])
    ap.add_argument("--out"); ap.add_argument("--params"); ap.add_argument("--contract"); ap.add_argument("--key"); ap.add_argument("--domain")
    ap.add_argument("--actions"); ap.add_argument("--nenrin-ref"); ap.add_argument("--record"); ap.add_argument("--ots")
    ap.add_argument("--view", action="append", default=[]); ap.add_argument("--event", action="append", default=[])
    a = ap.parse_args()
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    wr = lambda obj: open(a.out, "w", encoding="utf-8", newline="").write(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    if a.cmd == "selftest":
        _selftest(); return 0
    if a.cmd == "keygen":
        print(json.dumps({"private_key_file": a.out, "public_key_ed25519_b64": keygen(a.out),
                          "next": "publish the public key at your key_url; keep the PEM on this machine"}, indent=2)); return 0
    if a.cmd == "contract":
        c = build(rd(a.params)); wr(c); print(json.dumps({"wrote": a.out, "contract_sha256": contract_sha256(c)})); return 0
    if a.cmd == "sign":
        c = sign(rd(a.contract), a.key, a.domain); wr(c); print(json.dumps({"wrote": a.out, "signatures": len(c["signatures"])})); return 0
    if a.cmd == "verify":
        print(json.dumps(v0.verify_contract(rd(a.contract)), indent=2)); return 0
    if a.cmd == "exec":
        e = make_exec(rd(a.contract), a.key, [x for x in a.actions.split(",") if x], a.nenrin_ref); wr(e)
        print(json.dumps({"wrote": a.out})); return 0
    if a.cmd == "stampable":
        sys.argv = ["anchor_direct.py", "--stampable", a.record, "--out", a.out]; return ad.main()
    if a.cmd == "anchor":
        sys.argv = ["anchor_direct.py", "--record", a.record, "--ots", a.ots, "--contract", a.contract, "--view", a.view[0], "--out", a.out]
        return ad.main()
    if a.cmd == "settle":
        import settle_v1_10 as v19
        sys.argv = ["settle_v1_10.py", "--settle", a.contract] + sum((["--event", x] for x in a.event), []) + sum((["--view", x] for x in a.view), [])
        return v19.main()
    return 1


if __name__ == "__main__":
    sys.exit(main())
