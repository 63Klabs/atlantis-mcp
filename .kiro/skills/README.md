# Skills authored for the Atlantis platform

Staging area for skills intended to be published as `skills` agent assets and copied into the shared skill/steering repository. Planned under [`0-0-7-tool-discovery-enhancement`](../specs/0-0-7-tool-discovery-enhancement/PLAN.md) WS5.

## Contents

| Skill | Origin | Status |
|---|---|---|
| `atlantis-platform-resources` | New | Generic — applies to any repository scaffolded from an Atlantis starter |
| `automate-audit-update-npm-packages` | Converted from `steering/automate-audit-update-npm-packages.md` | Procedure preserved; frontmatter replaced |
| `automate-audit-update-python-packages` | Converted from `steering/automate-audit-update-python-packages.md` | Procedure preserved; frontmatter replaced |
| `automate-update-lambda-layers` | Converted from `steering/automate-update-lambda-layers.md` | Procedure preserved; frontmatter replaced |

Converted skills record the source asset's `sha256` under `metadata.sourceSha256` so a later drift check against the published steering asset is possible.

## Why these three were converted, and the other three were not

The six published steering assets split cleanly in two:

**Converted — procedures.** `automate-audit-update-npm-packages`, `automate-audit-update-python-packages`, and `automate-update-lambda-layers` are all `inclusion: manual`, which in Kiro means they **never** auto-load; the user has to remember to invoke them by name. They are numbered procedures with a defined end state and a report, and they already carried a `description` written in activation-trigger language. As skills they activate when the agent matches a request, and remain explicitly invocable as `/skill-name`. That is a capability gain with no loss.

**Left as steering — conventions.** `atlantis-multi-resource-src.md`, `atlantis-python-dependency-management.md`, and `atlantis-webapi-node-cache-data.md` describe how to write code on this platform and should apply continuously while editing, which is what steering is for. Converting them would make persistent conventions conditional.

> The closest steering analogue to a skill's activation behavior is `inclusion: auto`, not `manual`. If any converted procedure should keep requiring deliberate invocation, leaving it as `manual` steering is the right call and it should not be published as a skill.

## Publishing as agent assets: format mismatch

A Kiro skill on disk is **a folder containing a file named exactly `SKILL.md`**, whose `name` frontmatter must equal the folder name. The `skills` entry in the MCP server's agent-asset registry (`agent-asset-types.js`) declares `extensions: ['.md']` and the DAO builds flat keys of the form `{namespace}/utilities/v2/agent_assets/skills/{name}`. Nesting the key is not an option either: `list_agent_assets` lists with `Delimiter: '/'` and the `name` schema is `^[^/\\]+$`, so `my-skill/SKILL.md` would neither list nor retrieve.

The resolution (WS5a, decision 8) is the flat-file mapping:

```text
S3:    {namespace}/utilities/v2/agent_assets/skills/atlantis-platform-resources.md
Local: .kiro/skills/atlantis-platform-resources/SKILL.md
```

The object's filename stem must equal the `name` frontmatter value, which must equal the destination folder name. A consumer writes asset `<stem>.md` to `.kiro/skills/<stem>/SKILL.md`. Keep this convention stated in the registry's `skills` description, since that is the only place a consuming agent will see it.

This mapping only works for single-file skills, which is an accepted limitation — all four skills here are single-file. The first skill that needs bundled `scripts/`, `references/`, or `assets/` will force the archive option in WS5a, because the agent-asset path assumes text content end to end (`get_agent_asset` returns and hashes `content` as a string, and the chunker operates on strings).

## Before publishing

- [ ] `skills` registry entry flipped to enabled in `agent-asset-types.js`
- [ ] Flat-file mapping convention documented in the registry `skills` description
- [ ] Registry validation asserts the `name` frontmatter matches the object filename stem
- [ ] Assets uploaded — `list_agent_asset_types` must report a non-zero count, since an advertised-but-empty type is a discovery anti-signal (`hooks` and `agents-md` are both enabled and empty today)
- [ ] Precedence wording in `atlantis-platform-resources` reconciled with the server `instructions` string and the canonical `AGENTS.md` asset so all three agree

## Project-specific skills (not published)

These skills support this repository's own release process. They are not part of the published set in [Contents](#contents), are not uploaded as `skills` agent assets, and do not appear in the "Before publishing" checklist.

| Skill | What it does | When it runs |
|---|---|---|
| [`update-mcp-schemas`](update-mcp-schemas/SKILL.md) | Compares the vendored MCP JSON Schemas in `application-infrastructure/tests/mcp-schemas` with upstream `main`, applies any change at the resolved commit, and runs the conformance tests. Never commits and never advertises a revision | On request, or as the fourth update skill run by `prepare-release` |
| [`prepare-release`](prepare-release/SKILL.md) | Runs the prepare pass of a release: checks the preconditions, runs `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, and `update-mcp-schemas` in that order, runs every test suite, and checks that only release-preparation files changed. Never commits | Started by the [`detect-release-transition`](../hooks/detect-release-transition.json) hook after the top `CHANGELOG.md` version is dated on `dev`, or on request |

## Format reference

| Field | Required | Constraint |
|---|---|---|
| `name` | yes | Must equal the folder name. Lowercase letters, numbers, hyphens. Max 64 chars |
| `description` | yes | Matched against user requests. Max 1024 chars |
| `license` | no | License name or reference to a bundled file |
| `compatibility` | no | Environment requirements |
| `metadata` | no | Arbitrary key-value data |

Validate with:

```bash
for f in .kiro/skills/*/SKILL.md; do
  dir=$(basename "$(dirname "$f")")
  name=$(awk '/^name: /{print substr($0,7); exit}' "$f")
  desc=$(awk '/^description: /{print substr($0,14); exit}' "$f")
  printf '%-42s name_match=%-3s name_len=%-3s desc_len=%s\n' \
    "$dir" "$([ "$name" = "$dir" ] && echo yes || echo NO)" "${#name}" "${#desc}"
done
```

Sources: [Kiro skills documentation](https://kiro.dev/docs/skills), [Agent Skills specification](https://agentskills.io/specification). Content was rephrased for compliance with licensing restrictions.
