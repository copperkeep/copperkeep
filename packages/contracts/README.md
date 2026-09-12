# @copperkeep/contracts

Shared types: the `LanguageRuntime` interface, the content schema, and the API's wire
format.

## Licensed Apache-2.0, deliberately

The rest of Copperkeep is AGPL-3.0. **This package is not**, and the boundary is the
point: this is what somebody implements to add a language, and a copyleft licence on an
interface discourages exactly the ecosystem the runtime adapter design exists to enable.

Write a Go, Ruby or Lua adapter against these types under whatever licence you like.

Keep the carve-out narrow — interface and schema only, never implementation. Anything
with behaviour in it belongs on the AGPL side of the line. See
[`docs/adr/0009-licence.md`](../../docs/adr/0009-licence.md).
