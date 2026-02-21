/* -----------------------------------------------------------------------
    CacheData WORKAROUNDS
	*/

const queryStringFromObject = function (parameters, options) {

	let qString = [];
	
	for (const [key,value] of Object.entries(parameters) ) {

		/* if the value is an array, then we have to join into one parameter or separate into multiple key/value pairs */
		if ( Array.isArray(value) ) {
			let values = [];

			/* apply encodeURIComponent() to each element in value array */
			for (const v of value) {
				values.push(encodeURIComponent(v));
			}
			
			if ( "separateDuplicateParameters" in options && options.separateDuplicateParameters === true) {
				let a = "";
				if ( "separateDuplicateParametersAppendToKey" in options ) {
					if ( options.separateDuplicateParametersAppendToKey === '1++' || options.separateDuplicateParametersAppendToKey === '0++') {
						a = (options.separateDuplicateParametersAppendToKey === "1++") ? 1 : 0;
					} else {
						a = options.separateDuplicateParametersAppendToKey;
					}
				}
				
				for (const v of values) {
					qString.push(`${key}${a}=${v}`); // we encoded above
					if(Number.isInteger(a)) { a++; }
				}
			} else {
				const delim = ("combinedDuplicateParameterDelimiter" in options && options.combinedDuplicateParameterDelimiter !== null && options.combinedDuplicateParameterDelimiter !== "") ? options.combinedDuplicateParameterDelimiter : ",";
				qString.push(`${key}=${values.join(delim)}`); // we encoded above
			}

		} else {
			qString.push(`${key}=${encodeURIComponent(value)}`);
		}
	}

	return (qString.length > 0) ? '?'+qString.join("&") : "";
}

const generateURIfromConnection = function(conn) {
	/* if we have parameters, create a query string and append to uri */
	const options = {
		separateDuplicateParameters: true,
		separateDuplicateParametersAppendToKey: "", // "" "[]", or "0++", "1++"
		combinedDuplicateParameterDelimiter: ','
	}

	const timeOutInMilliseconds = 8000;

	let req = {
		method: "GET",
		uri: "",
		protocol: "https",
		host: "",
		path: "",
		parameters: {},
		headers: {},
		body: null,
		note: "",
		options: { timeout: timeOutInMilliseconds}
	};

	/* if we have a method or protocol passed to us, set them */
	if ( "method" in conn && conn.method !== "" && conn.method !== null) { req.method = conn.method.toUpperCase(); }
	if ( "protocol" in conn && conn.protocol !== "" && conn.protocol !== null) { req.protocol = conn.protocol.toLowerCase(); }

	if ("body" in conn) { req.body = conn.body; }
	if ("headers" in conn && conn.headers !== null) { req.headers = conn.headers; }
	if ("note" in conn) { req.note = conn.note; } else { req.note = "(eventservice)"; }
	if ("options" in conn && conn.options !== null) { req.options = conn.options; }

	/* if there is no timeout set, or if it is less than 1, then set to default */
	if ( !("timeout" in req.options && req.options.timeout > 0) ) {
		req.options.timeout = timeOutInMilliseconds;
	}

	/* if we have a uri, set it, otherwise form one using host and path */
	if ( "uri" in conn && conn.uri !== null && conn.uri !== "" ) {
		req.uri = conn.uri;
	} else if ("host" in conn && conn.host !== "" && conn.host !== null) {
		let path = ("path" in conn && conn.path !== null && conn.path !== null) ? conn.path : "";
		req.uri = `${req.protocol}://${conn.host}${path}`; // we use req.protocol because it is already set
	}
	
	/* if we have parameters, create a query string and append to uri */
	if (
		"parameters" in conn 
		&&  conn.parameters !== null 
		&& (typeof conn.parameters === 'object' && Object.keys(conn.parameters).length !== 0)
	){

		req.uri += queryStringFromObject(conn.parameters, options);
	}

	return req;
}

module.exports = {
	queryStringFromObject,
	generateURIfromConnection
};