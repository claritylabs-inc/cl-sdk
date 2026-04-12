#!/bin/bash
# Version Sync Verification Script
# Checks if GitHub releases and npm package versions are in sync

set -e

echo "=== Version Sync Verification ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Packages to check
PACKAGES=("@claritylabs/cl-sdk" "@claritylabs/cl-sdk-mcp")

for PACKAGE in "${PACKAGES[@]}"; do
    echo "Checking $PACKAGE..."
    
    # Get latest npm version
    NPM_VERSION=$(npm view "$PACKAGE" version 2>/dev/null || echo "not found")
    
    # Extract repo name from package
    if [[ "$PACKAGE" == *"mcp"* ]]; then
        REPO="cl-sdk-docs"
        TAG_SUFFIX="-mcp"
    else
        REPO="cl-sdk"
        TAG_SUFFIX=""
    fi
    
    # Get latest GitHub release version
    GH_VERSION=$(gh release list --repo "claritylabs-inc/$REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null || echo "not found")
    
    # Clean up version strings (remove 'v' prefix and suffix)
    CLEAN_NPM=$(echo "$NPM_VERSION" | sed 's/^v//')
    CLEAN_GH=$(echo "$GH_VERSION" | sed 's/^v//' | sed "s/$TAG_SUFFIX$//")
    
    echo "  npm:    $CLEAN_NPM"
    echo "  GitHub: $CLEAN_GH"
    
    if [ "$CLEAN_NPM" == "$CLEAN_GH" ]; then
        echo -e "  ${GREEN}✓ In sync${NC}"
    elif [ "$CLEAN_NPM" == "not found" ] || [ "$CLEAN_GH" == "not found" ]; then
        echo -e "  ${YELLOW}⚠ Could not verify${NC}"
    else
        echo -e "  ${RED}✗ Out of sync!${NC}"
        echo "    Recommendation: Check the release workflow logs"
    fi
    echo ""
done

echo "=== All packages checked ==="
