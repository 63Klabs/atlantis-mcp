#!/usr/bin/env python3

# 63Klabs, chadkluck
# 2026-03-20

"""Generate Sidecar Metadata for Atlantis App Starters.

This script generates sidecar metadata JSON files for app starter repositories.
The metadata is used by the Atlantis MCP Server to provide rich information
about starters without extracting ZIP files.

Usage:
    python generate-sidecar-metadata.py --repo-path /path/to/repo --output starter.json
    python generate-sidecar-metadata.py --github-repo owner/repo --output starter.json

Example:
    Generate metadata from a local repository:

    $ python generate-sidecar-metadata.py --repo-path ./my-starter --output starter.json --pretty

    Generate metadata from a GitHub repository:

    $ python generate-sidecar-metadata.py --github-repo 63Klabs/my-starter --output starter.json
"""

import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


def extract_from_package_json(repo_path: Path) -> Dict:
    """Extract metadata from package.json files at multiple paths.

    Scans for package.json at the repository root, at
    ``application-infrastructure/src/``, and at
    ``application-infrastructure/src/*/*/`` (up to 3 levels deep from
    ``src/``). Metadata fields (name, description, version, author,
    license) are taken from the first (root) package.json found.
    Dependencies and devDependencies are merged from all discovered
    files, deduplicated. A warning is logged and the file is skipped
    on parse error.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Extracted metadata including name, description, version,
            author, license, languages, dependencies, devDependencies,
            and hasCacheData. Returns empty dict if no package.json
            files are found.

    Example:
        >>> metadata = extract_from_package_json(Path('./my-project'))
        >>> print(metadata.get('dependencies'))
        ['express', '@63klabs/cache-data']
    """
    # >! Build list of candidate paths in priority order
    candidate_paths: List[Path] = []

    # 1. Repository root
    root_pkg = repo_path / "package.json"
    if root_pkg.exists():
        candidate_paths.append(root_pkg)

    # 2. application-infrastructure/src/
    src_pkg = repo_path / "application-infrastructure" / "src" / "package.json"
    if src_pkg.exists():
        candidate_paths.append(src_pkg)

    # 3. application-infrastructure/src/*/*/package.json (up to 3 levels)
    glob_pattern = str(
        repo_path / "application-infrastructure" / "src" / "*" / "*" / "package.json"
    )
    for match in sorted(glob.glob(glob_pattern)):
        match_path = Path(match)
        if match_path not in candidate_paths:
            candidate_paths.append(match_path)

    if not candidate_paths:
        return {}

    # Collect metadata from root package.json and merge deps from all
    name = ''
    description = ''
    version = ''
    author = ''
    license_val = ''
    all_deps: List[str] = []
    all_dev_deps: List[str] = []
    has_cache_data = False
    root_metadata_set = False

    for pkg_path in candidate_paths:
        try:
            with open(pkg_path, 'r') as f:
                package_data = json.load(f)
        except Exception as e:
            print(f"Warning: Could not parse {pkg_path}: {e}")
            continue

        # Use root-level metadata from the first successfully parsed file
        if not root_metadata_set:
            name = package_data.get('name', '')
            description = package_data.get('description', '')
            version = package_data.get('version', '')
            author = package_data.get('author', '')
            license_val = package_data.get('license', '')
            root_metadata_set = True

        deps = package_data.get('dependencies', {})
        dev_deps = package_data.get('devDependencies', {})

        all_deps.extend(deps.keys())
        all_dev_deps.extend(dev_deps.keys())

        if '@63klabs/cache-data' in deps:
            has_cache_data = True

    # Deduplicate while preserving order
    seen_deps: set = set()
    unique_deps: List[str] = []
    for dep in all_deps:
        if dep not in seen_deps:
            seen_deps.add(dep)
            unique_deps.append(dep)

    seen_dev_deps: set = set()
    unique_dev_deps: List[str] = []
    for dep in all_dev_deps:
        if dep not in seen_dev_deps:
            seen_dev_deps.add(dep)
            unique_dev_deps.append(dep)

    return {
        'name': name,
        'description': description,
        'version': version,
        'author': author,
        'license': license_val,
        'languages': ['Node.js'],
        'dependencies': unique_deps,
        'devDependencies': unique_dev_deps,
        'hasCacheData': has_cache_data,
    }


