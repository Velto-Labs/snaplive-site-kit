#!/usr/bin/env bash
# Publishes the current version of @snaplive/site-kit to the public repo
# Velto-Labs/snaplive-site-kit: builds, tests, packs, and commits
# releases/snaplive-site-kit-<version>.tgz plus a copy of the source, then tags v<version>.
#
# Sites install a release by its raw URL (no git, accounts or tokens needed in builds):
#   https://raw.githubusercontent.com/Velto-Labs/snaplive-site-kit/main/releases/snaplive-site-kit-<version>.tgz
#
# Usage: packages/site-kit/scripts/release.sh   (needs push access to the public repo)
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_REPO="${PUBLIC_REPO:-https://github.com/Velto-Labs/snaplive-site-kit.git}"
VERSION="$(node -p "require('$KIT_DIR/package.json').version")"
TARBALL="snaplive-site-kit-$VERSION.tgz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$KIT_DIR"
npm ci --no-audit --no-fund
npm test
npm pack --pack-destination "$WORK" >/dev/null

git clone --quiet "$PUBLIC_REPO" "$WORK/public"
git -C "$WORK/public" checkout --quiet -B main
cd "$WORK/public"
if [ -e "releases/$TARBALL" ]; then
  echo "releases/$TARBALL already exists. Bump the version in package.json first." >&2
  exit 1
fi

mkdir -p releases
cp "$WORK/$TARBALL" releases/
rm -rf src test scripts
cp -r "$KIT_DIR/src" "$KIT_DIR/test" "$KIT_DIR/scripts" .
cp "$KIT_DIR/README.md" "$KIT_DIR/package.json" "$KIT_DIR/package-lock.json" "$KIT_DIR/tsconfig.json" "$KIT_DIR/.gitignore" .
echo '!releases/*.tgz' >> .gitignore

git add -A
git commit --quiet -m "Release $VERSION" ${RELEASE_TRAILERS:+-m "$RELEASE_TRAILERS"}
git tag "v$VERSION"
git push --quiet origin HEAD:main "v$VERSION"

echo "Released $VERSION:"
echo "  https://raw.githubusercontent.com/Velto-Labs/snaplive-site-kit/main/releases/$TARBALL"
