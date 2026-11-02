# List available recipes
default:
    @just --list

# Rebuild main.js on every save (esbuild watch mode, with source maps)
dev:
    npm run dev

# Lint, type-check and production build
check:
    npm run lint
    npm run build

# Bump version (patch, minor, major or e.g. 0.2.0), commit, tag and push; CI drafts the GitHub release
tag_release bump: check
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "$(git branch --show-current)" != "main" ]; then
      echo "Release from main, not $(git branch --show-current)." >&2; exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "Working tree is not clean. Commit or stash changes first." >&2; exit 1
    fi
    npm version {{bump}} -m "Release %s"
    version="$(node -p "require('./package.json').version")"
    git push origin main "$version"
    echo "Pushed $version. Review and publish the draft release once the Release workflow finishes."
