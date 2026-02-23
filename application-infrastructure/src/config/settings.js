// const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

const settings =  {
	"errorExpirationInSeconds": 300,
	"routeExpirationInSeconds": 3600,
	"externalRequestHeadroomInMs": 8000,
	"githubUsers": process.env.ATLANTIS_GITHUB_USER_ORGS.split(','),
}

module.exports = settings;