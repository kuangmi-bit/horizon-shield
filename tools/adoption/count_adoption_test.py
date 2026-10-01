"""count_adoption.py against a local fake ledger and a fake GitHub, so the counting rules are checked offline.

    python3 tools/adoption/count_adoption_test.py
"""
import http.server, json, os, sys, threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"

BATCH1 = {"schema": "nenrin-witness-batch-v1", "records": [
    {"sha": "a", "signed": True, "signed_domain": "api.babyblueviper.com"},
    {"sha": "b", "signed": True, "signed_domain": "gate.horizonshield.dev"},
    {"sha": "c", "signed": False, "witness_name": "someone-unsigned"},
    {"sha": "c2", "signed": False, "witness_name": "HORIZON SHIELD self-witness (github runner)"}]}
BATCH2 = {"schema": "nenrin-witness-batch-v1", "records": [
    {"sha": "d", "signed": True, "signed_domain": "PIPAVLO82.github.io"},
    {"sha": "e", "signed": True, "signed_domain": "api.babyblueviper.com"}]}
ENTRIES = {1: {"record_canonical": "# a plain text claim"}, 2: {"record_canonical": json.dumps(BATCH1)},
           3: {"record_canonical": json.dumps(BATCH2)}}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/ledger/head":
            body = {"n": 4, "head": "h"}
        elif self.path.startswith("/ledger/"):
            n = int(self.path.rsplit("/", 1)[1])
            if n == 4:
                self.send_response(500); self.end_headers(); return
            body = ENTRIES[n]
        else:
            self.send_response(404); self.end_headers(); return
        b = json.dumps(body).encode()
        self.send_response(200); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)


def main():
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    os.environ["HS_LEDGER"] = "http://127.0.0.1:%d" % s.server_address[1]
    import count_adoption as C
    C.LEDGER = os.environ["HS_LEDGER"]
    bad = 0

    def check(name, got, want):
        nonlocal bad
        ok = got == want
        bad += not ok
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got %r want %r" % (got, want)))

    our = ["horizonshield.dev", "the-horizons-innovation.com", "ogasurfproject-jpg"]
    w = C.ledger_witnesses(our, ["horizon shield", "toshikatsu oga"])
    check("outside signed domains, ours left out, case folded", sorted(w["signed_domains"]), ["api.babyblueviper.com", "pipavlo82.github.io"])
    check("a domain that filed twice is one witness", w["signed_domains"]["api.babyblueviper.com"], [2, 3])
    check("unsigned names listed, not counted, our own names left out", list(w["unsigned_names"]), ["someone-unsigned"])
    check("an entry that cannot be read is reported, not skipped silently", w["unreadable_entries"], [4])
    check("only witness batches are read", w["witness_batches"], 2)
    check("ours(): subdomain of ours", C.ours("gate.horizonshield.dev", our), True)
    check("ours(): look-alike is not ours", C.ours("evilhorizonshield.dev", our), False)
    c = C.contracts(our)
    check("committed contracts both sides signed have an outside party", c["with_an_outside_party"] >= 1, True)
    check("no contract without us is invented", c["with_no_party_from_us"], 0)
    d = {"measured_at": "2026-10-02T00:00:00Z", "metrics": {
        "independent_implementations": {"count": 1, "distinct_authors": 1, "by_subject": {"x": 1}, "open_calls": {}},
        "independent_witnesses": {"count": None, "ledger": None, "reverification_pool": {"admitted": [], "file": "p", "quorum_of_independent_controls_needed": 2}},
        "external_contracts": {"with_an_outside_party": 0, "with_no_party_from_us": 0},
        "external_evidence_producers": {"count": None}, "third_party_ci_reproductions": {"count": None}}}
    blk = C.readme_block(d)
    check("an unreadable source prints 'not measured', never 0", blk.count("not measured"), 3)
    print("\n%s" % ("all passed" if not bad else "%d failed" % bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