def extract_from_requirements_txt(repo_path: Path) -> Dict:
    """Extract metadata from requirements.txt (Python projects).

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Extracted metadata with languages and dependencies.
            Returns empty dict if requirements.txt does not exist.

    Example:
        >>> metadata = extract_from_requirements_txt(Path('./my-project'))
        >>> print(metadata.get('languages'))
        ['Python']
    """
    requirements_path = repo_path / "requirements.txt"

    if not requirements_path.exists():
        return {}

    try:
        with open(requirements_path, 'r') as f:
            dependencies = [
                line.strip().split('==')[0].split('>=')[0].split('<=')[0]
                for line in f
                if line.strip() and not line.startswith('#')
            ]

        return {
            'languages': ['Python'],
            'dependencies': dependencies,
        }
    except Exception as e:
        print(f"Warning: Could not parse requirements.txt: {e}")
        return {}


def extract_from_readme(repo_path: Path) -> Dict:
    """Extract description from README.md.

    Reads the first non-heading paragraph longer than 20 characters as the
    project description.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Dictionary with 'description' key, or empty dict if not found.

    Example:
        >>> metadata = extract_from_readme(Path('./my-project'))
        >>> print(metadata.get('description'))
        'A starter project for building serverless APIs.'
    """
    readme_paths = [
        repo_path / "README.md",
        repo_path / "readme.md",
        repo_path / "README.MD",
    ]

    for readme_path in readme_paths:
        if readme_path.exists():
            try:
                with open(readme_path, 'r') as f:
                    content = f.read()

                lines = [line.strip() for line in content.split('\n') if line.strip()]
                description = ''
                for line in lines:
                    if not line.startswith('#') and len(line) > 20:
                        description = line
                        break

                return {'description': description}
            except Exception as e:
                print(f"Warning: Could not parse README: {e}")

    return {}


