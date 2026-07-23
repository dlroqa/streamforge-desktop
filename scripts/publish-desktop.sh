#!/usr/bin/env bash
# Publish StreamForge Desktop: create the private GitHub repo, push `main`, and
# tag a release so CI builds macOS + Windows + Linux installers on native
# runners and attaches them to a GitHub Release.
#
# Requires an authenticated gh with the `workflow` scope:
#     gh auth login -h github.com -s repo,workflow
#
# Usage: ./scripts/publish-desktop.sh [repo-name] [tag]
set -euo pipefail

REPO="${1:-dlroqa/streamforge-desktop}"
TAG="${2:-v1.0.0}"
cd "$(dirname "$0")/.."

echo "==> Checking GitHub authentication"
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated." >&2
  echo "Run: gh auth login -h github.com -s repo,workflow" >&2
  exit 1
fi

# Pushing .github/workflows/ is rejected without the workflow scope, and the
# failure happens *after* the repo is created — so check up front.
if ! gh auth status 2>&1 | grep -q "workflow"; then
  echo "ERROR: token is missing the 'workflow' scope; the push would be rejected" >&2
  echo "because it contains .github/workflows/build-desktop.yml." >&2
  echo "Run: gh auth refresh -h github.com -s repo,workflow" >&2
  exit 1
fi

echo "==> Verifying the working tree is clean"
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: uncommitted changes; commit them first." >&2
  git status --short >&2
  exit 1
fi

echo "==> Creating private repo $REPO and pushing main"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "    repo already exists — adding remote and pushing"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --private --source=. --remote=origin --push
fi

echo "==> Tagging $TAG to trigger the all-platform build"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "    tag $TAG already exists locally — skipping create"
else
  git tag -a "$TAG" -m "StreamForge Desktop $TAG"
fi
git push origin "$TAG"

echo
echo "==> Done. CI is building macOS, Windows and Linux installers."
echo "    Watch:    gh run watch --repo $REPO"
echo "    Release:  https://github.com/$REPO/releases/tag/$TAG"
