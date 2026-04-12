# Scripts

This directory contains utility scripts for managing the CL SDK packages.

## npm-cleanup.sh

Deprecates old npm package versions. Run this locally with npm credentials to clean up deprecated versions.

### Prerequisites

```bash
npm login
```

### Usage

```bash
./scripts/npm-cleanup.sh
```

This will deprecate all versions except:
- `@claritylabs/cl-sdk@0.2.0`
- `@claritylabs/cl-sdk-mcp@0.1.0`

### Un-deprecate packages

If you need to un-deprecate the packages after cleanup:

```bash
npm deprecate @claritylabs/cl-sdk --message ''
npm deprecate @claritylabs/cl-sdk-mcp --message ''
```

## verify-version-sync.sh

Verifies that GitHub releases and npm package versions are in sync.

### Prerequisites

```bash
# Install GitHub CLI
gh auth login
```

### Usage

```bash
./scripts/verify-version-sync.sh
```

This will check both packages and report if they're in sync.

## Release Workflow

The CI/CD pipeline ensures atomic version sync between GitHub releases and npm:

1. **cl-sdk** (`.github/workflows/release.yml`):
   - Runs semantic-release to create GitHub release
   - Publishes to npm only after GitHub release succeeds
   - Rollback mechanism if npm publish fails
   - Verification step ensures both are in sync

2. **cl-sdk-mcp** (`.github/workflows/publish.yml`):
   - Checks if version already exists on npm
   - Publishes to npm
   - Creates GitHub tag only after npm succeeds
   - Verification step confirms publication

### Preventing Version De-sync

The workflows include several safeguards:

- **Concurrency control**: Prevents simultaneous releases
- **Atomic operations**: GitHub release and npm publish happen together
- **Rollback**: If npm fails, the GitHub release is rolled back
- **Verification**: Each workflow verifies both sources are in sync

### Troubleshooting

If versions get out of sync:

1. Check the workflow logs for errors
2. Run `verify-version-sync.sh` to check current state
3. If npm publish failed but GitHub release exists:
   - Delete the GitHub release manually: `gh release delete vX.X.X`
   - Delete the tag: `git push origin --delete refs/tags/vX.X.X`
   - Re-run the workflow
4. If npm published but GitHub release failed:
   - Create the GitHub release manually with the same version
