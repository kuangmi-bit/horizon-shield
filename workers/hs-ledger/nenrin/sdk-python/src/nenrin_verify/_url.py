"""`new URL(s).host` as the WHATWG URL Standard defines it, for the inputs the TSUGI verifier hands it.

tsugi_verify.mjs reads a host in three places (a witness's key_url, a pool entry's key_url, and the endpoint a
segment is about) with `new URL(s).host`, and compares or prints the result. Python's urllib does not parse URLs the
way the WHATWG standard does (it keeps backslashes, does not skip extra slashes after "https:", does not turn
"0x7f.1" into 127.0.0.1), so this file follows the standard's state machine for what it covers:

  - any scheme; a string with no valid scheme fails, as `new URL` does without a base
  - special schemes http, https, ws, wss, ftp: slashes and backslashes after the colon skipped, userinfo dropped,
    the port checked and dropped when it is the default, the host percent-decoded, lowercased and checked for
    forbidden code points, and a host that ends in a number parsed as IPv4 and written in dotted decimal
  - other schemes: no "//" means no host; with "//" the host is opaque (forbidden code points refused, the rest
    percent-encoded as the C0 control set says)

It raises NotReproduced, rather than guess, for what it does not cover: the file scheme, IPv6 literals ("["), and a
special-scheme host that is not ASCII after percent-decoding or has a label starting "xn--" (both need UTS #46,
whose tables differ between Unicode versions anyway). tests/test_tsugi_semantics_live.py holds the covered part to
Node's URL on several thousand strings.
"""
import re

from ._js import NotReproduced


class URLFailure(ValueError):
    """Where `new URL(s)` throws TypeError: Invalid URL."""


_SPECIAL_PORT = {"http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21}
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:")
_FORBIDDEN_HOST = set("\x00\t\n\r #/:<>?@[\\]^|")
_FORBIDDEN_DOMAIN = _FORBIDDEN_HOST | set(chr(c) for c in range(0x20)) | {"%", "\x7f"}
_HEX = "0123456789abcdefABCDEF"


def _usv(s):
    return re.sub("[\ud800-\udfff]", "�", s)


def _percent_decode(s):
    out, i, b = bytearray(), 0, s.encode("utf-8")
    while i < len(b):
        if b[i] == 0x25 and i + 2 < len(b) and chr(b[i + 1]) in _HEX and chr(b[i + 2]) in _HEX:
            out.append(int(b[i + 1:i + 3], 16))
            i += 3
        else:
            out.append(b[i])
            i += 1
    return bytes(out)


def _ipv4_number(s):
    if s == "":
        return None
    radix = 10
    if len(s) >= 2 and s[:2] in ("0x", "0X"):
        s, radix = s[2:], 16
    elif len(s) >= 2 and s[0] == "0":
        s, radix = s[1:], 8
    if s == "":
        return 0
    ok = {10: "0123456789", 8: "01234567", 16: _HEX}[radix]
    if any(c not in ok for c in s):
        return None
    return int(s, radix)


def _ends_in_number(domain):
    parts = domain.split(".")
    if parts[-1] == "":
        if len(parts) == 1:
            return False
        parts.pop()
    last = parts[-1]
    if last != "" and all(c in "0123456789" for c in last):
        return True
    return _ipv4_number(last) is not None


def _ipv4(domain):
    parts = domain.split(".")
    if parts[-1] == "" and len(parts) > 1:
        parts.pop()
    if len(parts) > 4:
        raise URLFailure("ipv4: too many parts")
    nums = []
    for p in parts:
        n = _ipv4_number(p)
        if n is None:
            raise URLFailure("ipv4: not a number")
        nums.append(n)
    if any(n > 255 for n in nums[:-1]):
        raise URLFailure("ipv4: part out of range")
    if nums[-1] >= 256 ** (5 - len(nums)):
        raise URLFailure("ipv4: last part out of range")
    v = nums[-1]
    for i, n in enumerate(nums[:-1]):
        v += n * 256 ** (3 - i)
    return ".".join(str((v >> s) & 255) for s in (24, 16, 8, 0))


def _domain(buf):
    try:
        text = _percent_decode(buf).decode("utf-8")
    except UnicodeDecodeError:
        raise NotReproduced("URL host that is not UTF-8 after percent-decoding")
    if not all(ord(c) < 0x80 for c in text):
        raise NotReproduced("URL host outside ASCII (needs UTS #46)")
    text = text.lower()
    if any(label.startswith("xn--") for label in text.split(".")):
        raise NotReproduced("URL host with an xn-- label (needs UTS #46)")
    if text == "" or any(c in _FORBIDDEN_DOMAIN for c in text):
        raise URLFailure("forbidden domain code point")
    if _ends_in_number(text):
        return _ipv4(text)
    return text


def _opaque(buf):
    if any(c in _FORBIDDEN_HOST for c in buf):
        raise URLFailure("forbidden host code point")
    out = []
    for c in buf:
        if ord(c) < 0x20 or ord(c) > 0x7E:
            out.append("".join("%%%02X" % b for b in c.encode("utf-8")))
        else:
            out.append(c)
    return "".join(out)


def url_host(s):
    """new URL(s).host, or URLFailure where `new URL(s)` throws."""
    s = _usv(s)
    i, j = 0, len(s)
    while i < j and ord(s[i]) <= 0x20:
        i += 1
    while j > i and ord(s[j - 1]) <= 0x20:
        j -= 1
    s = re.sub("[\t\n\r]", "", s[i:j])
    m = _SCHEME.match(s)
    if not m:
        raise URLFailure("no scheme")
    scheme, rest = m.group()[:-1].lower(), s[m.end():]
    if scheme == "file":
        raise NotReproduced("file URL host")
    special = scheme in _SPECIAL_PORT
    if special:
        rest = rest.lstrip("/\\")
        delims = "/?#\\"
    else:
        if not rest.startswith("//"):
            return ""
        rest = rest[2:]
        delims = "/?#"
    end = len(rest)
    for k, c in enumerate(rest):
        if c in delims:
            end = k
            break
    auth = rest[:end]
    at = auth.rfind("@")
    hostport = auth[at + 1:] if at >= 0 else auth
    if at >= 0 and hostport == "":
        raise URLFailure("host missing after credentials")
    if "[" in hostport:
        raise NotReproduced("IPv6 URL host")
    colon = hostport.find(":")
    if colon >= 0:
        buf, port_s = hostport[:colon], hostport[colon + 1:]
        if buf == "":
            raise URLFailure("host missing before port")
    else:
        buf, port_s = hostport, None
        if special and buf == "":
            raise URLFailure("host missing")
    port = None
    if port_s:
        if not all(c in "0123456789" for c in port_s):
            raise URLFailure("port is not digits")
        port = int(port_s)
        if port > 65535:
            raise URLFailure("port out of range")
        if special and port == _SPECIAL_PORT[scheme]:
            port = None
    host = _domain(buf) if special else _opaque(buf)
    return host if port is None else host + ":" + str(port)
