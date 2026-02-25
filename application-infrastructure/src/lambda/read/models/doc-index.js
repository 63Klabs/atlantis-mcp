const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const Config = require('../config');
const GitHubAPI = require('./github-api');
const S3Templates = require('./s3-templates');

/**
 * Documentation Index DAO
 * 
 * Builds and searches a comprehensive index of:
 * - Markdown documentation from GitHub repositories
 * - CloudFormation template sections and patterns
 * - Python and Node.js code from app starters
 * - cache-data package usage patterns
 * - README headings and top-of-file comments
 * 
 * The index is built asynchronously at Lambda cold start for template repo
 * and cache-data package, with app starter indexing done on-demand.
 */

// In-memory index storage (per Lambda instance)
let documentationIndex = null;
let indexBuildInProgress = false;
let indexLastBuilt = null;

/**
 * Build searchable documentation index
 * 
 * @param {Object} options - Build options
 * @param {boolean} options.includeStarters - Whether to index app starters (default: false)
 * @param {boolean} options.force - Force rebuild even if index exists (default: false)
 * @returns {Promise<Object>} Index statistics
 */
const buildIndex = async (options = {}) => {
  const { includeStarters = false, force = false } = options;
  
  // Return existing index if available and not forcing rebuild
  if (documentationIndex && !force && !indexBuildInProgress) {
    return {
      cached: true,
      lastBuilt: indexLastBuilt,
      entryCount: documentationIndex.entries.length
    };
  }
  
  // Prevent concurrent builds
  if (indexBuildInProgress) {
    DebugAndLog.info('Documentation index build already in progress, waiting...');
    // Wait for existing build to complete (max 30 seconds)
    const startWait = Date.now();
    while (indexBuildInProgress && (Date.now() - startWait) < 30000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return {
      cached: true,
      lastBuilt: indexLastBuilt,
      entryCount: documentationIndex?.entries?.length || 0
    };
  }
  
  indexBuildInProgress = true;
  
  try {
    DebugAndLog.info('Building documentation index...');
    const startTime = Date.now();
    
    const index = {
      entries: [],
      metadata: {
        builtAt: new Date().toISOString(),
        sources: []
      }
    };
    
    // Index template repository documentation
    await indexTemplateRepository(index);
    
    // Index cache-data package documentation
    await indexCacheDataPackage(index);
    
    // Index CloudFormation templates
    await indexCloudFormationTemplates(index);
    
    // Index app starters (if requested)
    if (includeStarters) {
      await indexAppStarters(index);
    }
    
    documentationIndex = index;
    indexLastBuilt = new Date().toISOString();
    
    const duration = Date.now() - startTime;
    DebugAndLog.info(`Documentation index built in ${duration}ms with ${index.entries.length} entries`);
    
    return {
      cached: false,
      lastBuilt: indexLastBuilt,
      entryCount: index.entries.length,
      buildDuration: duration
    };
    
  } catch (error) {
    DebugAndLog.error(`Failed to build documentation index: ${error.message}`, error.stack);
    throw error;
  } finally {
    indexBuildInProgress = false;
  }
};

/**
 * Index markdown documentation from template repository
 */
const indexTemplateRepository = async (index) => {
  try {
    const settings = Config.settings();
    const githubUsers = settings.githubUsers || [];
    
    // Look for template repository in configured GitHub users/orgs
    for (const userOrg of githubUsers) {
      try {
        // Get repositories with atlantis_repository-type: templates
        const connection = {
          host: userOrg,
          path: '/repos',
          parameters: { repositoryType: 'templates' }
        };
        
        const repos = await GitHubAPI.listRepositories(connection, {});
        
        for (const repo of repos.repositories || []) {
          // Index markdown files from repository
          await indexMarkdownFiles(index, repo, 'templates');
        }
        
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'templates',
          indexed: true
        });
        
      } catch (error) {
        DebugAndLog.warn(`Failed to index template repository from ${userOrg}: ${error.message}`);
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'templates',
          indexed: false,
          error: error.message
        });
      }
    }
  } catch (error) {
    DebugAndLog.warn(`Failed to index template repositories: ${error.message}`);
  }
};

/**
 * Index cache-data package documentation
 */
