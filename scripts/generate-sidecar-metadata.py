#!/usr/bin/env python3
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
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


def extract_from_package_json(repo_path: Path) -> Dict:
    """Extract metadata from package.json (Node.js projects).

    Reads package.json to extract name, description, version, author, license,
    dependencies, and devDependencies. Also detects if @63klabs/cache-data is
    present in dependencies.

    Args:
        repo_path (Path): Path to the repository root directory.

    Returns:
        dict: Extracted metadata including name, description, version, author,
            license, languages, dependencies, devDependencies, and hasCacheData.
            Returns empty dict if package.json does not exist or cannot be parsed.

    Example:
        >>> metadata = extract_from_package_json(Path('./my-project'))
        >>> print(metadata.get('languages'))
        ['Node.js']
    """
    package_json_path = repo_path / "package.json"

    if not package_json_path.exists():
        return {}

    try:
        with open(package_json_path, 'r') as f:
            package_data = json.load(f)

        deps = package_data.get('dependencies', {})
        dev_deps = package_data.get('devDependencies', {})

        return {
            'name': package_data.get('name', ''),
            'description': package_data.get('description', ''),
            'version': package_data.get('version', ''),
            'author': package_data.get('author', ''),
            'license': package_data.get('license', ''),
            'languages': ['Node.js'],
            'dependencies': list(deps.keys()),
            'devDependencies': list(dev_deps.keys()),
            'hasCacheData': '@63klabs/cache-data' in deps,
        }
    except Exception as e:
        print(f"Warning: Could not parse package.json: {e}")
        return {}


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
    requirements.txt, README.md, file detection) and optional GitHub API
    data into a single sidecar metadata dictionary.

    Args:
        repo_path (Path, optional): Path to local repository.
        github_repo (str, optional): GitHub repository in ``owner/repo`` format.
        github_token (str, optional): GitHub personal access token.

    Returns:
        dict: Complete sidecar metadata dictionary with fields: name,
            description, languages, frameworks, topics, features,
            prerequisites, dependencies, devDependencies, hasCacheData,
            deployment_platform, repository, author, license,
            repository_type, version, and last_updated.

    Example:
        >>> metadata = generate_metadata(repo_path=Path('./my-starter'))
        >>> print(metadata['languages'])
        ['Node.js']
    """
    metadata: Dict = {
        'name': '',
        'description': '',
        'languages': [],
        'frameworks': [],
        'topics': [],
        'features': [],
        'prerequisites': [],
        'dependencies': [],
        'devDependencies': [],
        'hasCacheData': False,
        'deployment_platform': 'atlantis',
        'repository': '',
        'author': '',
        'license': 'UNLICENSED',
        'repository_type': 'app-starter',
        'version': '1.0.0',
        'last_updated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    }

    # Extract from local repository
    if repo_path:
        # Try package.json first (Node.js)
        package_metadata = extract_from_package_json(repo_path)
        if package_metadata:
            metadata.update(package_metadata)

        # Try requirements.txt (Python)
        requirements_metadata = extract_from_requirements_txt(repo_path)
        if requirements_metadata:
            # Merge languages rather than overwrite
            existing_langs = metadata.get('languages', [])
            new_langs = requirements_metadata.pop('languages', [])
            metadata.update(requirements_metadata)
            metadata['languages'] = _deduplicate(existing_langs + new_langs)

        # Extract description from README
        readme_metadata = extract_from_readme(repo_path)
        if readme_metadata and not metadata['description']:
            metadata['description'] = readme_metadata.get('description', '')

        # Detect frameworks
        if metadata['languages']:
            metadata['frameworks'] = detect_framework(
                repo_path, metadata['languages']
            )

        # Detect features from files
        file_features = detect_features(repo_path)

        # Parse README sections for features and prerequisites
        readme_sections = parse_readme_sections(repo_path)

        # Merge and deduplicate features
        metadata['features'] = _deduplicate(
            file_features + readme_sections.get('features', [])
        )

        # Extract prerequisites from project structure
        inferred_prereqs = extract_prerequisites(
            repo_path, metadata['languages']
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
                metadata['description'] = github_metadata.get('description', '')
            if not metadata['author']:
                metadata['author'] = github_metadata.get('author', '')
            if not metadata['license'] or metadata['license'] == 'UNLICENSED':
                metadata['license'] = github_metadata.get('license', 'UNLICENSED')
            metadata['repository_type'] = github_metadata.get(
                'repository_type', 'app-starter'
            )
            # Merge topics from GitHub
            github_topics = github_metadata.get('topics', [])
            metadata['topics'] = _deduplicate(
                metadata.get('topics', []) + github_topics
            )
            if github_metadata.get('last_updated'):
                metadata['last_updated'] = github_metadata['last_updated']

    return metadata


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
    langs = ', '.join(metadata['languages']) if metadata['languages'] else 'None'
    print(f"  Languages: {langs}")
    fws = ', '.join(metadata['frameworks']) if metadata['frameworks'] else 'None'
    print(f"  Frameworks: {fws}")
    feats = ', '.join(metadata['features']) if metadata['features'] else 'None'
    print(f"  Features: {feats}")


if __name__ == '__main__':
    main()
