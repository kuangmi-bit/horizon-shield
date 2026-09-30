package a2acrypto

// CanonicalForTest exposes the upstream canonicalizer so the matrix can print the bytes it signs over.
// Not upstream code; the rest of this package is copied verbatim apart from one import path.
func CanonicalForTest(raw []byte) ([]byte, error) { return canonicalizeJSON(raw) }
