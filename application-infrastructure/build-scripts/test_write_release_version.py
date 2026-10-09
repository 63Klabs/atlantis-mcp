#!/usr/bin/env python3
"""
Unit tests for write_release_version.py

Run with: python3 -m pytest test_write_release_version.py -v
Or: python3 test_write_release_version.py
"""

import os
import sys
import tempfile
import shutil
from pathlib import Path
import unittest

# Import the module under test
import write_release_version as wrv


class TestParseChangelogVersion(unittest.TestCase):
    """Test parse_changelog_version function."""
    
    def setUp(self):
        """Create temporary test files."""
        self.test_dir = tempfile.mkdtemp()
        self.changelog_path = Path(self.test_dir) / 'CHANGELOG.md'
    
    def tearDown(self):
        """Clean up temporary files."""
        shutil.rmtree(self.test_dir)
    
    def test_parse_unreleased_version(self):
        """Should parse unreleased version from CHANGELOG.md."""
        content = """# Changelog

## [v0.0.7] (unreleased)

### Added
- New feature
"""
        self.changelog_path.write_text(content)
        version = wrv.parse_changelog_version(self.changelog_path)
        self.assertEqual(version, '0.0.7')
    
    def test_parse_released_version(self):
        """Should parse released version from CHANGELOG.md."""
        content = """# Changelog

## [v0.0.6] (2026-09-02)

### Added
- Released feature
"""
        self.changelog_path.write_text(content)
        version = wrv.parse_changelog_version(self.changelog_path)
        self.assertEqual(version, '0.0.6')
    
    def test_parse_version_without_brackets(self):
        """Should parse version without brackets."""
        content = """# Changelog

## v1.2.3 (unreleased)

### Added
- Feature
"""
        self.changelog_path.write_text(content)
        version = wrv.parse_changelog_version(self.changelog_path)
        self.assertEqual(version, '1.2.3')
    
    def test_parse_first_version_only(self):
        """Should parse only the first version header."""
        content = """# Changelog

## [v0.0.8] (unreleased)

### Added
- New feature

## [v0.0.7] (2026-09-02)

### Fixed
- Bug fix
"""
        self.changelog_path.write_text(content)
        version = wrv.parse_changelog_version(self.changelog_path)
        self.assertEqual(version, '0.0.8')
    
    def test_no_version_header_raises_error(self):
        """Should raise ValueError when no version header found."""
        content = """# Changelog

No version headers here
"""
        self.changelog_path.write_text(content)
        with self.assertRaises(ValueError) as context:
            wrv.parse_changelog_version(self.changelog_path)
        self.assertIn('No version header found', str(context.exception))
    
    def test_missing_file_raises_error(self):
        """Should raise ValueError when CHANGELOG.md doesn't exist."""
        missing_path = Path(self.test_dir) / 'missing.md'
        with self.assertRaises(ValueError) as context:
            wrv.parse_changelog_version(missing_path)
        self.assertIn('not found', str(context.exception))


class TestWriteReleaseVersionFile(unittest.TestCase):
    """Test write_release_version_file function."""
    
    def setUp(self):
        """Create temporary test directory."""
        self.test_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.test_dir) / 'config'
    
    def tearDown(self):
        """Clean up temporary files."""
        shutil.rmtree(self.test_dir)
    
    def test_write_creates_directory(self):
        """Should create config directory if it doesn't exist."""
        self.assertFalse(self.config_dir.exists())
        wrv.write_release_version_file('0.0.7', self.config_dir)
        self.assertTrue(self.config_dir.exists())
    
    def test_write_creates_file(self):
        """Should create release-version.js file."""
        wrv.write_release_version_file('0.0.7', self.config_dir)
        output_file = self.config_dir / 'release-version.js'
        self.assertTrue(output_file.exists())
    
    def test_write_correct_content(self):
        """Should write correct module.exports format."""
        wrv.write_release_version_file('0.0.7', self.config_dir)
        output_file = self.config_dir / 'release-version.js'
        content = output_file.read_text()
        expected = "module.exports = { releaseVersion: '0.0.7' };\n"
        self.assertEqual(content, expected)
    
    def test_write_is_idempotent(self):
        """Should produce same file when run twice."""
        wrv.write_release_version_file('0.0.7', self.config_dir)
        output_file = self.config_dir / 'release-version.js'
        first_content = output_file.read_text()
        first_mtime = output_file.stat().st_mtime
        
        # Wait a tiny bit to ensure mtime would change if content changed
        import time
        time.sleep(0.01)
        
        wrv.write_release_version_file('0.0.7', self.config_dir)
        second_content = output_file.read_text()
        
        self.assertEqual(first_content, second_content)


