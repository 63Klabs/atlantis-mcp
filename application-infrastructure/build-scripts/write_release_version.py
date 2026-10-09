#!/usr/bin/env python3
"""
Write release version to Lambda config files.

This script parses CHANGELOG.md to extract the current release version
and writes it to config/release-version.js in every Lambda function directory.

The version is extracted from the first version header in CHANGELOG.md
(either released or unreleased). If no version header is found, the build fails.

Usage:
    python write_release_version.py

Environment:
    Runs from application-infrastructure/build-scripts/
    Writes to src/lambda/*/config/release-version.js
"""

import os
import re
import sys
from pathlib import Path


def parse_changelog_version(changelog_path):
    """
    Parse the first version from CHANGELOG.md.
    
    Args:
        changelog_path: Path to CHANGELOG.md file
        
    Returns:
        Version string without the leading 'v' (e.g., '0.0.7')
        
    Raises:
        ValueError: If no version header is found or file cannot be read
    """
    try:
        with open(changelog_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        raise ValueError(f"CHANGELOG.md not found at {changelog_path}")
    except Exception as e:
        raise ValueError(f"Failed to read CHANGELOG.md: {e}")
    
    # Match version headers in format: ## [vX.Y.Z] or ## vX.Y.Z
    # Examples: ## [v0.0.7] (unreleased), ## v0.0.6 (2026-09-02)
    version_pattern = r'^##\s+\[?v(\d+\.\d+\.\d+)\]?'
    
    for line in content.splitlines():
        match = re.match(version_pattern, line)
        if match:
            version = match.group(1)
            return version
    
    raise ValueError(
        "No version header found in CHANGELOG.md. "
        "Expected format: ## [vX.Y.Z] (unreleased) or ## [vX.Y.Z] (YYYY-MM-DD)"
    )


def write_release_version_file(version, config_dir):
    """
    Write release-version.js to the specified config directory.
    
    Args:
        version: Version string (e.g., '0.0.7')
        config_dir: Path to the config directory
    """
    config_dir = Path(config_dir)
    config_dir.mkdir(parents=True, exist_ok=True)
    
    output_path = config_dir / 'release-version.js'
    
    # Write the module in CommonJS format
    content = f"module.exports = {{ releaseVersion: '{version}' }};\n"
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)


def find_lambda_directories(src_lambda_path):
    """
    Find all Lambda function directories under src/lambda/.
    
    Args:
        src_lambda_path: Path to src/lambda directory
        
    Returns:
        List of Lambda function directory paths (excluding 'layers')
    """
    src_lambda_path = Path(src_lambda_path)
    
    if not src_lambda_path.exists():
        raise ValueError(f"Lambda source directory not found: {src_lambda_path}")
    
    lambda_dirs = []
    
    for item in src_lambda_path.iterdir():
        # Include directories but exclude 'layers'
        if item.is_dir() and item.name != 'layers':
            lambda_dirs.append(item)
    
    return sorted(lambda_dirs)


def main():
    """Main entry point."""
    try:
        # Determine paths relative to script location
        script_dir = Path(__file__).parent
        repo_root = script_dir.parent.parent
        changelog_path = repo_root / 'CHANGELOG.md'
        src_lambda_path = script_dir.parent / 'src' / 'lambda'
        
        print(f"Parsing version from {changelog_path}")
        version = parse_changelog_version(changelog_path)
        print(f"Found version: {version}")
        
        print(f"\nFinding Lambda directories in {src_lambda_path}")
        lambda_dirs = find_lambda_directories(src_lambda_path)
        
        if not lambda_dirs:
            print("WARNING: No Lambda directories found")
            return 0
        
        print(f"Found {len(lambda_dirs)} Lambda function(s)")
        
        # Write release-version.js to each Lambda's config directory
        for lambda_dir in lambda_dirs:
            config_dir = lambda_dir / 'config'
            print(f"  Writing {config_dir / 'release-version.js'}")
            write_release_version_file(version, config_dir)
        
        print(f"\nSuccessfully wrote release version '{version}' to {len(lambda_dirs)} Lambda function(s)")
        return 0
        
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"UNEXPECTED ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
