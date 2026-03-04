/*
* Application Responses file
*
* This file contains custom response settings
* These settings are loaded either directly into Response.init(responses) or AppConfig.init({responses})
* 
* Settings can be loaded from environment variables, other files, or hardcoded values
* 
* For more information on how to use this file, see the README.md file
* 
* Example:
* {
*   settings: {
*		"errorExpirationInSeconds": 300,
*		"routeExpirationInSeconds": 3600,
*		"externalRequestHeadroomInMs": 8000,
*.  },
*   jsonResponses: {},
*   htmlResponses: {},
*   xmlResponses: {},
*   rssResponses: {},
*   textResponses: {},
* }
*/

const responses =  {
	"settings": {
		"errorExpirationInSeconds": 300,
		"routeExpirationInSeconds": 3600,
		"externalRequestHeadroomInMs": 8000,
		// "someNumSetting": process.env.SOME_SETTING ?? "all" // load environment variables - you should also implement validation
	},
	"jsonResponses": {},
	"htmlResponses": {},
	"xmlResponses": {},
	"rssResponses": {},
	"textResponses": {},
}

module.exports = responses;