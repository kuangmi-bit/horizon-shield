package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"

	"hs.local/interop/a2a"
	"hs.local/interop/a2acrypto"
)

type fileTransport struct{ body []byte }

func (t fileTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Status: "200 OK", Body: io.NopCloser(bytes.NewReader(t.body)), Header: http.Header{}, Request: r}, nil
}

func out(v any) { b, _ := json.Marshal(v); fmt.Println(string(b)) }

func main() {
	ctx := context.Background()
	switch os.Args[1] {
	case "sign": // sign <card.json> <key.pem> <kid> <jku>
		raw, _ := os.ReadFile(os.Args[2])
		pb, _ := os.ReadFile(os.Args[3])
		blk, _ := pem.Decode(pb)
		k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
		if err != nil {
			out(map[string]any{"error": err.Error()})
			return
		}
		s, err := a2acrypto.NewSigner(a2acrypto.SignerConfig{PrivateKey: k.(*ecdsa.PrivateKey), KeyID: os.Args[4], Algorithm: "ES256", JWKSURL: os.Args[5]})
		if err != nil {
			out(map[string]any{"error": err.Error()})
			return
		}
		sig, err := s.Sign(ctx, raw)
		if err != nil {
			out(map[string]any{"error": err.Error()})
			return
		}
		c, _ := a2acrypto.CanonicalForTest(raw)
		h := sha256.Sum256(c)
		out(map[string]any{"signature": sig, "canonical_len": len(c), "canonical_sha256": hex.EncodeToString(h[:])})
	case "canon": // canon <card.json>
		raw, _ := os.ReadFile(os.Args[2])
		c, err := a2acrypto.CanonicalForTest(raw)
		if err != nil {
			out(map[string]any{"error": err.Error()})
			return
		}
		out(map[string]any{"text": string(c)})
	case "verify": // verify <signed_card.json> <jwks.json>
		raw, _ := os.ReadFile(os.Args[2])
		jw, _ := os.ReadFile(os.Args[3])
		var card struct {
			Signatures []a2a.AgentCardSignature `json:"signatures"`
		}
		_ = json.Unmarshal(raw, &card)
		allow := []string{}
		for _, sg := range card.Signatures {
			hb, _ := base64.RawURLEncoding.DecodeString(sg.Protected)
			var ph map[string]any
			_ = json.Unmarshal(hb, &ph)
			if j, ok := ph["jku"].(string); ok {
				allow = append(allow, j)
			}
		}
		kr := a2acrypto.NewJWKSKeyResolver(&http.Client{Transport: fileTransport{jw}}, allow)
		v := a2acrypto.NewVerifier(a2acrypto.VerifierConfig{KeyResolver: kr})
		c, _ := a2acrypto.CanonicalForTest(raw)
		h := sha256.Sum256(c)
		res := []any{}
		ok := false
		for i := range card.Signatures {
			err := v.Verify(ctx, raw, &card.Signatures[i])
			res = append(res, map[string]any{"index": i, "ok": err == nil, "error": fmt.Sprint(err)})
			if err == nil {
				ok = true
			}
		}
		out(map[string]any{"ok": ok, "per_signature": res, "canonical_len": len(c), "canonical_sha256": hex.EncodeToString(h[:])})
	}
}
