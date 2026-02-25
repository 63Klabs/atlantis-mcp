#!/usr/bin/env python3
"""
Generate Sidecar Metadata for Atlantis App Starters

This script generates sidecar metadata JSON files for app starter repositories.
The metadata is used by the Atlantis MCP Server to provide rich information
about starters without extracting ZIP files.

Usage:
    python generate-sidecar-metadata.py --repo-path /path/to/repo --output starter.json
    python generate-sidecar-metadata.py --github-repo owner/repo --output starter.json
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Install with: pip install requests")
    sys.exit(1)


def extract_from_package_json(repo_path: Path) -> Dict:
    """Extract metadata from package.json (Node.js projects)"""
    package_json_path = repo_path / "package.json"
    
    if not package_json_path.exists():
        return {}
    
    try:
        with open(package_json_path, 'r') as f:
            package_data = json.load(f)
        
        return {
            'name': package_data.get('name', ''),
            'description': package_data.get('description', ''),
            'version': package_data.get('version', ''),
            'author': package_data.get('author', ''),
            'license': package_data.get('license', ''),
            'language': 'Node.js',
            'dependencies': list(package_data.get('dependencies', {}).keys())
        }
    except Exception as e:
        print(f"Warning: Could not parse package.json: {e}")
        return {}


def extract_from_requirements_txt(repo_path: Path) -> Dict:
    """Extract metadata from requirements.txt (Python projects)"""
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
            'language': 'Python',
            'dependencies': dependencies
        }
    except Exception as e:
        print(f"Warning: Could not parse requirements.txt: {e}")
        return {}


def extract_from_readme(repo_path: Path) -> Dict:
    """Extract metadata from README.md"""
    readme_paths = [
        repo_path / "README.md",
        repo_path / "readme.md",
        repo_path / "README.MD"
    ]
    
    for readme_path in readme_paths:
        if readme_path.exists():
            try:
                with open(readme_path, 'r') as f:
                    content = f.read()
                
                # Extract first paragraph as description
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


def detect_framework(repo_path: Path, language: str) -> str:
    """Detect framework based on dependencies and files"""
    if language == 'Node.js':
        package_json_path = repo_path / "package.json"
        if package_json_path.exists():
            try:
                with open(package_json_path, 'r') as f:
                    package_data = json.load(f)
                    deps = package_data.get('dependencies', {})
                    
                    if 'express' in deps:
                        return 'Express'
                    elif 'fastify' in deps:
                        return 'Fastify'
                    elif 'koa' in deps:
                        return 'Koa'
                    elif 'next' in deps:
                        return 'Next.js'
                    elif 'react' in deps:
                        return 'React'
            except:
                pass
    
    elif language == 'Python':
        requirements_path = repo_path / "requirements.txt"
        if requirements_path.exists():
            try:
                with open(requirements_path, 'r') as f:
                    content = f.read().lower()
                    
                    if 'fastapi' in content:
                        return 'FastAPI'
                    elif 'flask' in content:
                        return 'Flask'
                    elif 'django' in content:
                        return 'Django'
            except:
                pass
    
    return 'None'


def detect_features(repo_path: Path) -> List[str]:
    """Detect features based on files and dependencies"""
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
        except:
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


def extract_prerequisites(repo_path: Path, language: str) -> List[str]:
    """Extract prerequisites from README or infer from project"""
    prerequisites = []
    
    # Language-specific prerequisites
    if language == 'Node.js':
        prerequisites.append('Node.js 18.x or later')
        prerequisites.append('npm or yarn')
    elif language == 'Python':
        prerequisites.append('Python 3.9 or later')
        prerequisites.append('pip')
    
    # AWS prerequisites
    if (repo_path / "template.yml").exists():
        prerequisites.append('AWS CLI configured')
        prerequisites.append('AWS SAM CLI')
    
    return prerequisites


def fetch_github_metadata(repo_full_name: str, github_token: Optional[str] = None) -> Dict:
    """Fetch metadata from GitHub API"""
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
        props_url = f'https://api.github.com/repos/{repo_full_name}/properties/values'
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
            'license': repo_data.get('license', {}).get('spdx_id', 'UNLICENSED'),
            'repository_type': repository_type,
            'github_url': repo_data.get('html_url', ''),
            'last_updated': repo_data.get('updated_at', '')
        }
    except requests.exceptions.RequestException as e:
        print(f"Warning: Could not fetch GitHub metadata: {e}")
        return {}


def generate_metadata(
    repo_path: Optional[Path] = None,
    github_repo: Optional[str] = None,
    github_token: Optional[str] = None
) -> Dict:
    """Generate complete sidecar metadata"""
    metadata = {
        'name': '',
        'description': '',
        'language': '',
        'framework': '',
        'features': [],
        'prerequisites': [],
        'author': '',
        'license': 'UNLICENSED',
        'repository_type': 'app-starter',
        'version': '1.0.0',
        'last_updated': datetime.utcnow().isoformat() + 'Z'
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
            metadata.update(requirements_metadata)
        
        # Extract from README
        readme_metadata = extract_from_readme(repo_path)
        if readme_metadata and not metadata['description']:
            metadata.update(readme_metadata)
        
        # Detect framework
        if metadata['language']:
            metadata['framework'] = detect_framework(repo_path, metadata['language'])
        
        # Detect features
        metadata['features'] = detect_features(repo_path)
        
        # Extract prerequisites
        metadata['prerequisites'] = extract_prerequisites(repo_path, metadata['language'])
    
    # Fetch from GitHub
    if github_repo:
        github_metadata = fetch_github_metadata(github_repo, github_token)
        # GitHub metadata takes precedence for certain fields
        if github_metadata:
            if not metadata['name']:
                metadata['name'] = github_metadata.get('name', '')
            if not metadata['description']:
                metadata['description'] = github_metadata.get('description', '')
            if not metadata['author']:
                metadata['author'] = github_metadata.get('author', '')
            if not metadata['license'] or metadata['license'] == 'UNLICENSED':
                metadata['license'] = github_metadata.get('license', 'UNLICENSED')
            metadata['repository_type'] = github_metadata.get('repository_type', 'app-starter')
            metadata['github_url'] = github_metadata.get('github_url', '')
            if github_metadata.get('last_updated'):
                metadata['last_updated'] = github_metadata['last_updated']
    
    return metadata


def main():
    parser = argparse.ArgumentParser(
        description='Generate sidecar metadata for Atlantis app starters'
    )
    parser.add_argument(
        '--repo-path',
        type=str,
        help='Path to local repository'
    )
    parser.add_argument(
        '--github-repo',
        type=str,
        help='GitHub repository in format owner/repo'
    )
    parser.add_argument(
        '--github-token',
        type=str,
        help='GitHub personal access token (optional, uses GITHUB_TOKEN env var if not provided)'
    )
    parser.add_argument(
        '--output',
        type=str,
        required=True,
        help='Output JSON file path'
    )
    parser.add_argument(
        '--pretty',
        action='store_true',
        help='Pretty-print JSON output'
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
        github_token=github_token
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
    print(f"Metadata summary:")
    print(f"  Name: {metadata['name']}")
    print(f"  Language: {metadata['language']}")
    print(f"  Framework: {metadata['framework']}")
    print(f"  Features: {', '.join(metadata['features']) if metadata['features'] else 'None'}")


if __name__ == '__main__':
    main()