const indexCacheDataPackage = async (index) => {
  try {
    const settings = Config.settings();
    const githubUsers = settings.githubUsers || [];
    
    // Look for cache-data package in configured GitHub users/orgs
    for (const userOrg of githubUsers) {
      try {
        const connection = {
          host: userOrg,
          path: '/repos',
          parameters: { repositoryType: 'package' }
        };
        
        const repos = await GitHubAPI.listRepositories(connection, {});
        
        for (const repo of repos.repositories || []) {
          if (repo.name && repo.name.includes('cache-data')) {
            // Index markdown files and code examples
            await indexMarkdownFiles(index, repo, 'package');
            await indexCodeExamples(index, repo, 'package');
          }
        }
        
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'package',
          indexed: true
        });
        
      } catch (error) {
        DebugAndLog.warn(`Failed to index cache-data package from ${userOrg}: ${error.message}`);
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'package',
          indexed: false,
          error: error.message
        });
      }
    }
  } catch (error) {
    DebugAndLog.warn(`Failed to index cache-data package: ${error.message}`);
  }
};

/**
 * Index CloudFormation templates
 */
const indexCloudFormationTemplates = async (index) => {
  try {
    const settings = Config.settings();
    const buckets = settings.atlantisS3Buckets || [];
    
    for (const bucket of buckets) {
      try {
        const connection = {
          host: bucket,
          path: 'templates/v2',
          parameters: {}
        };
        
        const result = await S3Templates.list(connection, {});
        const templates = result.templates || [];
        
        for (const template of templates) {
          // Get full template content
          const fullTemplate = await S3Templates.get({
            host: bucket,
            path: 'templates/v2',
            parameters: {
              category: template.category,
              templateName: template.name
            }
          }, {});
          
          if (fullTemplate) {
            // Index template sections
            await indexTemplateContent(index, fullTemplate, bucket);
          }
        }
        
        index.metadata.sources.push({
          type: 's3',
          bucket,
          resourceType: 'templates',
          indexed: true
        });
        
      } catch (error) {
        DebugAndLog.warn(`Failed to index templates from bucket ${bucket}: ${error.message}`);
        index.metadata.sources.push({
          type: 's3',
          bucket,
          resourceType: 'templates',
          indexed: false,
          error: error.message
        });
      }
    }
  } catch (error) {
    DebugAndLog.warn(`Failed to index CloudFormation templates: ${error.message}`);
  }
};

/**
 * Index app starters (on-demand)
 */
const indexAppStarters = async (index) => {
  try {
    const settings = Config.settings();
    const githubUsers = settings.githubUsers || [];
    
    for (const userOrg of githubUsers) {
      try {
        const connection = {
          host: userOrg,
          path: '/repos',
          parameters: { repositoryType: 'app-starter' }
        };
        
        const repos = await GitHubAPI.listRepositories(connection, {});
        
        for (const repo of repos.repositories || []) {
          // Index code examples from starters
          await indexCodeExamples(index, repo, 'app-starter');
          await indexMarkdownFiles(index, repo, 'app-starter');
        }
        
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'app-starter',
          indexed: true
        });
        
      } catch (error) {
        DebugAndLog.warn(`Failed to index app starters from ${userOrg}: ${error.message}`);
        index.metadata.sources.push({
          type: 'github',
          userOrg,
          repositoryType: 'app-starter',
          indexed: false,
          error: error.message
        });
      }
    }
  } catch (error) {
    DebugAndLog.warn(`Failed to index app starters: ${error.message}`);
  }
};

/**
 * Index markdown files from a GitHub repository
 */
const indexMarkdownFiles = async (index, repo, repositoryType) => {
  try {
    // Get README content
    const readme = await GitHubAPI.getReadme({
      host: repo.owner,
      path: `/repos/${repo.owner}/${repo.name}`,
      parameters: {}
    }, {});
    
    if (readme && readme.content) {
      // Parse README headings and content
      const headings = extractMarkdownHeadings(readme.content);
      
      for (const heading of headings) {
        index.entries.push({
          title: heading.title,
          excerpt: heading.excerpt,
          content: heading.content,
          filePath: 'README.md',
          githubUrl: `https://github.com/${repo.owner}/${repo.name}#${heading.anchor}`,
          type: 'documentation',
          subType: determineDocumentationType(heading.title),
          repository: repo.name,
          repositoryType,
          owner: repo.owner,
          keywords: extractKeywords(heading.title + ' ' + heading.content),
          metadata: {
            level: heading.level,
            lineNumber: heading.lineNumber
          }
        });
      }
    }
    
    // TODO: Index other markdown files from docs/ directory
    // This would require additional GitHub API calls to list directory contents
    
  } catch (error) {
    DebugAndLog.warn(`Failed to index markdown files from ${repo.name}: ${error.message}`);
  }
};

/**
 * Index code examples from repository
 */
