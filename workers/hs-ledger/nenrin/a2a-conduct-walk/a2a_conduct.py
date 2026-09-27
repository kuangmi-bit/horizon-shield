#!/usr/bin/env python3
"""a2a_conduct.py : the A2A Conduct Extension (conduct-v1.4) as three calls, for any agent and any client.

Standard library only. Ships in the same package as the witness walk (pip install a2a-conduct-walk).

For an agent (server side), three lines make it conformant:

    import a2a_conduct as ac
    card["capabilities"].setdefault("extensions", []).append(ac.extension(compensation, ["https://you.example/a2a"]))
    headers.update(ac.echo_headers(request.headers))                          # on every A2A response
    message["metadata"] = {**message.get("metadata", {}), **ac.metadata(ext, request.url)}   # when activated

For a client, one call before delegating work to an agent it has not used before:

    report = ac.preflight("https://agent.example")      # card, who pays it, its register reading, where to file

Why this exists. The extension spreads only when declaring it costs nothing and checking it costs nothing. Until now
both meant reading a specification. The walk client already proves an agent built with these helpers passes every
applicable assertion on both A2A wires (see a2a_conduct_selftest.py).
"""
import json
import urllib.parse
import urllib.request

EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1"
EXT_PERMANENT_ID = "https://w3id.org/horizonshield/conduct/v1"
EXT_URIS = (EXT_URI, EXT_PERMANENT_ID)
GATE = "https://gate.horizonshield.dev"
WITNESS_INTAKE = "https://ledger.horizonshield.dev/witness"
PAID_BY = ("buyer", "seller", "referral", "advertising", "subscription", "public", "other")
USER_AGENT = "a2a-conduct/1.4 (+" + EXT_URI + ")"


def _served(url):
    """https://host[:port]/path of the URL the request arrived at: no query, no fragment (section 14.2)."""
    s = urllib.parse.urlsplit(url)
    host = (s.hostname or "").lower()
    port = s.port
    return s.scheme.lower() + "://" + host + (":" + str(port) if port and port not in (80, 443) else "") + (s.path or "/")


def extension(compensation, measured_endpoints, conduct_record=None, witness_intake=WITNESS_INTAKE, **optional):
    """The AgentExtension entry for capabilities.extensions[] (section 2). Refuses a malformed compensation
    declaration instead of publishing one: a card that says who pays it wrongly is worse than one that does not."""
    c = dict(compensation)
    if c.get("paid_by") not in PAID_BY:
        raise ValueError("compensation.paid_by must be one of " + ", ".join(PAID_BY))
    for k in ("referral_fee", "listing_fee"):
        if not isinstance(c.get(k), bool):
            raise ValueError("compensation." + k + " must be a boolean")
    if "success_fee_pct" in c and not (isinstance(c["success_fee_pct"], (int, float)) and 0 <= c["success_fee_pct"] <= 100):
        raise ValueError("compensation.success_fee_pct must be a number from 0 to 100")
    eps = list(measured_endpoints)
    if not eps or not all(isinstance(u, str) and u.startswith("https://") for u in eps):
        raise ValueError("measured_endpoints must be one or more https URLs")
    params = {"compensation": c, "measured_endpoints": eps,
              "conduct_record": conduct_record or GATE + "/history?endpoint=" + urllib.parse.quote(eps[0], safe=""),
              "witness_intake": witness_intake}
    for k in ("verdict_recipe", "consent", "register", "rings"):
        if k in optional:
            params[k] = optional[k]
    return {"uri": EXT_URI, "description": "Who pays this agent, where its measured conduct record lives, and where to file a witness walk.",
            "required": False, "params": params}


def activated(request_headers):
    """Which accepted URI the caller activated, and under which header spelling. (None, None) when not activated."""
    h = {str(k).lower(): str(v) for k, v in dict(request_headers or {}).items()}
    for spelling in ("a2a-extensions", "x-a2a-extensions"):
        for u in [x.strip() for x in h.get(spelling, "").split(",")]:
            if u in EXT_URIS:
                return u, spelling
    return None, None


