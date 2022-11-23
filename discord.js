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
		if (service.config.discord) {
			service.discord = {};
			setupService(service);
		}
	} else if (name === 'stats') {
		const service = payload;
		if (Paddle.config.discord.combineStatsMessage)
			postStats();
		else if (service)
			postStats(service);
	}
}

async function setupService (service) {
	Logger.info(`Webhook URL: ${service.config.discord.url}`)

	service.discord.statsMessageId = await Paddle.db?.get(
		['discord',
		service.config.name,
		'statsMessageId']);

	if (isGreetMessageOn(service))
		postGreet(service);
}

async function postGreet (service) {
	const now = new Date().toLocaleString('en-us', { timeZoneName: 'short' });
	const requestObj = {
		content: `:sailboat: Paddle restarted ${now}`
	};

	await postWebhook(new URL(service.config.discord.url),  requestObj);

	return true;
}

async function postStats (service) {
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

	const responseObj = await invokeWebhook(url, requestObj);

	if (responseObj &&
	    isReuseStatsMessageOn(service)) {

		if (responseObj.code === 10008)
			state.statsMessageId = undefined;
	   	else if (typeof state.statsMessageId === 'undefined') {
			state.statsMessageId = responseObj.id;

			await Paddle.db?.put(
				['discord',
				state.config?.name,
				'statsMessageId'],
				state.statsMessageId);
		}
	}

	return true;
}

async function postWebhook (url, requestObj) {
	return asyncExecuteWebhook('POST', url, requestObj);
}

async function patchWebhook (url, requestObj, callback) {
	return asyncExecuteWebhook('PATCH', url, requestObj);
}

async function asyncExecuteWebhook (method, url, requestObj) {
	return new Promise((resolve, reject) => {
		executeWebhook(method, url, requestObj, (error, responseObj) => {
			if (error) reject(error);
			else resolve(responseObj);
		});
	});
}

function executeWebhook (method, url, requestObj, callback) {

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
				callback(null, responseObj);
		});
	});

	request.on('error', (error) => {
		Logger.error('Request error', error.message);
		callback(error);
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

async function handleLog (source, type, args) {
	const awaits = [];
	for (let service of Paddle.run.services) {
		if (typeof service.config.discord !== 'undefined' &&
		    Array.isArray(service.config.discord.log) &&
		    service.config.discord.log.includes(type))
			await consumeLog(service, type, args);
	}
	return Promise.all(awaits);
}

const LogIfaces = {
	[Log.GIT_PUSH]: gitPushIface,
	[Log.ISSUE]: issueIface,
	[Log.ISSUE_COMMENT]: issueCommentIface
};

async function consumeLog (service, type, args) {
	let iface = null;

	if (Log.PRIMITIVES.includes(type))
		iface = genericMessageIface;
	else
		iface = LogIfaces[type];

	if (typeof iface !== 'function') {
		Log.warn('Interface not implemented', type);
		return;
	}

	return iface(service.config, args);
}

async function genericMessageIface (config, args) {

	if (Paddle.ready) {
		const requestObj = {
			content: args[0],
			embeds: []
		};
		for (let index = 1; index < args.length; index++)
			requestObj.embeds.push({
				title: args[index]
			});

		await postWebhook(new URL(config.discord.url), requestObj);
	}

	return true;
}

async function gitPushIface (config, args) {
	let push = args[0];

	const requestObj = {
		content: Log.formatGitPushObj(push),
		embeds: []
	};

	for (let index = 1; index < args.length; index++) {
		let commit = args[index];

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

	await postWebhook(new URL(config.discord.url), requestObj);

	return true;
}

async function issueIface (config, args) {
	const issue = args[0];

	const requestObj = {
		embeds: [{
			title: Log.formatIssueObj(issue),
			url: issue.url
		}],
		thread_name: 'Comments'
	};

	const url = new URL(config.discord.url);

	if (!url.searchParams.has('wait'))
		url.searchParams.append('wait', true);

	const responseObj = await postWebhook(url, requestObj);

	if (responseObj.id) {
		await Paddle.db?.put([
			'discord',
			config.name,
			'issues',
			issue.id],
			{ messageId: responseObj.id });
	}

	return true;
}

async function issueCommentIface (config, args) {
	const comment = args[0];

	const requestObj = {
		embeds: [{
			title: Log.formatIssueCommentObj(comment),
			url: comment.url
		}]
	}

	const url = new URL(config.discord.url);

	if (config.discord.use_threads) {

		if (!url.searchParams.has('wait'))
			url.searchParams.append('wait', true);

		if (comment.issueId) {
			const issue = await Paddle.db?.get([
				'discord',
				config.name,
				'issues',
				comment.issueId]);
			if (issue)
				url.searchParams.append('thread_id', issue.messageId);
		}
	}

	const responseObj = await postWebhook(url, requestObj);

	return true;
}

