# trace-span-v0

Does an exported OpenTelemetry span name exactly the records of a bound nenrin-trace-bind-v0 record? 16 cases built from [trace-bind-v0](../trace-bind-v0)'s bundles by `gen_fixtures.mjs`. A case is `{"span": <attributes>, "bind_bundle": <bundle>}`. The rule is section 7 of [../trace-bind-v0/SPEC.md](../trace-bind-v0/SPEC.md).