def parse_readme_table(repo_path: Path) -> Dict:
    """Parse the first markdown table in README.md into categorized structures.

    Reads the README.md file, locates the first markdown table, identifies
    columns (Build/Deploy, Application Stack, optional Post-Deploy), and
    extracts rows (Languages, Frameworks, Features) using case-insensitive
    bold matching (e.g. ``**Languages**``). Comma-separated cell values are
    split and trimmed. A cell containing only ``-`` is treated as empty.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Dictionary with the following structure::

            {
                'languages': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
                'frameworks': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
                'features': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
                'hasTable': bool,
                'hasFeaturesRow': bool,
            }

        Returns empty categorized structures with ``hasTable`` and
        ``hasFeaturesRow`` set to ``False`` if no table is found.

    Example:
        >>> result = parse_readme_table(Path('./my-project'))
        >>> print(result['languages']['applicationStack'])
        ['Node.js']
    """
    empty_category: Dict = {
        'buildDeploy': [],
        'applicationStack': [],
        'postDeploy': [],
    }
    default_result: Dict = {
        'languages': dict(empty_category),
        'frameworks': dict(empty_category),
        'features': dict(empty_category),
        'hasTable': False,
        'hasFeaturesRow': False,
    }

    readme_paths = [
        repo_path / "README.md",
        repo_path / "readme.md",
        repo_path / "README.MD",
    ]

    content: Optional[str] = None
    for readme_path in readme_paths:
        if readme_path.exists():
            try:
                with open(readme_path, 'r') as f:
                    content = f.read()
            except Exception as e:
                print(f"Warning: Could not read README for table parsing: {e}")
            break

    if content is None:
        return default_result

    lines = content.split('\n')

    # Find the first markdown table (a line starting with |)
    table_lines: List[str] = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('|'):
            in_table = True
            table_lines.append(stripped)
        elif in_table:
            # End of table block
            break

    if len(table_lines) < 3:
        # Need at least header row, separator row, and one data row
        return default_result

    # Parse header row to identify column positions
    header_row = table_lines[0]
    header_cells = [cell.strip() for cell in header_row.split('|')]
    # Remove empty strings from leading/trailing pipes
    header_cells = [cell for cell in header_cells if cell or cell == '']
    # Strip empty strings caused by leading/trailing pipes
    if header_cells and header_cells[0] == '':
        header_cells = header_cells[1:]
    if header_cells and header_cells[-1] == '':
        header_cells = header_cells[:-1]

    # Map column names to indices (case-insensitive)
    col_map: Dict[str, int] = {}
    for idx, cell in enumerate(header_cells):
        cell_lower = cell.strip().lower()
        if 'build' in cell_lower and 'deploy' in cell_lower:
            col_map['buildDeploy'] = idx
        elif 'application' in cell_lower and 'stack' in cell_lower:
            col_map['applicationStack'] = idx
        elif 'post' in cell_lower and 'deploy' in cell_lower:
            col_map['postDeploy'] = idx

    if 'buildDeploy' not in col_map and 'applicationStack' not in col_map:
        # No recognized columns found
        return default_result

    # Skip separator row (index 1), parse data rows (index 2+)
    result: Dict = {
        'languages': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
        'frameworks': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
        'features': {'buildDeploy': [], 'applicationStack': [], 'postDeploy': []},
        'hasTable': True,
        'hasFeaturesRow': False,
    }

    row_key_map = {
        'languages': 'languages',
        'frameworks': 'frameworks',
        'features': 'features',
    }

    for table_line in table_lines[2:]:
        cells = [cell.strip() for cell in table_line.split('|')]
        # Remove empty strings from leading/trailing pipes
        if cells and cells[0] == '':
            cells = cells[1:]
        if cells and cells[-1] == '':
            cells = cells[:-1]

        if not cells:
            continue

        # First column is the row label — strip bold markers and whitespace
        label_raw = cells[0].strip()
        # Remove bold markers: **text** or __text__
        label_clean = re.sub(r'\*\*|__', '', label_raw).strip().lower()

        # Determine which row key this matches
        matched_key: Optional[str] = None
        for key in row_key_map:
            if key == label_clean:
                matched_key = row_key_map[key]
                break

        if matched_key is None:
            continue

        if matched_key == 'features':
            result['hasFeaturesRow'] = True

        # Extract values for each recognized column
        for col_name, col_idx in col_map.items():
            if col_idx < len(cells):
                cell_value = cells[col_idx].strip()
                if cell_value == '-' or cell_value == '':
                    result[matched_key][col_name] = []
                else:
                    values = [v.strip() for v in cell_value.split(',')]
                    result[matched_key][col_name] = [v for v in values if v]

    return result


def extract_display_name(repo_path: Path) -> str:
    """Extract the display name from the first H1 heading in README.md.

    Reads the README.md file and finds the first line starting with a
    single ``#`` (H1 heading). Returns the heading text with the ``# ``
    prefix removed and whitespace trimmed.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        str: The heading text stripped of the ``# `` prefix and trimmed.
            Returns an empty string if no H1 heading is found or if
            README.md does not exist.

    Example:
        >>> display_name = extract_display_name(Path('./my-project'))
        >>> print(display_name)
        'Basic API Gateway with Lambda Function Written in Node.js'
    """
    readme_paths = [
        repo_path / "README.md",
        repo_path / "readme.md",
        repo_path / "README.MD",
    ]

    for readme_path in readme_paths:
        if readme_path.exists():
            try:
                with open(readme_path, 'r') as f:
                    for line in f:
                        stripped = line.strip()
                        # Match lines starting with exactly one # followed
                        # by a space (H1 heading), but not ## or deeper.
                        if stripped.startswith('# ') and not stripped.startswith('## '):
                            return stripped[2:].strip()
            except Exception as e:
                print(f"Warning: Could not read README for display name: {e}")
            break

    return ''


