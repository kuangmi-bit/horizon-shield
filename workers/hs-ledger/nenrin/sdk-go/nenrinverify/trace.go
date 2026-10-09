package nenrinverify

// TRACE intake and the nenrin-trace-bind-v0 link: the Go port of sdk/trace_verify.mjs. The normative text is
// workers/hs-ledger/nenrin/trace-bind-v0/SPEC.md; the JavaScript file is the reference, and the corpora
// trace-intake-v0 (the TRACE conformance vectors) and trace-bind-v0 hold this port to it.

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math"
	"regexp"
	"sort"
	"strings"
)

const (
	TraceProfileV02     = "tag:agentrust-io.com,2026:trace-v0.2"
	TraceProfileV01     = "tag:agentrust.io,2026:trace-v0.1"
	traceMaxRecordBytes = 65536
	traceFutureSkew     = 300
	traceDefaultMaxAge  = 86400
	BindSchema          = "nenrin-trace-bind-v0"
	bindContext         = "nenrin-trace-bind-v0\n"
	traceMaxDepth       = 64
)

var traceRequired = []string{"eat_profile", "iat", "subject", "model", "runtime", "policy", "data_class", "build_provenance", "appraisal", "cnf"}
var bindKeys = []string{"acted_at", "binder_public_key_ed25519_b64", "record_sha256", "relation", "schema", "sig_b64", "trace_key_thumbprint", "trace_sha256"}
var bindFindings = []string{"acted_at_is_stated", "trace_claims_not_appraised"}

// TraceRefusal is a refusal code of SPEC.md sections 1 and 2.
type TraceRefusal struct{ Code string }

func (r *TraceRefusal) Error() string { return r.Code }

func refuse(code string) { panic(&TraceRefusal{code}) }

func hasSurrogate(s string) bool {
	for _, r := range decodeWTF8(s) {
		if r >= 0xD800 && r <= 0xDFFF {
			return true
		}
	}
	return false
}

func lessUTF16(a, b string) bool {
	x, y := utf16Units(a), utf16Units(b)
	for i := 0; i < len(x) && i < len(y); i++ {
		if x[i] != y[i] {
			return x[i] < y[i]
		}
	}
	return len(x) < len(y)
}

func isInteger(v Value) bool {
	f, ok := v.(float64)
	return ok && !math.IsInf(f, 0) && !math.IsNaN(f) && f == math.Trunc(f)
}

func jcsWrite(b *strings.Builder, v Value, depth int) {
	if depth > traceMaxDepth {
		refuse("too_deep")
	}
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		if math.IsInf(x, 0) || math.IsNaN(x) {
			refuse("non_finite_number")
		}
		if x == math.Trunc(x) && math.Abs(x) > maxSafe {
			refuse("unsafe_integer")
		}
		b.WriteString(numStr(x))
	case string:
		if hasSurrogate(x) {
			refuse("lone_surrogate")
		}
		b.WriteString(quote(x))
	case *Array:
		b.WriteByte('[')
		for i, it := range x.Items {
			if i > 0 {
				b.WriteByte(',')
			}
			jcsWrite(b, it, depth+1)
		}
		b.WriteByte(']')
	case *Object:
		keys := append([]string(nil), x.Keys()...)
		sort.SliceStable(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		b.WriteByte('{')
		for i, k := range keys {
			if hasSurrogate(k) {
				refuse("lone_surrogate")
			}
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(quote(k))
			b.WriteByte(':')
			jcsWrite(b, x.vals[k], depth+1)
		}
		b.WriteByte('}')
	default:
		refuse("not_json")
	}
}

func catchRefusal(err *error) {
	if r := recover(); r != nil {
		if tr, ok := r.(*TraceRefusal); ok {
			*err = tr
			return
		}
		panic(r)
	}
}

// JCS returns the RFC 8785 form of v, or the *TraceRefusal of SPEC.md section 1.
func JCS(v Value) (s string, err error) {
	defer catchRefusal(&err)
	var b strings.Builder
	jcsWrite(&b, v, 0)
	return b.String(), nil
}

func jcsMust(v Value) string {
	var b strings.Builder
	jcsWrite(&b, v, 0)
	return b.String()
}

