exports.init = init;
exports.notifyEv = handleEv;

const Log = require('./log');
const Crypto = require('node:crypto');

let Paddle = null;
let Logger = null;

function init (instance) {
	let load = false;

	if (typeof instance.config.github.path !== 'undefined')
		load = true;

	for (let service of instance.config.services) {
		if (typeof service.github !== 'undefined') {
			load = true;
			break;
		}
	}

	if (load)
		initGlobals(instance);

	Logger.debug(`Init (load: ${load})`);
	return load;
}

function initGlobals (instance) {
	Paddle = instance;
	Logger = Log.createLogger(instance, 'GitHub');
}

function handleEv (name, payload) {
	if (name === 'start') {
		const service = payload;
		setupRoutes(service);
		service.github = {};
	}
}

function setupRoutes (service) {
	const urlPath = Paddle.config.github.urlPath +
		service.config.github.urlPath;
	Logger.debug('Add route', urlPath);
	Paddle.routes.push({
		urlPath: urlPath,
		handler: handleRequest.bind(null, service)
	});
}

const EventHandler = {
	ping: handlePing,
	push: handlePush
}

function handleRequest (service, request, response) {

	if (request.method !== 'POST') {
		Logger.warn('Method not allowed', request.method);
		response.writeHead(405).end();
		return;
	}

	const contentType = request.headers['content-type'];
	if (contentType !== 'application/json') {
		Logger.warn('Unsupported content type', contentType);
		response.writeHead(500).end();
	}

	const secret = service.config.github.secret;
	let signHmac = null;
	let signRequest = null;

	if (typeof secret === 'string' && secret.length > 0) {
		const signHeader = request.headers['x-hub-signature-256'];
		if (typeof signHeader !== 'string') {
			Logger.warn('Missing signature',
				request.socket.remoteAddress,
				request.url);
			response.writeHead(400).end();
		}
		
		const [algo, sign] = signHeader.split('=');
		if (algo !== 'sha256') {
			Logger.warn('Unsupported signature algo', algo);
			response.writeHead(400).end();
			return;
		}
		signHmac = Crypto.createHmac('sha256', secret);
		signRequest = sign;
	}

	const eventType = request.headers['x-github-event'];
	Logger.debug('Event', eventType);

	let data = '';
	request.on('data', (chunk) => data += chunk);
	request.on('end', () => {
		Logger.data('Payload', data)

		if (signHmac !== null) {
			signHmac.update(data);
			const sign = signHmac.digest('hex');
			if (sign !== signRequest) {
				Logger.warn('Bad signature',
					request.url,
					signRequest,
					sign);
				response.writeHead(400).end();
				return;
			}
		}

		const handle = EventHandler[eventType]
		if (handle) try {
			handle(JSON.parse(data), response);
			if (response.headersSent)
				return;
		} catch (error) {
			Logger.error(error);
		}
		response.writeHead(500).end();
	});
}

function handlePing (payload, response) {
	response.writeHead(200).end('pong');
}

function handlePush (payload, response) {
	const push = createPushLogObj(payload);
	const commits = [];
	for (let commit of payload.commits)
		commits.push(createCommitLogObj(commit));

	Logger.propagate(Log.GIT_PUSH, push, ...commits);
}

function createPushLogObj (push) {
	return {
		host: 'GitHub',
		username: push.pusher.name,
		repo: push.repository.name,
		url: push.repository.html_url,
		ref: push.ref
	};
}

function createCommitLogObj (commit) {
	return {
		message: commit.message,
		username: commit.author.username,
		timestamp: commit.timestamp,
		id: commit.id,
		url: commit.url
	};
}