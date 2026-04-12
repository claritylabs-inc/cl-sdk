#!/bin/bash
# NPM Package Cleanup Script
# Run this locally with npm login credentials to clean up deprecated packages

set -e

echo "=== NPM Package Cleanup Script ==="
echo ""
echo "This script will:"
echo "1. Deprecate all old versions of @claritylabs/cl-sdk and @claritylabs/cl-sdk-mcp"
echo "2. Keep only the current versions (0.2.0 for cl-sdk, 0.1.0 for cl-sdk-mcp)"
echo ""
echo "Make sure you're logged into npm: npm login"
echo ""

# Check if logged into npm
if ! npm whoami &>/dev/null; then
    echo "Error: Not logged into npm. Run 'npm login' first."
    exit 1
fi

echo "Logged in as: $(npm whoami)"
echo ""

# cl-sdk versions to deprecate (keep only 0.2.0)
CL_SDK_VERSIONS=("1.0.0" "1.1.2" "1.1.4" "1.2.0" "1.3.0" "1.4.0" "2.0.0" "3.0.0" "3.1.1" "4.0.0" "5.0.0" "6.0.0")

# cl-sdk-mcp versions to deprecate (keep only 0.1.0)  
CL_SDK_MCP_VERSIONS=("1.0.0" "1.1.2" "1.1.4" "1.2.0" "1.3.0" "1.4.0" "2.0.0" "3.0.0" "3.1.1" "4.0.0" "5.0.0" "6.0.0")

DEPRECATION_MESSAGE="This version is deprecated. Please use the latest stable version."

echo "=== Deprecating @claritylabs/cl-sdk versions ==="
for version in "${CL_SDK_VERSIONS[@]}"; do
    echo "Deprecating @claritylabs/cl-sdk@$version..."
    npm deprecate "@claritylabs/cl-sdk@$version" "$DEPRECATION_MESSAGE" || echo "  (version may not exist, skipping)"
done

echo ""
echo "=== Deprecating @claritylabs/cl-sdk-mcp versions ==="
for version in "${CL_SDK_MCP_VERSIONS[@]}"; do
    echo "Deprecating @claritylabs/cl-sdk-mcp@$version..."
    npm deprecate "@claritylabs/cl-sdk-mcp@$version" "$DEPRECATION_MESSAGE" || echo "  (version may not exist, skipping)"
done

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "Remaining active versions:"
echo "  @claritylabs/cl-sdk@0.2.0"
echo "  @claritylabs/cl-sdk-mcp@0.1.0"
echo ""
echo "Note: To un-deprecate the packages, run:"
echo "  npm deprecate @claritylabs/cl-sdk --message ''"
echo "  npm deprecate @claritylabs/cl-sdk-mcp --message ''"
