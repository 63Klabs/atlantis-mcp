# SPEC Questions & Recommendations

## Questions

### Q1: Default behavior when namespace is omitted

Currently, when no namespace is specified, the model discovers all namespaces in each bucket (via `getIndexedNamespaces`) and iterates through all of them. The spec says the default namespace is `"atlantis"`.

Should the behavior when `namespace` is omitted be:

- **A) Filter to only `"atlantis"` namespace** (breaking change — currently returns templates from all namespaces)
- **B) Continue searching all namespaces** (current behavior preserved, `namespace` param only narrows when explicitly provided)
- **C) Use a configurable default** via environment variable (e.g., `ATLANTIS_DEFAULT_NAMESPACE=atlantis`) that controls the default, but when omitted searches all

**Recommendation**: Option B — keep backward compatibility. When `namespace` is provided, filter to that namespace only. When omitted, search all namespaces as today. This is non-breaking and follows the same pattern as `s3Buckets` (when omitted, searches all configured buckets).

---

### Q2: Should `check_template_updates` also get the namespace parameter?

The spec mentions three tools: `list_templates`, `list_template_versions`, and `get_template`. There's also a `check_template_updates` tool that searches templates by name and version. Should namespace be added there too for consistency?

- **A) Yes** — add namespace to `check_template_updates` as well
- **B) No** — only the three tools listed in the spec

**Recommendation**: Option A — it uses the same underlying service/model layer and would benefit from namespace filtering.

---

### Q3: Namespace validation — should it be an enum or a pattern?

The `category` field uses an enum (fixed list of allowed values). Namespace is more open-ended since users can create their own. The spec says it must be a valid S3 key segment.

- **A) Pattern-based validation** — regex like `^[a-z0-9][a-z0-9-]*$` (lowercase alphanumeric + hyphens, must start with alphanumeric)
- **B) Looser pattern** — `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` (also allows uppercase and underscores)
- **C) Very loose** — just disallow spaces, slashes, and special characters

**Recommendation**: Option A — lowercase alphanumeric with hyphens matches the examples in the spec (`atlantis`, `acme`, `xco`, `gigahut`, `turbo-kiln`) and aligns with S3 key best practices. Max length of 63 characters (matching S3 bucket name limits) seems reasonable.

---

### Q4: Should namespace be included in the cache key?

The service layer uses `conn.parameters` to build cache keys. Currently the parameters include `category`, `version`, `versionId`. If namespace is added to the parameters, it will create separate cache entries per namespace.

- **A) Yes** — include namespace in cache key (different namespace = different cache entry)
- **B) No** — cache all namespaces together and filter post-cache

**Recommendation**: Option A — including namespace in the cache key is the correct approach. It ensures cached results are scoped correctly and avoids returning stale cross-namespace data.

---

### Q5: Should `list_categories` also support namespace filtering?

Currently `list_categories` returns category counts by calling `list()` for each category. If namespace is added, should category counts be scoped to a specific namespace?

- **A) Yes** — add namespace to `list_categories` so counts reflect a specific namespace
- **B) No** — categories are global across all namespaces

**Recommendation**: Option B — categories are structural (storage, network, pipeline, etc.) and don't vary by namespace. Keep it simple.

---

## Answers

<!-- Please answer each question below with the letter of your choice and any additional notes -->

### A1: B

### A2: A

### A3: A

### A4: A

### A5: B

