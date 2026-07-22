const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');

/**
 * GitHub API Data Access Object
 *
 * Provides access to GitHub repository metadata, custom properties, README content,
 * releases, and statistics. Implements brown-out support to continue operation when
 * some GitHub users/orgs fail.
 *
 * @module models/github-api
 */

/**
 * List repositories from multiple GitHub users/orgs with brown-out support
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - GitHub user/org name(s)
 * @param {Object} connection.parameters - Query parameters
 * @param {string} [connection.parameters.repositoryType] - Filter by atlantis_repository-type
 * @param {Object} options - Reserved for future use (not in cache key)
 * @returns {Promise<Object>} { repositories: Array, errors: Array, partialData: boolean }
 */
const listRepositories = async (connection, options = {}) => {
  const { repositoryType } = connection.parameters || {};

  // Ensure host is an array
  const usersOrgs = Array.isArray(connection.host) ? connection.host : [connection.host];

  const allRepositories = [];
  const errors = [];

  // Get GitHub token from config
  const settings = Config.settings();
  const githubToken = settings.githubToken;

  if (!githubToken) {
    DebugAndLog.error('GitHub token not configured');
    throw new Error('GitHub token not configured');
  }

  // Iterate through users/orgs in priority order
  for (const userOrg of usersOrgs) {
    try {
      DebugAndLog.info(`Listing repositories for GitHub user/org: ${userOrg}`);

      // Fetch repositories from GitHub API
      const repos = await fetchRepositoriesFromGitHub(userOrg, githubToken);

      // Filter repositories by custom property if specified
      const filteredRepos = [];
      for (const repo of repos) {
        try {
          // Get custom property atlantis_repository-type
          const customProperty = await getCustomProperty(userOrg, repo.name, githubToken);

          // Skip repositories without atlantis_repository-type property
          if (!customProperty) {
            DebugAndLog.warn(`Repository ${userOrg}/${repo.name} does not have atlantis_repository-type custom property, skipping`);
            continue;
          }

          // Filter by repository type if specified
          if (repositoryType && customProperty !== repositoryType) {
            continue;
          }

          // Add custom property to repository metadata
          repo.atlantis_repository_type = customProperty;
          repo.userOrg = userOrg;

          filteredRepos.push(repo);
        } catch (error) {
          DebugAndLog.warn(`Failed to get custom property for ${userOrg}/${repo.name}: ${error.message}`);
          // Continue with other repositories
        }
      }

      allRepositories.push(...filteredRepos);

    } catch (error) {
      // Brown-out support: log error but continue with other users/orgs
      DebugAndLog.warn(`Failed to list repositories from user/org ${userOrg}: ${error.message}`);
      errors.push({
        source: userOrg,
        sourceType: 'github',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Deduplicate repositories (first occurrence wins due to priority ordering)
  const uniqueRepositories = deduplicateRepositories(allRepositories);

  return {
    repositories: uniqueRepositories,
    errors: errors.length > 0 ? errors : undefined,
    partialData: errors.length > 0
  };
};

/**
 * Get specific repository metadata
 *
 * @param {Object} connection - Connection object
 * @param {Array<string>|string} connection.host - GitHub user/org name(s)
 * @param {Object} connection.parameters - Query parameters
 * @param {string} connection.parameters.repositoryName - Repository name
 * @param {Object} options - Reserved for future use
 * @returns {Promise<Object|null>} Repository metadata or null if not found
 */
const getRepository = async (connection, options = {}) => {
  const { repositoryName } = connection.parameters || {};

  if (!repositoryName) {
    throw new Error('repositoryName parameter is required');
  }

  const usersOrgs = Array.isArray(connection.host) ? connection.host : [connection.host];

  const settings = Config.settings();
  const githubToken = settings.githubToken;

  if (!githubToken) {
    throw new Error('GitHub token not configured');
  }

  // Search users/orgs in priority order
  for (const userOrg of usersOrgs) {
    try {
      DebugAndLog.info(`Getting repository ${userOrg}/${repositoryName}`);

      const repo = await fetchRepositoryFromGitHub(userOrg, repositoryName, githubToken);

      if (repo) {
        // Get custom property
        try {
          const customProperty = await getCustomProperty(userOrg, repositoryName, githubToken);
          if (customProperty) {
            repo.atlantis_repository_type = customProperty;
          }
        } catch (error) {
          DebugAndLog.warn(`Failed to get custom property for ${userOrg}/${repositoryName}: ${error.message}`);
        }

        repo.userOrg = userOrg;
        return repo;
      }
    } catch (error) {
      DebugAndLog.warn(`Failed to get repository from ${userOrg}: ${error.message}`);
      // Continue to next user/org
    }
  }

  // Repository not found in any user/org
  return null;
};

/**
 * Get custom property value for a repository using Repository Properties API
 *
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} repositoryName - Repository name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<string|null>} Custom property value or null if not set
 */
const getCustomProperty = async (userOrg, repositoryName, githubToken) => {
  try {
    // GitHub Repository Properties API endpoint
    const url = `https://api.github.com/repos/${userOrg}/${repositoryName}/properties/values`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000).toISOString()}`);
    }

    if (response.status === 404) {
      // Custom properties not set for this repository
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const properties = await response.json();

    // Find atlantis_repository-type property
    const atlantisProperty = properties.find(prop => prop.property_name === 'atlantis_repository-type');

    return atlantisProperty ? atlantisProperty.value : null;

  } catch (error) {
    DebugAndLog.warn(`Failed to get custom property for ${userOrg}/${repositoryName}: ${error.message}`);
    throw error;
  }
};

/**
 * Get README content from a repository
 *
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} repositoryName - Repository name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<Object>} README content and metadata
 */
const getReadme = async (userOrg, repositoryName, githubToken) => {
  try {
    const url = `https://api.github.com/repos/${userOrg}/${repositoryName}/readme`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000).toISOString()}`);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const readme = await response.json();

    // Decode base64 content
    const content = Buffer.from(readme.content, 'base64').toString('utf-8');

    return {
      name: readme.name,
      path: readme.path,
      content: content,
      size: readme.size,
      url: readme.html_url,
      downloadUrl: readme.download_url
    };

  } catch (error) {
    DebugAndLog.warn(`Failed to get README for ${userOrg}/${repositoryName}: ${error.message}`);
    throw error;
  }
};

/**
 * Get release information from a repository
 *
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} repositoryName - Repository name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<Array>} Array of release information
 */
const getReleases = async (userOrg, repositoryName, githubToken) => {
  try {
    const url = `https://api.github.com/repos/${userOrg}/${repositoryName}/releases`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000).toISOString()}`);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();

    return releases.map(release => ({
      id: release.id,
      tagName: release.tag_name,
      name: release.name,
      body: release.body,
      draft: release.draft,
      prerelease: release.prerelease,
      createdAt: release.created_at,
      publishedAt: release.published_at,
      url: release.html_url,
      author: {
        login: release.author.login,
        avatarUrl: release.author.avatar_url,
        url: release.author.html_url
      }
    }));

  } catch (error) {
    DebugAndLog.warn(`Failed to get releases for ${userOrg}/${repositoryName}: ${error.message}`);
    throw error;
  }
};

/**
 * Get repository statistics (stars, forks, last updated)
 *
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} repositoryName - Repository name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<Object>} Repository statistics
 */
const getRepositoryStats = async (userOrg, repositoryName, githubToken) => {
  try {
    const repo = await fetchRepositoryFromGitHub(userOrg, repositoryName, githubToken);

    if (!repo) {
      throw new Error(`Repository ${userOrg}/${repositoryName} not found`);
    }

    return {
      stars: repo.stargazersCount,
      forks: repo.forksCount,
      watchers: repo.watchersCount,
      openIssues: repo.openIssuesCount,
      size: repo.size,
      language: repo.language,
      lastUpdated: repo.updatedAt,
      createdAt: repo.createdAt,
      pushedAt: repo.pushedAt
    };

  } catch (error) {
    DebugAndLog.warn(`Failed to get stats for ${userOrg}/${repositoryName}: ${error.message}`);
    throw error;
  }
};

/**
 * Fetch repositories from GitHub API for a user or organization
 *
 * @private
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<Array>} Array of repository metadata
 */
const fetchRepositoriesFromGitHub = async (userOrg, githubToken) => {
  try {
    // Try organization repos first
    let url = `https://api.github.com/orgs/${userOrg}/repos?per_page=100`;

    let response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // If not an org, try user repos
    if (response.status === 404) {
      url = `https://api.github.com/users/${userOrg}/repos?per_page=100`;
      response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
    }

    // Handle rate limiting
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000).toISOString()}`);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const repos = await response.json();

    return repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      defaultBranch: repo.default_branch,
      language: repo.language,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      watchersCount: repo.watchers_count,
      openIssuesCount: repo.open_issues_count,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at
    }));

  } catch (error) {
    DebugAndLog.error(`Failed to fetch repositories from GitHub for ${userOrg}: ${error.message}`);
    throw error;
  }
};

/**
 * Fetch a specific repository from GitHub API
 *
 * @private
 * @param {string} userOrg - GitHub user or organization name
 * @param {string} repositoryName - Repository name
 * @param {string} githubToken - GitHub access token
 * @returns {Promise<Object|null>} Repository metadata or null if not found
 */
const fetchRepositoryFromGitHub = async (userOrg, repositoryName, githubToken) => {
  try {
    const url = `https://api.github.com/repos/${userOrg}/${repositoryName}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      throw new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000).toISOString()}`);
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const repo = await response.json();

    return {
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      defaultBranch: repo.default_branch,
      language: repo.language,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      watchersCount: repo.watchers_count,
      openIssuesCount: repo.open_issues_count,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at
    };

  } catch (error) {
    DebugAndLog.error(`Failed to fetch repository ${userOrg}/${repositoryName}: ${error.message}`);
    throw error;
  }
};

/**
 * Deduplicate repositories across multiple users/orgs
 * First occurrence wins due to priority ordering
 *
 * @private
 * @param {Array} repositories - Array of repository objects
 * @returns {Array} Deduplicated array of repositories
 */
const deduplicateRepositories = (repositories) => {
  const seen = new Set();
  const unique = [];

  for (const repo of repositories) {
    const key = repo.name.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(repo);
    }
  }

  return unique;
};

module.exports = {
  listRepositories,
  getRepository,
  getCustomProperty,
  getReadme,
  getReleases,
  getRepositoryStats
};
