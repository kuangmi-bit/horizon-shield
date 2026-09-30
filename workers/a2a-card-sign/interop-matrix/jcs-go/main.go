// Reads JSON on stdin, prints its RFC 8785 form as hex, using gowebpki/jcs. Second oracle for vectors.py.
package main

import (
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"github.com/gowebpki/jcs"
)

func main() {
	b, _ := io.ReadAll(os.Stdin)
	out, err := jcs.Transform(b)
	if err != nil {
		fmt.Println("ERR", err)
		os.Exit(1)
	}
	fmt.Println(hex.EncodeToString(out))
}
