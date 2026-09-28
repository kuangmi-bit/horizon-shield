// cardcheck: verify a served A2A AgentCard's JWS signatures with the a2acrypto package of
// a2aproject/a2a-go v2.6.0 (RFC 8785 canonicalization, key resolved from the jku JWKS),
// and print the SHA-256 of the canonical bytes so the JS side can be compared byte for byte.
//
//	go run . card.json [trusted_jwks_url]
//	go run . card.json "" jwks.json          (offline: the JWKS bytes come from the file)
//
// Exit 0 when at least one signature verifies, 1 otherwise. Every signature is reported.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"hs.local/cardcheck/a2a"
	"hs.local/cardcheck/a2acrypto"
)

func hexsha(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run . <card.json> [trusted_jwks_url]")
		os.Exit(2)
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Println("read:", err)
		os.Exit(2)
	}
	var card struct {
		Name       string                   `json:"name"`
		Version    string                   `json:"version"`
		Signatures []a2a.AgentCardSignature `json:"signatures"`
	}
	if err := json.Unmarshal(raw, &card); err != nil {
		fmt.Println("parse:", err)
		os.Exit(2)
	}
	canon, err := a2acrypto.CanonicalJSON(raw)
	if err != nil {
		fmt.Println("canonicalize:", err)
		os.Exit(2)
	}
	fmt.Printf("card=%q version=%s served_bytes=%d served_sha256=%s\n", card.Name, card.Version, len(raw), hexsha(raw))
	fmt.Printf("go_canonical_bytes=%d go_canonical_sha256=%s\n", len(canon), hexsha(canon))
	trusted := []string{"https://gate.horizonshield.dev/.well-known/jwks.json"}
	if len(os.Args) > 2 && os.Args[2] != "" {
		trusted = []string{os.Args[2]}
	}
	// 2026-09-28. Every run now prints the sha256 of the JWKS bytes the key was resolved from, so a result names
	// the card bytes, the key-set bytes and the verifier together. With a third argument the JWKS is read from that
	// file instead of the network (offline: the resolver still asks for the trusted URL, and only that URL is
	// answered, from the file).
	jt := &jwksTap{url: trusted[0]}
	if len(os.Args) > 3 {
		b, err := os.ReadFile(os.Args[3])
		if err != nil {
			fmt.Println("read jwks:", err)
			os.Exit(2)
		}
		jt.file, jt.fileBytes = os.Args[3], b
	}
	kr := a2acrypto.NewJWKSKeyResolver(&http.Client{Timeout: 20 * time.Second, Transport: jt}, trusted)
	v := a2acrypto.NewVerifier(a2acrypto.VerifierConfig{KeyResolver: kr})
	ctx := context.Background()
	pass := 0
	for i := range card.Signatures {
		if err := v.Verify(ctx, json.RawMessage(raw), &card.Signatures[i]); err != nil {
			fmt.Printf("signature[%d]: FAIL %v\n", i, err)
		} else {
			pass++
			fmt.Printf("signature[%d]: PASS\n", i)
		}
	}
	src := "network " + jt.url
	if jt.file != "" {
		src = "file " + jt.file + " (served as " + jt.url + ")"
	}
	fmt.Printf("jwks_source=%s jwks_bytes=%d jwks_sha256=%s\n", src, len(jt.seen), hexsha(jt.seen))
	fmt.Printf("result: %d of %d signatures verify under a2a-go v2.6.0 a2acrypto\n", pass, len(card.Signatures))
	if pass == 0 {
		os.Exit(1)
	}
}

// jwksTap answers the JWKS request (from a file when one is given) and keeps the bytes the resolver received.
type jwksTap struct {
	url       string
	file      string
	fileBytes []byte
	seen      []byte
}

func (t *jwksTap) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.file != "" {
		if req.URL.String() != t.url {
			return nil, fmt.Errorf("offline: refusing %s (only %s is served, from %s)", req.URL, t.url, t.file)
		}
		t.seen = t.fileBytes
		return &http.Response{StatusCode: 200, Status: "200 OK", Header: http.Header{"Content-Type": {"application/json"}},
			Body: io.NopCloser(bytes.NewReader(t.fileBytes)), ContentLength: int64(len(t.fileBytes)), Request: req}, nil
	}
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	b, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		return nil, err
	}
	t.seen = b
	res.Body = io.NopCloser(bytes.NewReader(b))
	return res, nil
}