var reB64URL = regexp.MustCompile(`^[A-Za-z0-9_-]*$`)
var reB64Std = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
var reHex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
var reThumb = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func b64urlCanonical(v Value) []byte {
	s, ok := v.(string)
	if !ok || !reB64URL.MatchString(s) || len(s)%4 == 1 {
		return nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		// RawURLEncoding is strict about the unused bits; a non-canonical last character is refused as non-canonical.
		return nil
	}
	if base64.RawURLEncoding.EncodeToString(b) != s {
		return nil
	}
	return b
}

func b64StdCanonical(v Value) []byte {
	s, ok := v.(string)
	if !ok || !reB64Std.MatchString(s) || len(s)%4 != 0 {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || base64.StdEncoding.EncodeToString(b) != s {
		return nil
	}
	return b
}

func traceSHA(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func jwkThumb(jwk *Object) string {
	m := `{"crv":` + quote(Get(jwk, "crv").(string)) + `,"kty":` + quote(Get(jwk, "kty").(string)) + `,"x":` + quote(Get(jwk, "x").(string)) + `}`
	h := sha256.Sum256([]byte(m))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func traceOwn(o *Object, k string) bool { _, ok := o.own(k); return ok }

func traceStrEq(v Value, s string) bool { x, ok := v.(string); return ok && x == s }

// TraceRecordInfo is what a pinnable record yields.
type TraceRecordInfo struct {
	SHA           string
	KeyThumbprint string
	Iat           float64
}

// CheckTraceRecord is SPEC.md section 2 at time now: a *TraceRefusal, or the record's pin identity and key.
func CheckTraceRecord(R Value, now float64) (info TraceRecordInfo, err error) {
	defer catchRefusal(&err)
	o, ok := R.(*Object)
	if !ok {
		refuse("record_not_object")
	}
	rj := jcsMust(o)
	if len(rj) > traceMaxRecordBytes {
		refuse("too_large")
	}
	if traceOwn(o, "cmcp_version") && traceOwn(o, "trace") && !traceOwn(o, "eat_profile") {
		refuse("enveloped_form")
	}
	prof := Get(o, "eat_profile")
	if traceStrEq(prof, TraceProfileV01) {
		refuse("superseded_profile")
	}
	if !traceStrEq(prof, TraceProfileV02) {
		refuse("unsupported_profile")
	}
	for _, k := range traceRequired {
		if !traceOwn(o, k) {
			refuse("missing_required")
		}
	}
	iat := Get(o, "iat")
	if !isInteger(iat) || iat.(float64) < 1700000000 {
		refuse("bad_iat")
	}
	if s, ok := Get(o, "subject").(string); !ok || s == "" {
		refuse("bad_subject")
	}
	if !traceOwn(o, "signature") {
		refuse("no_embedded_signature")
	}
	sig := b64urlCanonical(Get(o, "signature"))
	if sig == nil {
		refuse("bad_base64url")
	}
	if len(sig) != 64 {
		refuse("bad_signature_length")
	}
	var jwk *Object
	if cnf, ok := Get(o, "cnf").(*Object); ok {
		jwk, _ = Get(cnf, "jwk").(*Object)
	}
	if jwk == nil {
		refuse("no_confirmation_key")
	}
	if !traceStrEq(Get(jwk, "kty"), "OKP") || !traceStrEq(Get(jwk, "crv"), "Ed25519") {
		refuse("unsupported_key_type")
	}
	pub := b64urlCanonical(Get(jwk, "x"))
	if pub == nil {
		refuse("bad_base64url")
	}
	if len(pub) != 32 {
		refuse("bad_key_length")
	}
	body := newObject()
	for _, k := range o.Keys() {
		if k != "signature" {
			body.set(k, o.vals[k])
		}
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), []byte(jcsMust(body)), sig) {
		refuse("signature_invalid")
	}
	if iat.(float64) > now+traceFutureSkew {
		refuse("iat_in_future")
	}
	return TraceRecordInfo{SHA: traceSHA(rj), KeyThumbprint: jwkThumb(jwk), Iat: iat.(float64)}, nil
}

func unwrapVector(v Value) Value {
	if o, ok := v.(*Object); ok {
		if r, ok := Get(o, "record").(*Object); ok {
			return r
		}
	}
	return v
}

type traceInputError struct{ msg string }

func (e *traceInputError) Error() string { return e.msg }

// VerifyTraceIntake gives the verdict signature of an intake bundle {"now", "vector"}.
func VerifyTraceIntake(bundle Value) (Signature, error) {
	o, ok := bundle.(*Object)
	if !ok || !isInteger(Get(o, "now")) {
		return Signature{}, &traceInputError{`an intake bundle is {"now": <integer>, "vector": <value>}`}
	}
	_, err := CheckTraceRecord(unwrapVector(Get(o, "vector")), Get(o, "now").(float64))
	if err != nil {
		if tr, ok := err.(*TraceRefusal); ok {
			return Signature{Verdict: "refused", Refusals: []string{tr.Code}, Findings: []string{}}, nil
		}
		return Signature{}, err
	}
	return Signature{Verdict: "pinnable", Refusals: []string{}, Findings: []string{}}, nil
}

func traceStrList(v Value) ([]string, bool) {
	a, ok := v.(*Array)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(a.Items))
	for _, it := range a.Items {
		s, ok := it.(string)
		if !ok {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

func traceContains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// BindSigningBytes is the message a bind signature covers (SPEC.md section 3).
func BindSigningBytes(bind *Object) ([]byte, error) {
	body := newObject()
	for _, k := range bind.Keys() {
		if k != "sig_b64" {
			body.set(k, bind.vals[k])
		}
	}
	s, err := JCS(body)
	if err != nil {
		return nil, err
	}
	return []byte(bindContext + s), nil
}

// VerifyTraceBind gives the verdict signature of a bind bundle {"bind", "trace", "record", "policy"} (SPEC.md section 4).
func VerifyTraceBind(bundle Value) (Signature, error) {
	o, ok := bundle.(*Object)
	objs := map[string]*Object{}
	if ok {
		for _, k := range []string{"bind", "trace", "record", "policy"} {
			if x, ok := Get(o, k).(*Object); ok {
				objs[k] = x
			}
		}
	}
	if len(objs) != 4 {
		return Signature{}, &traceInputError{`a bind bundle is {"bind", "trace", "record", "policy"}, each an object`}
	}
	bind, trace, record, policy := objs["bind"], objs["trace"], objs["record"], objs["policy"]
	stop := func(code string) (Signature, error) {
		return Signature{Verdict: "not_bound", Refusals: []string{code}, Findings: append([]string(nil), bindFindings...)}, nil
	}
	for _, v := range []*Object{bind, trace, record} {
		if _, err := JCS(v); err != nil {
			return stop(err.(*TraceRefusal).Code)
		}
	}
	binderKeys, ok1 := traceStrList(Get(policy, "binder_keys"))
	thumbs, ok2 := traceStrList(Get(policy, "trace_key_thumbprints"))
	var maxAge Value = float64(traceDefaultMaxAge)
	if traceOwn(policy, "max_age_seconds") {
		maxAge = Get(policy, "max_age_seconds")
	}
	if !ok1 || !ok2 || !isInteger(maxAge) || maxAge.(float64) < 0 || maxAge.(float64) > 31536000 {
		return stop("policy_malformed")
	}
	if !traceStrEq(Get(bind, "schema"), BindSchema) {
		return stop("bind_schema")
	}
	keys := append([]string(nil), bind.Keys()...)
	sort.Strings(keys)
	shapeOK := len(keys) == len(bindKeys)
	for i := 0; shapeOK && i < len(keys); i++ {
		shapeOK = keys[i] == bindKeys[i]
	}
	if shapeOK {
		rs, _ := Get(bind, "record_sha256").(string)
		ts, _ := Get(bind, "trace_sha256").(string)
		kt, _ := Get(bind, "trace_key_thumbprint").(string)
		at := Get(bind, "acted_at")
		shapeOK = traceStrEq(Get(bind, "relation"), "performed_under") && reHex64.MatchString(rs) && reHex64.MatchString(ts) &&
			reThumb.MatchString(kt) && isInteger(at) && at.(float64) >= 1700000000 && at.(float64) <= maxSafe
	}
	var key, sig []byte
	if shapeOK {
		key = b64StdCanonical(Get(bind, "binder_public_key_ed25519_b64"))
		sig = b64StdCanonical(Get(bind, "sig_b64"))
	}
	if !shapeOK || len(key) != 32 || len(sig) != 64 {
		return stop("bind_malformed")
	}
	actedAt := Get(bind, "acted_at").(float64)
	refusals := []string{}
	msg, _ := BindSigningBytes(bind)
	if !ed25519.Verify(ed25519.PublicKey(key), msg, sig) {
		refusals = append(refusals, "bind_signature_invalid")
	}
	if !traceContains(binderKeys, Get(bind, "binder_public_key_ed25519_b64").(string)) {
		refusals = append(refusals, "binder_not_pinned")
	}
	if traceSHA(jcsMust(record)) != Get(bind, "record_sha256").(string) {
		refusals = append(refusals, "record_sha_mismatch")
	}
	if traceSHA(jcsMust(trace)) != Get(bind, "trace_sha256").(string) {
		refusals = append(refusals, "trace_sha_mismatch")
	}
	info, err := CheckTraceRecord(trace, actedAt)
	if err != nil {
		refusals = append(refusals, "trace:"+err.(*TraceRefusal).Code)
	} else {
		if info.KeyThumbprint != Get(bind, "trace_key_thumbprint").(string) {
			refusals = append(refusals, "trace_key_thumbprint_mismatch")
		}
		if !traceContains(thumbs, info.KeyThumbprint) {
			refusals = append(refusals, "trace_key_not_pinned")
		}
		if actedAt-info.Iat > maxAge.(float64) {
			refusals = append(refusals, "trace_stale_at_act")
		}
	}
	sort.Strings(refusals)
	verdict := "bound"
	if len(refusals) > 0 {
		verdict = "not_bound"
	}
	return Signature{Verdict: verdict, Refusals: refusals, Findings: append([]string(nil), bindFindings...)}, nil
}

// ---- OpenTelemetry (SPEC.md section 7) ----

const OTelSchema = "nenrin-otel-v0"

var otelKeys = []string{"nenrin.otel.schema", "nenrin.bind.sha256", "nenrin.record.sha256", "nenrin.trace.sha256", "nenrin.trace.key_thumbprint"}

// SpanAttributes are the attributes to put on the agent's OpenTelemetry GenAI span (execute_tool / invoke_agent).
func SpanAttributes(bind *Object, ledgerOrigin string) (map[string]string, error) {
	if ledgerOrigin == "" {
		ledgerOrigin = "https://ledger.horizonshield.dev"
	}
	j, err := JCS(bind)
	if err != nil {
		return nil, err
	}
	str := func(k string) string { s, _ := Get(bind, k).(string); return s }
	return map[string]string{
		"nenrin.otel.schema":          OTelSchema,
		"nenrin.bind.sha256":          traceSHA(j),
		"nenrin.record.sha256":        str("record_sha256"),
		"nenrin.trace.sha256":         str("trace_sha256"),
		"nenrin.trace.key_thumbprint": str("trace_key_thumbprint"),
		"nenrin.trace.url":            ledgerOrigin + "/evidence/trace/" + str("trace_sha256"),
	}, nil
}

// CheckSpanAttributes: does an exported span name exactly the records of a bound bind bundle?
func CheckSpanAttributes(attrs Value, bundle Value) (Signature, error) {
	v, err := VerifyTraceBind(bundle)
	if err != nil {
		return Signature{}, err
	}
	bind := Get(bundle.(*Object), "bind").(*Object)
	want, werr := SpanAttributes(bind, "")
	a, _ := attrs.(*Object)
	refusals := append([]string{}, v.Refusals...)
	for _, k := range otelKeys {
		var got Value = Undefined
		if a != nil {
			got = Get(a, k)
		}
		gs, ok := got.(string)
		ws := ""
		if werr == nil {
			ws = want[k]
		}
		if !ok || werr != nil || !wantIsStr(bind, k) || gs != ws {
			refusals = append(refusals, "span_attribute_mismatch:"+k)
		}
	}
	sort.Strings(refusals)
	verdict := "span_bound"
	if len(refusals) > 0 {
		verdict = "span_not_bound"
	}
	return Signature{Verdict: verdict, Refusals: refusals, Findings: v.Findings}, nil
}

func traceIsStr(v Value) bool { _, ok := v.(string); return ok }

// wantIsStr mirrors the reference, where an identifier the bind does not carry as a string never matches.
func wantIsStr(bind *Object, k string) bool {
	switch k {
	case "nenrin.record.sha256":
		return traceIsStr(Get(bind, "record_sha256"))
	case "nenrin.trace.sha256":
		return traceIsStr(Get(bind, "trace_sha256"))
	case "nenrin.trace.key_thumbprint":
		return traceIsStr(Get(bind, "trace_key_thumbprint"))
	}
	return true
}
