// Tracer name for every custom span this codebase creates via @fsarch/server's tracing
// helpers (withSpan/@Span) - kept distinct from the default "fsarch" tracer name those
// helpers otherwise fall back to, so this service's own spans are easy to pick out in a
// trace UI from generic auto-instrumentation spans (HTTP/Express/Postgres/Nest) and from
// other fsarch-based services' custom spans.
//
// Tracing itself is configured entirely via config.yaml's `tracing:` block (see
// config.example.yaml) - disabled by default. withSpan()/@Span() are safe to leave in
// place unconditionally either way: against a disabled/uninitialized SDK they run
// against OpenTelemetry's no-op tracer (negligible overhead, no data produced).
// Auto-instrumentation (generic HTTP/Postgres spans) additionally requires launching
// the process with `--import @fsarch/server/register` (see Dockerfile) - manual spans
// created here do not, since FsArchAppBuilder.build() initializes the SDK itself.
export const TRACER_NAME = "tile-render-server";