def parse_readme_sections(repo_path: Path) -> Dict:
    """Parse ## Features and ## Prerequisites sections from README.md.

    Reads the README.md file and extracts bullet-point items from the
    ``## Features`` and ``## Prerequisites`` sections to supplement
    file-detection heuristics.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Dictionary with 'features' and 'prerequisites' lists.
            Each list contains the text of bullet items found in the
            corresponding README section. Returns empty lists if sections
            are not found.

    Example:
        >>> sections = parse_readme_sections(Path('./my-project'))
        >>> print(sections['features'])
        ['Serverless architecture', 'DynamoDB integration']
    """
    readme_paths = [
        repo_path / "README.md",
        repo_path / "readme.md",
        repo_path / "README.MD",
    ]

    result: Dict[str, List[str]] = {'features': [], 'prerequisites': []}

    for readme_path in readme_paths:
        if readme_path.exists():
            try:
                with open(readme_path, 'r') as f:
                    content = f.read()

                for section_key in ('features', 'prerequisites'):
                    # Match ## Features or ## Prerequisites (case-insensitive)
                    pattern = (
                        r'(?i)^##\s+'
                        + section_key
                        + r'\s*\n(.*?)(?=^##\s|\Z)'
                    )
                    match = re.search(pattern, content, re.MULTILINE | re.DOTALL)
                    if match:
                        section_text = match.group(1)
                        # Extract bullet items (lines starting with - or *)
                        items = []
                        for line in section_text.split('\n'):
                            stripped = line.strip()
                            if stripped.startswith(('-', '*')):
                                # Remove the bullet marker and leading whitespace
                                item_text = stripped.lstrip('-* ').strip()
                                if item_text:
                                    items.append(item_text)
                        result[section_key] = items
            except Exception as e:
                print(f"Warning: Could not parse README sections: {e}")
            break

    return result


def detect_framework(repo_path: Path, languages: List[str]) -> List[str]:
    """Detect frameworks based on dependencies and files.

    Args:
        repo_path (Path): Path to the repository root directory.
        languages (list): List of detected programming languages.

    Returns:
        list: List of detected framework names. Returns empty list if
            no frameworks are detected.

    Example:
        >>> frameworks = detect_framework(Path('./my-project'), ['Node.js'])
        >>> print(frameworks)
        ['Express']
    """
    frameworks = []

    if 'Node.js' in languages:
        package_json_path = repo_path / "package.json"
        if package_json_path.exists():
            try:
                with open(package_json_path, 'r') as f:
                    package_data = json.load(f)
                    deps = package_data.get('dependencies', {})

                    if 'express' in deps:
                        frameworks.append('Express')
                    if 'fastify' in deps:
                        frameworks.append('Fastify')
                    if 'koa' in deps:
                        frameworks.append('Koa')
                    if 'next' in deps:
                        frameworks.append('Next.js')
                    if 'react' in deps:
                        frameworks.append('React')
            except Exception:
                pass

    if 'Python' in languages:
        requirements_path = repo_path / "requirements.txt"
        if requirements_path.exists():
            try:
                with open(requirements_path, 'r') as f:
                    content = f.read().lower()

                    if 'fastapi' in content:
                        frameworks.append('FastAPI')
                    if 'flask' in content:
                        frameworks.append('Flask')
                    if 'django' in content:
                        frameworks.append('Django')
            except Exception:
                pass

    return frameworks


def detect_features(repo_path: Path) -> List[str]:
    """Detect features based on files and dependencies.

    Scans the repository for known files and dependency patterns to
    build a list of detected features.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        list: List of detected feature strings.

    Example:
        >>> features = detect_features(Path('./my-project'))
        >>> print(features)
        ['cache-data integration', 'CloudFormation template', 'Unit tests']
    """
    features = []

    # Check for cache-data integration
    package_json_path = repo_path / "package.json"
    if package_json_path.exists():
        try:
            with open(package_json_path, 'r') as f:
                package_data = json.load(f)
                deps = package_data.get('dependencies', {})

                if '@63klabs/cache-data' in deps:
                    features.append('cache-data integration')
        except Exception:
            pass

    # Check for CloudFormation template
    if (repo_path / "template.yml").exists() or (repo_path / "template.yaml").exists():
        features.append('CloudFormation template')

    # Check for buildspec.yml
    if (repo_path / "buildspec.yml").exists():
        features.append('CodeBuild integration')

    # Check for GitHub Actions
    if (repo_path / ".github" / "workflows").exists():
        features.append('GitHub Actions')

    # Check for tests
    if (repo_path / "tests").exists() or (repo_path / "test").exists():
        features.append('Unit tests')

    # Check for Lambda functions
    if (repo_path / "src" / "lambda").exists():
        features.append('AWS Lambda')

    return features