const indexCodeExamples = async (index, repo, repositoryType) => {
  try {
    // For cache-data package, index key functions and usage patterns
    // For app starters, index Lambda handlers and key functions
    
    // This is a simplified implementation
    // Full implementation would use GitHub API to fetch file contents
    
    const codePatterns = [
      {
        pattern: 'CacheableDataAccess.getData',
        description: 'Pass-through caching pattern',
        language: 'javascript'
      },
      {
        pattern: 'Cache.init',
        description: 'Cache initialization',
        language: 'javascript'
      },
      {
        pattern: 'Config.getConnCacheProfile',
        description: 'Get connection and cache profile',
        language: 'javascript'
      }
    ];
    
    for (const pattern of codePatterns) {
      index.entries.push({
        title: pattern.description,
        excerpt: `Code pattern: ${pattern.pattern}`,
        content: pattern.pattern,
        filePath: 'src/lib/',
        githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
        type: 'code-example',
        subType: 'function',
        repository: repo.name,
        repositoryType,
        owner: repo.owner,
        keywords: extractKeywords(pattern.pattern + ' ' + pattern.description),
        codeExamples: [{
          language: pattern.language,
          code: pattern.pattern,
          lineNumbers: '1-1'
        }],
        context: {
          functionName: pattern.pattern
        }
      });
    }
    
  } catch (error) {
    DebugAndLog.warn(`Failed to index code examples from ${repo.name}: ${error.message}`);
  }
};

/**
 * Index CloudFormation template content
 */
const indexTemplateContent = async (index, template, bucket) => {
  try {
    const yaml = require('js-yaml');
    const parsed = yaml.load(template.content);
    
    // Index template sections
    const sections = ['Metadata', 'Parameters', 'Mappings', 'Conditions', 'Resources', 'Outputs'];
    
    for (const section of sections) {
      if (parsed[section]) {
        const sectionContent = JSON.stringify(parsed[section], null, 2);
        
        index.entries.push({
          title: `${template.name} - ${section}`,
          excerpt: `CloudFormation ${section} section from ${template.name}`,
          content: sectionContent,
          filePath: template.s3Path,
          githubUrl: null,
          type: 'template-pattern',
          subType: 'resource',
          repository: null,
          repositoryType: 'templates',
          namespace: template.namespace,
          bucket,
          keywords: extractKeywords(`${section} ${template.category} ${template.name}`),
          context: {
            templateSection: section,
            templateName: template.name,
            category: template.category
          }
        });
        
        // Index individual resources
        if (section === 'Resources') {
          for (const [resourceName, resourceDef] of Object.entries(parsed[section])) {
            index.entries.push({
              title: `${resourceName} (${resourceDef.Type})`,
              excerpt: `CloudFormation resource: ${resourceDef.Type}`,
              content: JSON.stringify(resourceDef, null, 2),
              filePath: template.s3Path,
              githubUrl: null,
              type: 'template-pattern',
              subType: 'resource',
              repository: null,
              repositoryType: 'templates',
              namespace: template.namespace,
              bucket,
              keywords: extractKeywords(`${resourceName} ${resourceDef.Type} ${template.category}`),
              context: {
                templateSection: 'Resources',
                resourceType: resourceDef.Type,
                resourceName,
                templateName: template.name,
                category: template.category
              }
            });
          }
        }
      }
    }
    
  } catch (error) {
    DebugAndLog.warn(`Failed to index template content for ${template.name}: ${error.message}`);
  }
};

/**
 * Search documentation index
 * 
 * @param {Object} options - Search options
 * @param {string} options.query - Search query (keywords)
 * @param {string} options.type - Filter by type (documentation, template-pattern, code-example)
 * @param {string} options.subType - Filter by subType (guide, tutorial, reference, etc.)
 * @param {number} options.limit - Maximum results (default: 10)
 * @returns {Promise<Object>} Search results with relevance ranking
 */
