/**
 * Request routing for MCP server read-only operations
 * 
 * This module handles routing of incoming API Gateway requests to the appropriate
 * controllers based on the MCP tool name. It creates ClientRequest objects from
 * API Gateway events and delegates to controllers for processing.
 * 
 * @module routes
 */

const { tools: { ClientRequest, Response, DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Process incoming request and route to appropriate controller
 * 
 * @param {Object} event - API Gateway event
 * @param {Object} context - Lambda context
 * @returns {Promise<Response>} Response object
 * @example
 * const response = await Routes.process(event, context);
 * return response.toAPIGateway();
 */
const process = async (event, context) => {
  const REQ = new ClientRequest(event, context);
  const RESP = new Response(REQ);
  
  // Validate request
  if (!REQ.isValid()) {
    DebugAndLog.warn('Invalid request received', { event });
    return RESP.reset({ statusCode: 400, body: { error: 'Invalid request format' } });
  }
  
  const props = REQ.getProps();
  
  // Extract MCP tool name from request body or query parameters
  // MCP protocol typically sends tool name in request body
  const tool = props.body?.tool || props.queryStringParameters?.tool;
  
  if (!tool) {
    DebugAndLog.warn('No tool specified in request', { props });
    return RESP.reset({ statusCode: 400, body: { error: 'Missing tool parameter' } });
  }
  
  // Log routing decision
  DebugAndLog.info('Routing request', { 
    tool, 
    method: props.httpMethod,
    path: props.path,
    requestId: context.requestId 
  });
  
  try {
    // Route to appropriate controller based on tool name
    switch (tool) {
      case 'list_templates':
        // Import controller dynamically to avoid circular dependencies
        const TemplatesController = require('../controllers/templates');
        RESP.setBody(await TemplatesController.list(props));
        break;
        
      case 'get_template':
        const TemplatesControllerGet = require('../controllers/templates');
        RESP.setBody(await TemplatesControllerGet.get(props));
        break;
        
      case 'list_template_versions':
        const TemplatesControllerVersions = require('../controllers/templates');
        RESP.setBody(await TemplatesControllerVersions.listVersions(props));
        break;
        
      case 'list_categories':
        const TemplatesControllerCategories = require('../controllers/templates');
        RESP.setBody(await TemplatesControllerCategories.listCategories(props));
        break;
        
      case 'list_starters':
        const StartersController = require('../controllers/starters');
        RESP.setBody(await StartersController.list(props));
        break;
        
      case 'get_starter_info':
        const StartersControllerGet = require('../controllers/starters');
        RESP.setBody(await StartersControllerGet.get(props));
        break;
        
      case 'search_documentation':
        const DocumentationController = require('../controllers/documentation');
        RESP.setBody(await DocumentationController.search(props));
        break;
        
      case 'validate_naming':
        const ValidationController = require('../controllers/validation');
        RESP.setBody(await ValidationController.validate(props));
        break;
        
      case 'check_template_updates':
        const UpdatesController = require('../controllers/updates');
        RESP.setBody(await UpdatesController.check(props));
        break;
        
      default:
        // Unknown tool - return 404
        DebugAndLog.warn('Unknown tool requested', { tool });
        return RESP.reset({ 
          statusCode: 404, 
          body: { 
            error: 'Unknown tool',
            tool,
            availableTools: [
              'list_templates',
              'get_template',
              'list_template_versions',
              'list_categories',
              'list_starters',
              'get_starter_info',
              'search_documentation',
              'validate_naming',
              'check_template_updates'
            ]
          } 
        });
    }
    
    // Check for unsupported HTTP methods
    // MCP protocol typically uses POST, but we support GET for some operations
    const supportedMethods = ['GET', 'POST'];
    if (!supportedMethods.includes(props.httpMethod)) {
      DebugAndLog.warn('Unsupported HTTP method', { method: props.httpMethod });
      return RESP.reset({ 
        statusCode: 405, 
        body: { 
          error: 'Method not allowed',
          method: props.httpMethod,
          allowedMethods: supportedMethods
        } 
      });
    }
    
    return RESP;
    
  } catch (error) {
    // Log error with full context
    DebugAndLog.error('Error processing request', { 
      error: error.message,
      stack: error.stack,
      tool,
      requestId: context.requestId
    });
    
    // Return sanitized error to client
    return RESP.reset({ 
      statusCode: 500, 
      body: { 
        error: 'Internal server error',
        requestId: context.requestId
      } 
    });
  }
};

module.exports = { process };