def extract_prerequisites(repo_path: Path, languages: List[str]) -> List[str]:
    """Extract prerequisites inferred from the project structure.

    Args:
        repo_path (Path): Path to the repository root directory.
        languages (list): List of detected programming languages.

    Returns:
        list: List of prerequisite strings.

    Example:
        >>> prereqs = extract_prerequisites(Path('./my-project'), ['Node.js'])
        >>> print(prereqs)
        ['Node.js 18.x or later', 'npm or yarn']
    """
    prerequisites = []

    if 'Node.js' in languages:
        prerequisites.append('Node.js 18.x or later')
        prerequisites.append('npm or yarn')
    if 'Python' in languages:
        prerequisites.append('Python 3.9 or later')
        prerequisites.append('pip')

    # AWS prerequisites
    if (repo_path / "template.yml").exists():
        prerequisites.append('AWS CLI configured')
        prerequisites.append('AWS SAM CLI')

    return prerequisites


def fetch_github_release_version(
    repo_full_name: str, github_token: Optional[str] = None
) -> str:
    """Fetch the latest release version from the GitHub Releases API.

    Calls ``GET /repos/{owner}/{repo}/releases/latest`` and returns a
    formatted version string combining the tag name and published date.
    The ``requests`` library is imported lazily so the script can run
    without it when only ``--repo-path`` is used.

    Args:
        repo_full_name (str): GitHub repository in ``owner/repo`` format.
        github_token (str, optional): GitHub personal access token.

    Returns:
        str: Version string in the format ``"{tag_name} (YYYY-MM-DD)"``
            e.g. ``"v1.2.3 (2024-06-15)"``. Returns empty string if no
            releases exist (404) or on API error.

    Example:
        >>> version = fetch_github_release_version('63Klabs/my-starter')
        >>> print(version)
        'v1.2.3 (2024-06-15)'
    """
    try:
        import requests  # noqa: F811
    except ImportError:
        print(
            "Warning: requests library not installed. "
            "Skipping GitHub release version fetch."
        )
        return ''

    headers = {'Accept': 'application/vnd.github+json'}
    if github_token:
        headers['Authorization'] = f'token {github_token}'

    try:
        url = (
            f'https://api.github.com/repos/{repo_full_name}/releases/latest'
        )
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        release_data = response.json()

        tag_name = release_data.get('tag_name', '')
        published_at = release_data.get('published_at', '')

        if tag_name and published_at:
            # Extract YYYY-MM-DD from the ISO 8601 published_at field
            published_date = published_at[:10]
            return f'{tag_name} ({published_date})'

        return ''
    except Exception as e:
        print(f"Warning: Could not fetch GitHub release version: {e}")
        return ''


def fetch_github_metadata(
    repo_full_name: str, github_token: Optional[str] = None
) -> Dict:
    """Fetch metadata from the GitHub API.

    The ``requests`` library is imported lazily so the script can run
    without it when only ``--repo-path`` is used.

    Args:
        repo_full_name (str): GitHub repository in ``owner/repo`` format.
        github_token (str, optional): GitHub personal access token.

    Returns:
        dict: Metadata fetched from GitHub including name, description,
            author, license, repository_type, topics, github_url, and
            last_updated. Returns empty dict on failure.

    Example:
        >>> metadata = fetch_github_metadata('63Klabs/my-starter')
        >>> print(metadata.get('name'))
        'my-starter'
    """
    try:
        import requests  # noqa: F811
    except ImportError:
        print(
            "Warning: requests library not installed. "
            "Skipping GitHub metadata fetch."
        )
        return {}

    headers = {'Accept': 'application/vnd.github+json'}
    if github_token:
        headers['Authorization'] = f'token {github_token}'

    try:
        # Get repository metadata
        repo_url = f'https://api.github.com/repos/{repo_full_name}'
        response = requests.get(repo_url, headers=headers)
        response.raise_for_status()
        repo_data = response.json()

        # Get custom properties
        props_url = (
            f'https://api.github.com/repos/{repo_full_name}/properties/values'
        )
        props_response = requests.get(props_url, headers=headers)
        repository_type = 'app-starter'  # Default

        if props_response.status_code == 200:
            props_data = props_response.json()
            for prop in props_data:
                if prop.get('property_name') == 'atlantis_repository-type':
                    repository_type = prop.get('value', 'app-starter')

        return {
            'name': repo_data.get('name', ''),
            'description': repo_data.get('description', ''),
            'author': repo_data.get('owner', {}).get('login', ''),
            'license': (repo_data.get('license') or {}).get('spdx_id', 'UNLICENSED'),
            'repository_type': repository_type,
            'topics': repo_data.get('topics', []),
            'github_url': repo_data.get('html_url', ''),
            'last_updated': repo_data.get('updated_at', ''),
        }
    except requests.exceptions.RequestException as e:
        print(f"Warning: Could not fetch GitHub metadata: {e}")
        return {}