class TestFindLambdaDirectories(unittest.TestCase):
    """Test find_lambda_directories function."""
    
    def setUp(self):
        """Create temporary test directory structure."""
        self.test_dir = tempfile.mkdtemp()
        self.lambda_dir = Path(self.test_dir) / 'src' / 'lambda'
        self.lambda_dir.mkdir(parents=True)
    
    def tearDown(self):
        """Clean up temporary files."""
        shutil.rmtree(self.test_dir)
    
    def test_find_lambda_directories(self):
        """Should find all Lambda function directories."""
        # Create function directories
        (self.lambda_dir / 'read-function').mkdir()
        (self.lambda_dir / 'auth-function').mkdir()
        (self.lambda_dir / 'doc-indexer').mkdir()
        
        found = wrv.find_lambda_directories(self.lambda_dir)
        self.assertEqual(len(found), 3)
        names = [d.name for d in found]
        self.assertIn('read-function', names)
        self.assertIn('auth-function', names)
        self.assertIn('doc-indexer', names)
    
    def test_exclude_layers_directory(self):
        """Should exclude the 'layers' directory."""
        # Create function directories and layers
        (self.lambda_dir / 'read-function').mkdir()
        (self.lambda_dir / 'layers').mkdir()
        (self.lambda_dir / 'layers' / 'common').mkdir()
        
        found = wrv.find_lambda_directories(self.lambda_dir)
        names = [d.name for d in found]
        self.assertNotIn('layers', names)
        self.assertEqual(len(found), 1)
    
    def test_exclude_files(self):
        """Should only return directories, not files."""
        (self.lambda_dir / 'read-function').mkdir()
        (self.lambda_dir / 'README.md').write_text('readme')
        
        found = wrv.find_lambda_directories(self.lambda_dir)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].name, 'read-function')
    
    def test_missing_directory_raises_error(self):
        """Should raise ValueError when lambda directory doesn't exist."""
        missing_dir = Path(self.test_dir) / 'missing'
        with self.assertRaises(ValueError) as context:
            wrv.find_lambda_directories(missing_dir)
        self.assertIn('not found', str(context.exception))
    
    def test_returns_sorted_list(self):
        """Should return directories in sorted order."""
        (self.lambda_dir / 'zeta-function').mkdir()
        (self.lambda_dir / 'alpha-function').mkdir()
        (self.lambda_dir / 'beta-function').mkdir()
        
        found = wrv.find_lambda_directories(self.lambda_dir)
        names = [d.name for d in found]
        self.assertEqual(names, ['alpha-function', 'beta-function', 'zeta-function'])


class TestIntegration(unittest.TestCase):
    """Integration tests for the complete script."""
    
    def setUp(self):
        """Create temporary test environment."""
        self.test_dir = tempfile.mkdtemp()
        self.repo_root = Path(self.test_dir)
        self.changelog = self.repo_root / 'CHANGELOG.md'
        self.lambda_dir = self.repo_root / 'application-infrastructure' / 'src' / 'lambda'
        self.lambda_dir.mkdir(parents=True)
    
    def tearDown(self):
        """Clean up temporary files."""
        shutil.rmtree(self.test_dir)
    
    def test_end_to_end_success(self):
        """Should successfully write release-version.js to all Lambda functions."""
        # Create CHANGELOG.md
        changelog_content = """# Changelog

## [v1.2.3] (unreleased)

### Added
- New feature
"""
        self.changelog.write_text(changelog_content)
        
        # Create Lambda function directories
        func1 = self.lambda_dir / 'api-handler'
        func2 = self.lambda_dir / 'event-processor'
        func1.mkdir()
        func2.mkdir()
        
        # Run the script logic
        version = wrv.parse_changelog_version(self.changelog)
        lambdas = wrv.find_lambda_directories(self.lambda_dir)
        
        for lambda_dir in lambdas:
            config_dir = lambda_dir / 'config'
            wrv.write_release_version_file(version, config_dir)
        
        # Verify results
        self.assertEqual(version, '1.2.3')
        
        for func_dir in [func1, func2]:
            output_file = func_dir / 'config' / 'release-version.js'
            self.assertTrue(output_file.exists())
            content = output_file.read_text()
            self.assertEqual(content, "module.exports = { releaseVersion: '1.2.3' };\n")


if __name__ == '__main__':
    unittest.main()
