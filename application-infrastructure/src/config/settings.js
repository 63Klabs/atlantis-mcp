// const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

const ATLANTIS_GITHUB_USER_ORGS = 
	process.env?.ATLANTIS_GITHUB_USER_ORGS ? process.env.ATLANTIS_GITHUB_USER_ORGS.split(',') : ['63klabs'];

const settings =  {
	"errorExpirationInSeconds": 300,
	"routeExpirationInSeconds": 3600,
	"externalRequestHeadroomInMs": 8000,
	"githubUsers": ATLANTIS_GITHUB_USER_ORGS,
}

module.exports = settings;