def _deduplicate(items: List[str]) -> List[str]:
    """Return a deduplicated list preserving insertion order.

    Args:
        items (list): List of strings, possibly with duplicates.

    Returns:
        list: Deduplicated list in original order.

    Example:
        >>> _deduplicate(['a', 'b', 'a', 'c'])
        ['a', 'b', 'c']
    """
    seen: set = set()
    result: List[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def generate_metadata(
    repo_path: Optional[Path] = None,
    github_repo: Optional[str] = None,
    github_token: Optional[str] = None,
) -> Dict:
    """Generate complete sidecar metadata matching the Atlantis sidecar format.

    Combines metadata from local repository analysis (package.json,
    requirements.txt, README.md, README table parsing, file detection)
    and optional GitHub API data into a single sidecar metadata
    dictionary. All output property names use camelCase. The
    ``languages``, ``frameworks``, and ``features`` fields are
    categorized structures with ``buildDeploy``, ``applicationStack``,
    and ``postDeploy`` arrays. The ``topics`` field remains a flat
    array.

    Args:
        repo_path (Path, optional): Path to local repository.
        github_repo (str, optional): GitHub repository in ``owner/repo``
            format.
        github_token (str, optional): GitHub personal access token.

    Returns:
        dict: Complete sidecar metadata dictionary with camelCase keys
            including ``name``, ``displayName``, ``description``,
            ``languages``, ``frameworks``, ``features`` (each as
            categorized structures), ``topics``, ``prerequisites``,
            ``dependencies``, ``devDependencies``, ``hasCacheData``,
            ``deploymentPlatform``, ``repository``, ``author``,
            ``license``, ``repositoryType``, ``version``, and
            ``lastUpdated``.

    Example:
        >>> metadata = generate_metadata(repo_path=Path('./my-starter'))
        >>> print(metadata['languages']['applicationStack'])
        ['Node.js']
    """
    empty_category: Dict = {
        'buildDeploy': [],
        'applicationStack': [],
        'postDeploy': [],
    }

    metadata: Dict = {
        'name': '',
        'displayName': '',
        'description': '',
        'languages': dict(empty_category),
        'frameworks': dict(empty_category),
        'features': dict(empty_category),
        'topics': [],
        'prerequisites': [],
        'dependencies': [],
        'devDependencies': [],
        'hasCacheData': False,
        'deploymentPlatform': 'atlantis',
        'repository': '',
        'author': '',
        'license': 'UNLICENSED',
        'repositoryType': 'app-starter',
        'version': '',
        'lastUpdated': datetime.now(timezone.utc).isoformat().replace(
            '+00:00', 'Z'
        ),
    }

    # Track package.json version for fallback
    pkg_version = ''

    # Extract from local repository
    if repo_path:
        # Extract displayName from README heading
        metadata['displayName'] = extract_display_name(repo_path)

        # Parse README table for categorized languages/frameworks/features
        table_data = parse_readme_table(repo_path)

        # Try package.json first (Node.js) — multi-path scanning
        package_metadata = extract_from_package_json(repo_path)
        if package_metadata:
            metadata['name'] = package_metadata.get('name', '')
            metadata['description'] = package_metadata.get('description', '')
            pkg_version = package_metadata.get('version', '')
            metadata['author'] = package_metadata.get('author', '')
            metadata['license'] = package_metadata.get('license', '') or 'UNLICENSED'
            metadata['dependencies'] = package_metadata.get('dependencies', [])
            metadata['devDependencies'] = package_metadata.get(
                'devDependencies', []
            )
            metadata['hasCacheData'] = package_metadata.get(
                'hasCacheData', False
            )

        # Try requirements.txt (Python)
        requirements_metadata = extract_from_requirements_txt(repo_path)
        if requirements_metadata:
            # Merge dependencies
            req_deps = requirements_metadata.get('dependencies', [])
            metadata['dependencies'] = _deduplicate(
                metadata['dependencies'] + req_deps
            )

        # Collect detected languages from package.json and requirements.txt
        detected_languages: List[str] = []
        if package_metadata:
            detected_languages.extend(
                package_metadata.get('languages', [])
            )
        if requirements_metadata:
            detected_languages.extend(
                requirements_metadata.get('languages', [])
            )
        detected_languages = _deduplicate(detected_languages)

        # Languages: use table data if available, otherwise fallback
        if table_data.get('hasTable'):
            metadata['languages'] = {
                'buildDeploy': table_data['languages']['buildDeploy'],
                'applicationStack': table_data['languages']['applicationStack'],
                'postDeploy': table_data['languages']['postDeploy'],
            }
        elif detected_languages:
            metadata['languages'] = {
                'buildDeploy': [],
                'applicationStack': detected_languages,
                'postDeploy': [],
            }

        # Frameworks: use table data if available, otherwise fallback
        detected_frameworks = detect_framework(
            repo_path, detected_languages
        ) if detected_languages else []

        if table_data.get('hasTable'):
            metadata['frameworks'] = {
                'buildDeploy': table_data['frameworks']['buildDeploy'],
                'applicationStack': table_data['frameworks'][
                    'applicationStack'
                ],
                'postDeploy': table_data['frameworks']['postDeploy'],
            }
        elif detected_frameworks:
            metadata['frameworks'] = {
                'buildDeploy': [],
                'applicationStack': detected_frameworks,
                'postDeploy': [],
            }

        # Features: use table if it has a Features row, otherwise fallback
        if table_data.get('hasFeaturesRow'):
            metadata['features'] = {
                'buildDeploy': table_data['features']['buildDeploy'],
                'applicationStack': table_data['features'][
                    'applicationStack'
                ],
                'postDeploy': table_data['features']['postDeploy'],
            }
        else:
            # Fallback: file detection heuristics into applicationStack
            file_features = detect_features(repo_path)
            metadata['features'] = {
                'buildDeploy': [],
                'applicationStack': file_features,
                'postDeploy': [],
            }

        # Extract description from README if not already set
        if not metadata['description']:
            readme_metadata = extract_from_readme(repo_path)
            if readme_metadata:
                metadata['description'] = readme_metadata.get(
                    'description', ''
                )

        # Parse README sections for prerequisites
        readme_sections = parse_readme_sections(repo_path)

        # Extract prerequisites from project structure
        inferred_prereqs = extract_prerequisites(
            repo_path, detected_languages
        )

        # Merge and deduplicate prerequisites
        metadata['prerequisites'] = _deduplicate(
            inferred_prereqs + readme_sections.get('prerequisites', [])
        )

    # Set repository from --github-repo arg
    if github_repo:
        metadata['repository'] = f'github.com/{github_repo}'

    # Fetch from GitHub API (requires requests)
    if github_repo:
        github_metadata = fetch_github_metadata(github_repo, github_token)
        if github_metadata:
            if not metadata['name']:
                metadata['name'] = github_metadata.get('name', '')
            if not metadata['description']:
                metadata['description'] = github_metadata.get(
                    'description', ''
                )
            if not metadata['author']:
                metadata['author'] = github_metadata.get('author', '')
            if (
                not metadata['license']
                or metadata['license'] == 'UNLICENSED'
            ):
                metadata['license'] = github_metadata.get(
                    'license', 'UNLICENSED'
                )
            metadata['repositoryType'] = github_metadata.get(
                'repository_type', 'app-starter'
            )
            # Merge topics from GitHub
            github_topics = github_metadata.get('topics', [])
            metadata['topics'] = _deduplicate(
                metadata.get('topics', []) + github_topics
            )
            if github_metadata.get('last_updated'):
                metadata['lastUpdated'] = github_metadata['last_updated']

        # Version: try GitHub Releases first, then package.json fallback
        release_version = fetch_github_release_version(
            github_repo, github_token
        )
        if release_version:
            metadata['version'] = release_version
        elif pkg_version:
            metadata['version'] = pkg_version
        # else version stays as empty string
    else:
        # No GitHub repo — use package.json version if available
        if pkg_version:
            metadata['version'] = pkg_version

    return metadata


def _collect_categorized_values(categorized: Dict) -> List[str]:
    """Collect all unique values from a categorized structure.

    Iterates over the ``buildDeploy``, ``applicationStack``, and
    ``postDeploy`` arrays and returns a deduplicated list of all values.

    Args:
        categorized (dict): A categorized structure with keys
            ``buildDeploy``, ``applicationStack``, and ``postDeploy``.

    Returns:
        list: Deduplicated list of all values across categories.

    Example:
        >>> _collect_categorized_values({
        ...     'buildDeploy': ['Python'],
        ...     'applicationStack': ['Node.js'],
        ...     'postDeploy': [],
        ... })
        ['Python', 'Node.js']
    """
    all_values: List[str] = []
    for key in ('buildDeploy', 'applicationStack', 'postDeploy'):
        all_values.extend(categorized.get(key, []))
    return _deduplicate(all_values)


def main():
    """Main entry point for the sidecar metadata generator.

    Parses command-line arguments, generates metadata, and writes the
    result to a JSON file.

    Returns:
        None
    """
    parser = argparse.ArgumentParser(
        description='Generate sidecar metadata for Atlantis app starters',
        epilog='For more information, see the Atlantis Platform documentation.',
    )
    parser.add_argument(
        '--repo-path',
        type=str,
        help='Path to local repository',
    )
    parser.add_argument(
        '--github-repo',
        type=str,
        help='GitHub repository in format owner/repo',
    )
    parser.add_argument(
        '--github-token',
        type=str,
        help=(
            'GitHub personal access token '
            '(optional, uses GITHUB_TOKEN env var if not provided)'
        ),
    )
    parser.add_argument(
        '--output',
        type=str,
        required=True,
        help='Output JSON file path',
    )
    parser.add_argument(
        '--pretty',
        action='store_true',
        help='Pretty-print JSON output',
    )

    args = parser.parse_args()

    # Validate arguments
    if not args.repo_path and not args.github_repo:
        print("Error: Either --repo-path or --github-repo must be provided")
        sys.exit(1)

    # Get GitHub token from environment if not provided
    github_token = args.github_token or os.environ.get('GITHUB_TOKEN')

    # Convert repo_path to Path object
    repo_path = Path(args.repo_path) if args.repo_path else None

    if repo_path and not repo_path.exists():
        print(f"Error: Repository path does not exist: {repo_path}")
        sys.exit(1)

    # Generate metadata
    print("Generating sidecar metadata...")
    metadata = generate_metadata(
        repo_path=repo_path,
        github_repo=args.github_repo,
        github_token=github_token,
    )

    # Write to output file
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        if args.pretty:
            json.dump(metadata, f, indent=2)
        else:
            json.dump(metadata, f)

    print(f"Sidecar metadata written to: {output_path}")
    print("Metadata summary:")
    print(f"  Name: {metadata['name']}")
    if metadata.get('displayName'):
        print(f"  Display Name: {metadata['displayName']}")

    langs = _collect_categorized_values(metadata.get('languages', {}))
    print(f"  Languages: {', '.join(langs) if langs else 'None'}")

    fws = _collect_categorized_values(metadata.get('frameworks', {}))
    print(f"  Frameworks: {', '.join(fws) if fws else 'None'}")

    feats = _collect_categorized_values(metadata.get('features', {}))
    print(f"  Features: {', '.join(feats) if feats else 'None'}")

    if metadata.get('version'):
        print(f"  Version: {metadata['version']}")


if __name__ == '__main__':
    main()
