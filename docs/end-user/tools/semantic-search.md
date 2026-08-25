# Semantic Documentation Search

The [`search_documentation`](README.md#search_documentation) tool can return results ranked by **meaning**, not just keyword overlap. When semantic search is enabled on the server you are connected to, a query like "how do I change the encryption secret for the cache" can surface the guide on rotating the cache secure data key even though the wording differs.

This is a paid/private tier capability. It is available to eligible tiers when the server operator has enabled it, and it is transparent: you keep using the same `search_documentation` tool.

## What you need to know

- **Same tool, same response.** You call `search_documentation` exactly as before. Every result has the same fields (title, excerpt, file path, GitHub URL, type, relevance score, and so on), so nothing in your AI assistant or client needs to change.
- **Same filters.** The `type`, `subType`, and `ghusers` filters work the same way for semantically-ranked results as they do for keyword results.
- **Better matches for natural-language queries.** You can describe what you want in your own words instead of guessing the exact keywords used in the docs.
- **Automatic fallback.** If semantic search is unavailable for any reason, the server automatically falls back to keyword search and still returns a valid response — you never see an error from this.

## Availability by tier

Semantic search is offered to the **paid** and **private** tiers by default. Lower tiers (public and registered) continue to receive keyword search results in the identical response shape. If your server is running the default public configuration, semantic search may be off entirely and all tiers receive keyword search.

To find out whether it is available to you, or to unlock higher tiers, see the [rate limits page](https://mcp.atlantis.63klabs.net/docs/rate-limits/) or [register for an account](https://mcp.atlantis.63klabs.net/register/).

## Example

```
Ask your AI: "Search the Atlantis docs for how to rotate the cache encryption key"
```

You receive the usual `search_documentation` results, ranked by how closely each document matches the intent of your query.

## Related documentation

- [MCP Tools Reference](README.md) — full `search_documentation` parameters and examples
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting](../troubleshooting/README.md)
