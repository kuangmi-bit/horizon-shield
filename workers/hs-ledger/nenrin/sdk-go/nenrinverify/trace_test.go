package nenrinverify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// The two TRACE corpora, from the repository: every verdict signature reproduced.
func TestTraceCorpora(t *testing.T) {
	span := func(b Value) (Signature, error) {
		o := b.(*Object)
		return CheckSpanAttributes(Get(o, "span"), Get(o, "bind_bundle"))
	}
	for name, fn := range map[string]func(Value) (Signature, error){"trace-intake-v0": VerifyTraceIntake, "trace-bind-v0": VerifyTraceBind, "trace-span-v0": span} {
		dir := filepath.Join("..", "..", name)
		b, err := os.ReadFile(filepath.Join(dir, "expected.json"))
		if err != nil {
			t.Fatal(err)
		}
		var exp struct {
			Cases map[string]struct{ Expect Signature } `json:"cases"`
		}
		if err := json.Unmarshal(b, &exp); err != nil {
			t.Fatal(err)
		}
		names := make([]string, 0, len(exp.Cases))
		for n := range exp.Cases {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			raw, err := os.ReadFile(filepath.Join(dir, "fixtures", n+".json"))
			if err != nil {
				t.Fatal(err)
			}
			v, err := ParseJSON(raw)
			if err != nil {
				t.Fatalf("%s/%s: %v", name, n, err)
			}
			got, err := fn(v)
			if err != nil {
				t.Errorf("%s/%s: %v", name, n, err)
				continue
			}
			want := exp.Cases[n].Expect
			if want.Refusals == nil {
				want.Refusals = []string{}
			}
			if want.Findings == nil {
				want.Findings = []string{}
			}
			gj, _ := json.Marshal(got)
			wj, _ := json.Marshal(want)
			if string(gj) != string(wj) {
				t.Errorf("%s/%s\n  want %s\n  got  %s", name, n, wj, gj)
			}
		}
		t.Logf("%s: %d cases", name, len(names))
	}
}
