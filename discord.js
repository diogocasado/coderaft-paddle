exports.init = init;
exports.notifyEv = handleEv;

const Https = require('node:https');
const Log = require('./log');

var Paddle = null;
var Logger = null;

function isGreetMessageOn (service) {
	return service?.config.discord.greetMessage ??
		Paddle.config.discord.greetMessage;
}

function isReuseStatsMessageOn (service) {
	return service?.config.discord.reuseStatsMessage ??
		Paddle.config.discord.reuseStatsMessage;
}

async function init (instance) {
	let load = false;

	if (typeof instance.config.discord.url !== 'undefined')
		load = true;

	for (let config of instance.config.services) {
		if (typeof config.discord !== 'undefined') {
			load = true;
		}
	}

	if (load) {
		Logger = Log.createLogger(instance, 'Discord');

		Paddle = instance;
		Paddle.discord = {};

		Paddle.discord.statsMessageId =
			await Paddle.db?.get('discord.statsMessageId');

		Logger.listen(handleLog);
	}

	Logger.debug(`Init (load: ${load})`);
	return load;
}

function handleEv (name, payload) {
	if (name === 'start') {
		const service = payload;
		service.discord = {};
		service.discord.statsMessageId = Paddle.db?.get(
			['discord',
			service.config.name,
			'statsMessageId']);
		if (isGreetMessageOn(service))
			postGreet(service);
	} else if (name === 'stats') {
		const service = payload;
		if (Paddle.config.discord.combineStatsMessage)
			postStats();
		else if (service)
			postStats(service);
	}
}

function postGreet (service) {
	const url = new URL(service.config.discord.url);
	const requestObj = {
		content: 'Keep paddling :sailboat:'
	};

	postWebhook(url, requestObj);
}

function postStats (service) {
	const state = service ?
		service.discord :
		Paddle.discord;

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

		if (responseObj &&
		    isReuseStatsMessageOn(service)) {
		    
			if (typeof state.statsMessageId === 'undefined') {
				state.statsMessageId = responseObj.id;

				Paddle.db?.put(
					['discord',
					state.config?.name,
					'statsMessageId'],
					state.statsMessageId);
			}

			if (responseObj.code === 10008)
				state.statsMessageId = undefined;
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
			Logger.warn(`Bad status ${response.statusCode}`);

		response.setEncoding('utf8');
		let responseJson = '';
		
		response.on('data', (chunk) => {
			responseJson += chunk;
		});
		
		response.on('end', () => {
			if (responseJson.length > 0 &&
			    response.statusCode !== 200)
				Logger.warn(`Response (${responseJson.length}) ${responseJson}`);
			const responseObj = responseJson.length > 0 ?
				JSON.parse(responseJson) :
				undefined;
			if (typeof callback === 'function')
				callback(responseObj);
		});
	});

	request.on('error', (error) => {
		Logger.error('Request error', error.message);
	});

	const requestJson = JSON.stringify(requestObj);
	Logger.data('Request', method, url.href, requestJson);

	request.write(requestJson);
	request.end();
}

function generateMessage (service) {
	const now = new Date().toLocaleString('en-us', { timeZoneName: 'short' });
	let message = `:sailboat:\n` +
		`**Updated**: ${now}`
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
		embeds.push({ fields: generateServiceFields(service) });
	} else {
		for (let service of Paddle.run.services) 
			embeds.push({ fields: generateServiceFields(service) });
	}

	return embeds;
}

function generateServiceFields(service) {
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
	return fields;
}

function handleLog (source, type, args) {
	for (let service of Paddle.run.services) {
		if (typeof service.config.discord !== 'undefined')
			submitLog(service.config.discord, type, args);
	}
}

const LogFormatters = {
	[Log.GIT_PUSH]: formatGitPush,
	[Log.ISSUE]: formatIssue
};

function submitLog (config, type, args) {

	if (Array.isArray(config.log) &&
	    config.log.includes(type)) {

		let formatter = null;

		if (Log.PRIMITIVES.includes(type))
			formatter = formatGeneric;
		else
			formatter = LogFormatters[type];

		if (typeof formatter !== 'function') {
			Log.warn('Formatter not implemented', type);
			return;
		}

		postWebhook(new URL(config.url),
			formatter(config, args));
	}
}

function formatGeneric (config, args) {
	return {
		content: args.join('\n')
	};
}

function formatGitPush (config, args) {
	let push = args[0];

	const requestObj = {
		content: Log.formatGitPushObj(push),
		embeds: []
	};

	for (let i=1; i<args.length; i++) {
		let commit = args[i];

		if (typeof commit === 'string') {
			requestObj.embeds.push({
				title: Log.formatGitCommitObj(commit)
			});
		}

		if (typeof commit === 'object') {
			requestObj.embeds.push({
				title: Log.formatGitCommitObj(commit),
				url: commit.url
			});
		}
	}

	return requestObj;
}

function formatIssue (config, args) {
	const issue = args[0];

	const requestObj = {
		embeds: [{
			title: Log.formatIssueObj(issue),
			url: issue.url
		}]
	};

	return requestObj;
}