const search = async (options = {}) => {
  const { query, type, subType, limit = 10 } = options;
  
  // Ensure index is built
  if (!documentationIndex) {
    await buildIndex({ includeStarters: false });
  }
  
  if (!documentationIndex || !documentationIndex.entries) {
    return {
      results: [],
      totalResults: 0,
      query,
      suggestions: ['Try building the documentation index first']
    };
  }
  
  // Normalize query
  const queryKeywords = extractKeywords(query);
  
  // Search and rank results
  let results = documentationIndex.entries
    .map(entry => ({
      ...entry,
      relevanceScore: calculateRelevance(entry, queryKeywords)
    }))
    .filter(entry => entry.relevanceScore > 0);
  
  // Apply type filters
  if (type) {
    results = results.filter(entry => entry.type === type);
  }
  
  if (subType) {
    results = results.filter(entry => entry.subType === subType);
  }
  
  // Sort by relevance
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Limit results
  const totalResults = results.length;
  results = results.slice(0, limit);
  
  // Generate suggestions if no results
  const suggestions = totalResults === 0 ? generateSuggestions(query, documentationIndex) : [];
  
  return {
    results: results.map(r => ({
      title: r.title,
      excerpt: r.excerpt.substring(0, 200),
      filePath: r.filePath,
      githubUrl: r.githubUrl,
      type: r.type,
      subType: r.subType,
      relevanceScore: r.relevanceScore,
      repository: r.repository,
      repositoryType: r.repositoryType,
      namespace: r.namespace,
      codeExamples: r.codeExamples,
      context: r.context
    })),
    totalResults,
    query,
    suggestions
  };
};

/**
 * Extract markdown headings from content
 */
const extractMarkdownHeadings = (content) => {
  const headings = [];
  const lines = content.split('\n');
  
  let currentHeading = null;
  let currentContent = [];
  let lineNumber = 0;
  
  for (const line of lines) {
    lineNumber++;
    
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      // Save previous heading
      if (currentHeading) {
        headings.push({
          ...currentHeading,
          content: currentContent.join('\n').trim(),
          excerpt: currentContent.join(' ').substring(0, 200).trim()
        });
      }
      
      // Start new heading
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const anchor = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      currentHeading = {
        level,
        title,
        anchor,
        lineNumber
      };
      currentContent = [];
    } else if (currentHeading) {
      currentContent.push(line);
    }
  }
  
  // Save last heading
  if (currentHeading) {
    headings.push({
      ...currentHeading,
      content: currentContent.join('\n').trim(),
      excerpt: currentContent.join(' ').substring(0, 200).trim()
    });
  }
  
  return headings;
};

/**
 * Determine documentation type from heading
 */
const determineDocumentationType = (title) => {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes('guide') || lowerTitle.includes('how to')) {
    return 'guide';
  }
  if (lowerTitle.includes('tutorial') || lowerTitle.includes('getting started')) {
    return 'tutorial';
  }
  if (lowerTitle.includes('reference') || lowerTitle.includes('api')) {
    return 'reference';
  }
  if (lowerTitle.includes('troubleshoot') || lowerTitle.includes('debug') || lowerTitle.includes('error')) {
    return 'troubleshooting';
  }
  
  return 'guide';
};

/**
 * Extract keywords from text
 */
const extractKeywords = (text) => {
  if (!text) return [];
  
  // Normalize and split into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
  
  // Remove common stop words
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'been', 'have', 'has', 'had']);
  
  return [...new Set(words.filter(word => !stopWords.has(word)))];
};

/**
 * Calculate relevance score
 */
const calculateRelevance = (entry, queryKeywords) => {
  let score = 0;
  
  const entryKeywords = entry.keywords || [];
  const titleKeywords = extractKeywords(entry.title);
  const excerptKeywords = extractKeywords(entry.excerpt);
  
  // Title matches are most important
  for (const keyword of queryKeywords) {
    if (titleKeywords.includes(keyword)) {
      score += 10;
    }
    if (excerptKeywords.includes(keyword)) {
      score += 5;
    }
    if (entryKeywords.includes(keyword)) {
      score += 3;
    }
  }
  
  // Exact phrase match bonus
  const queryLower = queryKeywords.join(' ');
  if (entry.title.toLowerCase().includes(queryLower)) {
    score += 20;
  }
  if (entry.excerpt.toLowerCase().includes(queryLower)) {
    score += 10;
  }
  
  return score;
};

/**
 * Generate search suggestions
 */
const generateSuggestions = (query, index) => {
  const suggestions = [];
  
  // Suggest popular topics
  const topicCounts = {};
  for (const entry of index.entries) {
    for (const keyword of entry.keywords || []) {
      topicCounts[keyword] = (topicCounts[keyword] || 0) + 1;
    }
  }
  
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
  
  if (topTopics.length > 0) {
    suggestions.push(`Try searching for: ${topTopics.join(', ')}`);
  }
  
  // Suggest broadening search
  suggestions.push('Try using fewer or more general keywords');
  
  // Suggest specific types
  suggestions.push('Try filtering by type: documentation, template-pattern, or code-example');
  
  return suggestions;
};

module.exports = {
  buildIndex,
  search
};
