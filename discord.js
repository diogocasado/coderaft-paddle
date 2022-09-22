
exports.init = init;
exports.notifyEv = handleEv;

const Https = require('node:https');

function log (...args) {
	console.log('[Discord.gg]', ...args);
}

function init (paddle) {
	
	let load = false;
	for (let service of paddle.config.services) {
		if (typeof service.discord !== 'undefined')
			load = true;
	}

	log(`Init (load: ${load})`);
	return load;
}

function handleEv (name, payload) {
	log(`Event ${name}`);

	if (name === 'start')
		postGreet(payload);
	else if (name === 'stats')
		postStats(payload);
}

function postGreet (serviceRun) {

	const requestObj = {
		content: 'Keep paddling :sailboat:'
	};

	const url = new URL(serviceRun.config.discord.url);

	postWebhook(url, requestObj);
}

function postStats (serviceRun) {
	
	let invokeWebhook = postWebhook;

	const url = new URL(serviceRun.config.discord.url);

	if (serviceRun.config.discord.reuseStatsMessage &&
	    serviceRun.discordStatsMessageId) {
		invokeWebhook = patchWebhook;
		url.pathname += `/messages/${serviceRun.discordStatsMessageId}`;
	}

	if (!url.searchParams.has('wait'))
		url.searchParams.append('wait', true);

	const requestObj = {
		content: generateMessage(serviceRun),
		embeds: generateEmbeds(serviceRun)
	}

	invokeWebhook(url, requestObj, (responseObj) => {

		if (serviceRun.config.discord.reuseStatsMessage &&
		    typeof serviceRun.discordStatsMessageId === 'undefined') {
			serviceRun.discordStatsMessageId = responseObj.id;
			log(`Reusing message ${responseObj.id}`);
		}
	});
}

function postWebhook (url, requestObj, callback) {
	requestWebhook('POST', url, requestObj, callback);
}

function patchWebhook (url, requestObj, callback) {
	requestWebhook('PATCH', url, requestObj, callback);
}

function requestWebhook (method, url, requestObj, callback) {

	const options = {
		method: method,
		headers: {
			'Content-Type': 'application/json'
		}
	};

	log('POST', url.href, requestObj);
	const request = Https.request(url.href, options, (response) => {
		log(`Status ${response.statusCode}`);
		if (response.statusCode != 200 &&
		    response.statusCode != 204)
			log(`Bad status ${response.statusCode}`);

		response.setEncoding('utf8');
		let responseJson  = '';
		
		response.on('data', (chunk) => {
			responseJson += chunk;
		});
		
		response.on('end', () => {
			console.log(`Response (${responseJson.length}) ${responseJson}`);
			const responseObj = response.statusCode == 200 ?
				JSON.parse(responseJson) :
				undefined;
			if (typeof callback === 'function')
				callback(responseObj);
		});
	});

	request.on('error', (error) => {
		log('Request error', error.message);
	});

	request.write(JSON.stringify(requestObj));
	request.end();
}

function generateMessage (serviceRun) {
	let message = `:sailboat:\n**Service**: ${serviceRun.config.name}`;
	return message;

	for (let stat of serviceRun.stats) {
		if (message.length > 0)
			message += '\n';
		message += stat.description + ': ' + stat.value;
	}

	return message;
}

function generateEmbeds (serviceRun) {
	const embeds = [];

	const fields = [];
	for (let stat of serviceRun.stats) {
		fields.push({
			name: stat.description,
			value: stat.value,
			inline: true
		});
	}
	if (fields.length > 0)
		embeds.push({ fields: fields });

	return embeds;

}
