
exports.init = init;
exports.notifyEv = handleEv;

const Https = require('node:https');

var Paddle = null;

function isGreetMessageOn (service) {
	return service?.config.discord.greetMessage ??
		Paddle.config.discord.greetMessage;
}

function isReuseStatsMessageOn (service) {
	return service?.config.discord.reuseStatsMessage ??
		Paddle.config.discord.reuseStatsMessage;
}

function log (...args) {
	console.log('[Discord]', ...args);
}

function init (instance) {
	
	let load = false;

	if (typeof instance.config.discord.url !== 'undefined')
		load = true;
	for (let service of instance.config.services) {
		if (typeof service.discord !== 'undefined')
			load = true;
	}

	if (load)
		Paddle = instance;

	log(`Init (load: ${load})`);
	return load;
}

function handleEv (name, payload) {

	if (name === 'start') {
		if (isGreetMessageOn(payload))
			postGreet(payload);
	} else if (name === 'stats') {
		if (!Paddle.config.discord.combineStatsMessage)
			postStats();
		if (payload)
			postStats(payload);
	}
}

function postGreet (service) {

	const requestObj = {
		content: 'Keep paddling :sailboat:'
	};

	const url = new URL(service.config.discord.url);

	postWebhook(url, requestObj);
}

function postStats (service) {
	const state = service ?
		service.discord || {} :
		Paddle.run.discord || {};
	if (service) service.discord = state;
	else Paddle.run.discord = state;

	let invokeWebhook = postWebhook;

	const url = new URL(service?.config.discord.url ??
		Paddle.config.discord.url);

	if (isReuseStatsMessageOn(service) &&
	    state.statsMessageId) {
		invokeWebhook = patchWebhook;
		url.pathname += `/messages/${state.statsMessageId}`;
	}

	if (!url.searchParams.has('wait'))
		url.searchParams.append('wait', true);

	const requestObj = {
		content: generateMessage(service),
		embeds: generateEmbeds(service)
	}

	invokeWebhook(url, requestObj, (responseObj) => {

		if (isReuseStatsMessageOn(service) &&
			typeof state.statsMessageId === 'undefined' &&
			responseObj) {
			state.statsMessageId = responseObj.id;
			log(`Reusing message ${state.statsMessageId} ` +
				`(${service ? service.config.name : Paddle.run.hostname})`);
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

	const request = Https.request(url.href, options, (response) => {

		if (response.statusCode != 200 &&
		    response.statusCode != 204)
			log(`Bad status ${response.statusCode}`);

		response.setEncoding('utf8');
		let responseJson  = '';
		
		response.on('data', (chunk) => {
			responseJson += chunk;
		});
		
		response.on('end', () => {
			if (response.statusCode !== 200 &&
			    responseJson.length > 0)
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

	const requestJson = JSON.stringify(requestObj);
	//log('Request', requestJson);

	request.write(requestJson);
	request.end();
}

function generateMessage (service) {
	let message = `:sailboat:\n` +
		`**Updated**: ${new Date()}`
	return message;
}

function generateEmbeds (service) {
	const embeds = [];

	if (Paddle.config.discord.combineStatsMessage || !service) {
		const fields = [];
		fields.push({
			name: 'Hostname',
			value: Paddle.run.hostname,
			inline: false
		});
		for (let stat of Paddle.run.stats) {
			fields.push({
				name: stat.description,
				value: stat.value,
				inline: true
			});
		}
		if (fields.length > 0)
			embeds.push({ fields: fields });
	}

	if (service) {
		const fields = [];
		fields.push({
			name: 'Service',
			value: service.config.name,
			inline: false
		});
		for (let stat of service.stats) {
			fields.push({
				name: stat.description,
				value: stat.value,
				inline: true
			});
		}
		if (fields.length > 0)
			embeds.push({ fields: fields });
	}

	return embeds;

}
