#!/usr/bin/env bash
# Run GLM as a local, read-only second reviewer from a Codespaces checkout.
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <40-character lowercase commit SHA>" >&2
  exit 64
fi

sha="$1"

if ! command -v glm >/dev/null 2>&1; then
  echo "glm is not available in this Codespaces session." >&2
  exit 69
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this command from inside the repository checkout." >&2
  exit 70
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; stop before review to preserve provenance." >&2
  exit 73
fi

if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
  echo "Commit is not available locally. Update the clean checkout first, then retry." >&2
  exit 65
fi

prompt="Read-only code review only. Do not edit, create, delete, stage, commit, push, change configuration, use network tools, or write files. Inspect exactly commit ${sha} and its diff using read-only git commands. Report only concrete defects, regressions, or safety risks introduced by that commit. Reply with exactly one JSON object and no Markdown: {\"commit\":\"${sha}\",\"verdict\":\"PASS|FINDINGS|BLOCKED\",\"findings\":[]}"

last_line="$(glm -p "$prompt" | tail -n 1)"

node -e '
const [, expectedSha, line] = process.argv;
let result;
try {
  result = JSON.parse(line);
} catch {
  console.error("GLM did not return a JSON object on its final output line.");
  process.exit(65);
}
if (
  result === null ||
  Array.isArray(result) ||
  result.commit !== expectedSha ||
  !["PASS", "FINDINGS", "BLOCKED"].includes(result.verdict) ||
  !Array.isArray(result.findings)
) {
  console.error("GLM JSON does not match the review contract.");
  process.exit(65);
}
process.stdout.write(JSON.stringify(result) + "\n");
' "$sha" "$last_line"