def echo_headers(request_headers):
    """Response headers for section 3: echo the string the caller sent, under A2A-Extensions, and also under
    X-A2A-Extensions when the caller used that spelling (a 0.3 client reads only the spelling it sent)."""
    uri, spelling = activated(request_headers)
    if not uri:
        return {}
    out = {"A2A-Extensions": uri}
    if spelling == "x-a2a-extensions":
        out["X-A2A-Extensions"] = uri
    return out


def metadata(ext, served_url):
    """The section 3 metadata keys for a Message or Task, always under the canonical URI (section 12.4).
    endpoint = the measured endpoint whose record applies (the served URL itself when it is measured);
    served_by = where this request actually arrived (section 14), taken from the request, never a constant."""
    p = ext["params"]
    served = _served(served_url)
    eps = p["measured_endpoints"]
    endpoint = served if served in eps else eps[0]
    return {EXT_URI + "/endpoint": endpoint, EXT_URI + "/conduct_record": p["conduct_record"],
            EXT_URI + "/witness_intake": p["witness_intake"], EXT_URI + "/served_by": served}


def attach(result, ext, served_url):
    """Attach metadata and list the URI in extensions on a 0.3 Message/Task dict or a 1.0 {message}/{task} wrapper."""
    obj = result.get("message") or result.get("task") or result
    obj["metadata"] = {**(obj.get("metadata") or {}), **metadata(ext, served_url)}
    target = obj
    if (obj.get("kind") == "task" or "status" in obj) and isinstance(obj.get("status"), dict) and isinstance(obj["status"].get("message"), dict):
        target = obj["status"]["message"]
    ex = list(target.get("extensions") or [])
    if EXT_URI not in ex:
        ex.append(EXT_URI)
    target["extensions"] = ex
    return result


def _get_json(url, fetch=None):
    if fetch:
        return fetch(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


def preflight(agent_origin, fetch=None, gate=GATE):
    """Before delegating work: read the agent's card, who it says pays it, and the register's reading for each
    measured endpoint. Counts and pointers, never a score; the register answers verified only when the latest
    scheduled measurement passed, and null (not false) in every other case."""
    origin = agent_origin.rstrip("/")
    st, card = _get_json(origin + "/.well-known/agent-card.json", fetch)
    out = {"agent": origin, "card_status": st, "extension_declared": False, "compensation": None,
           "measured_endpoints": [], "register": [], "witness_intake": None,
           "does_not_establish": ["that the agent is trustworthy or competent", "that the compensation declaration is true",
                                  "that the agent behaves now as it did when measured"]}
    if not isinstance(card, dict):
        return out
    exts = ((card.get("capabilities") or {}).get("extensions")) or []
    ext = next((e for e in exts if isinstance(e, dict) and e.get("uri") in EXT_URIS), None)
    params = (ext or {}).get("params") or {}
    out["extension_declared"] = ext is not None
    out["compensation"] = params.get("compensation") or card.get("compensation")
    out["measured_endpoints"] = [u for u in (params.get("measured_endpoints") or []) if isinstance(u, str)]
    out["witness_intake"] = params.get("witness_intake")
    for ep in out["measured_endpoints"][:5]:
        s, r = _get_json(gate + "/is-verified?endpoint=" + urllib.parse.quote(ep, safe=""), fetch)
        r = r if isinstance(r, dict) else {}
        out["register"].append({"endpoint": ep, "http": s, "state": r.get("state"), "verified": r.get("verified"),
                                "record_url": r.get("record_url"), "history_url": r.get("history_url")})
    return out


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        sys.exit("usage: python3 -m a2a_conduct https://agent.example   (preflight: card, who pays it, register reading)")
    print(json.dumps(preflight(sys.argv[1]), indent=2, ensure_ascii=False))
