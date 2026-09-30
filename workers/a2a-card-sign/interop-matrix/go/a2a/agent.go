package a2a

// AgentCardSignature mirrors the upstream a2a.AgentCardSignature JSON shape (a2a-go a2a/agent.go).
type AgentCardSignature struct {
	Header    map[string]any `json:"header,omitempty"`
	Protected string         `json:"protected"`
	Signature string         `json:"signature"`
}
