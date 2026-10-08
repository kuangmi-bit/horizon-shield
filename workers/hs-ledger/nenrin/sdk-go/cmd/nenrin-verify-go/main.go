// nenrin-verify-go verifies NENRIN provenance bundles offline, with no trust in the operator.
//
//	nenrin-verify-go bundle.json            print the report, exit 0 if accepted, 1 if refused, 2 on an input error
//	nenrin-verify-go --corpus <dir>         reproduce every verdict signature in <dir>/expected.json from <dir>/fixtures
//	nenrin-verify-go --batch in.json out.json
//	                                        in: [{"name", "bundle"}, ...]; out: {name: signature or {"error"}}
//	                                        (the form conformance-v0/differential.py reads)
//	nenrin-verify-go --lines                one bundle per line (JSON text) on stdin, one result per line on stdout:
//	                                        {"threw", "signature", "codes"} (the form parity/parity.py reads)
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	nv "github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/nenrinverify"
)

func readJSON(path string) (nv.Value, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return nv.ParseJSON(b)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: nenrin-verify-go <bundle.json> | --corpus <dir> | --batch <in.json> <out.json> | --version")
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "--version":
		fmt.Printf("nenrin-verify-go %s (reproduces verifier_version %s)\n", nv.PortVersion, nv.VerifierVersion)
	case "--corpus":
		if len(os.Args) != 3 {
			usage()
		}
		os.Exit(corpus(os.Args[2]))
	case "--lines":
		os.Exit(lines())
	case "--batch":
		if len(os.Args) != 4 {
			usage()
		}
		os.Exit(batch(os.Args[2], os.Args[3]))
	default:
		v, err := readJSON(os.Args[1])
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		rep, err := nv.VerifyBundle(v)
		if err != nil {
			fmt.Fprintln(os.Stderr, "the reference verifier throws on this input:", err)
			os.Exit(2)
		}
		out, _ := json.MarshalIndent(struct {
			*nv.Report
			Signature nv.Signature `json:"verdict_signature"`
		}{rep, rep.Signature()}, "", "  ")
		fmt.Println(string(out))
		if rep.Verdict != "accepted" {
			os.Exit(1)
		}
	}
}

type expected struct {
	Cases map[string]struct {
		Expect nv.Signature `json:"expect"`
	} `json:"cases"`
}

func corpus(dir string) int {
	b, err := os.ReadFile(filepath.Join(dir, "expected.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	var exp expected
	if err := json.Unmarshal(b, &exp); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	names := make([]string, 0, len(exp.Cases))
	for n := range exp.Cases {
		names = append(names, n)
	}
	sort.Strings(names)
	ok := 0
	for _, n := range names {
		want := exp.Cases[n].Expect
		if want.Refusals == nil {
			want.Refusals = []string{}
		}
		if want.Findings == nil {
			want.Findings = []string{}
		}
		v, err := readJSON(filepath.Join(dir, "fixtures", n+".json"))
		var got nv.Signature
		var gerr error
		if err != nil {
			gerr = err
		} else {
			rep, err := nv.VerifyBundle(v)
			if err != nil {
				gerr = err
			} else {
				got = rep.Signature()
			}
		}
		wj, _ := json.Marshal(want)
		gj, _ := json.Marshal(got)
		if gerr == nil && string(wj) == string(gj) {
			ok++
			fmt.Printf("PASS %s %s\n", n, gj)
		} else if gerr != nil {
			fmt.Printf("FAIL %s error: %v\n  want %s\n", n, gerr, wj)
		} else {
			fmt.Printf("FAIL %s\n  want %s\n  got  %s\n", n, wj, gj)
		}
	}
	fmt.Printf("%d/%d verdict signatures reproduced (nenrin-verify-go %s, %s)\n", ok, len(names), nv.PortVersion, dir)
	if ok != len(names) {
		return 1
	}
	return 0
}

func batch(in, out string) int {
	v, err := readJSON(in)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	arr, ok := v.(*nv.Array)
	if !ok {
		fmt.Fprintln(os.Stderr, "batch input must be an array of {name, bundle}")
		return 2
	}
	res := map[string]interface{}{}
	for _, it := range arr.Items {
		o, ok := it.(*nv.Object)
		if !ok {
			continue
		}
		name, _ := nv.Get(o, "name").(string)
		rep, err := nv.VerifyBundle(nv.Get(o, "bundle"))
		if err != nil {
			res[name] = map[string]string{"error": err.Error()}
		} else {
			res[name] = rep.Signature()
		}
	}
	b, _ := json.Marshal(res)
	if err := os.WriteFile(out, b, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return 0
}

type lineResult struct {
	Threw     bool          `json:"threw"`
	Error     string        `json:"error,omitempty"`
	Signature *nv.Signature `json:"signature,omitempty"`
	Codes     []nv.Code     `json:"codes,omitempty"`
}

func lines() int {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for _, line := range bytes.Split(data, []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var r lineResult
		v, err := nv.ParseJSON(line)
		if err == nil {
			var rep *nv.Report
			rep, err = nv.VerifyBundle(v)
			if err == nil {
				s := rep.Signature()
				r.Signature, r.Codes = &s, rep.Refusals
			}
		}
		if err != nil {
			r = lineResult{Threw: true, Error: err.Error()}
		}
		b, _ := json.Marshal(r)
		w.Write(b)
		w.WriteByte('\n')
	}
	return 0
}
