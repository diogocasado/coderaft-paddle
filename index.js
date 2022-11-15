const OS = require('node:os');
const Fs = require('node:fs').promises;
const Net = require('node:net');
const Http = require('node:http');

const Config = require('./config');
const Log = require('./log');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const Paddle = {
	config: Config.build(),
	modules: [],
	routes: [],
	run: {
		hostname: null,
		services: [],
		stats: [],
		discord: undefined,
		github: undefined
	}
};

let Logger = null;

async function initLog () {
	console.log('== Paddle ==');
	Logger = Log.createLogger(Paddle);
}

async function setupHostname () {
	const hostname = await execFile('hostname');
	const lines = hostname.stdout.split(/\n\r?/);
	Paddle.run.hostname = lines[0].trim();
	console.log(`Hostname: ${Paddle.run.hostname}`);
}

async function setupWebhooks () {
	
	for (let modname of Paddle.config.run.modules) {
		Logger.debug(`Load ${modname}`);
		const module = require('./' + modname);
		if (module.init(Paddle))
			Paddle.modules.push(module);
	}

	if (Paddle.modules.length > 0) {
		for (let index = 0; index < Paddle.config.services.length; index++) {
			const config = Paddle.config.services[index];
			const run = Paddle.run.services[index] = {
				config: config,
				stats: []
			};

			notifyEv('start', run);

			if (typeof config.publishStatsInterval !== 'undefined' &&
				config.publishStatsInterval > 0)
				run.publishInterval = setInterval(
					notifyEv,
					Math.max(config.publishStatsInterval, 1000),
					'stats',
					run);
		}

		const statsInterval = Paddle.config.run.statsInterval;
		if (typeof statsInterval !== 'undefined' &&
		    statsInterval > 0) {
			Paddle.run.statsInterval = setInterval(
				updateStats,
				Math.max(statsInterval, 1000));
		}
	}
}

async function setupUnixSockets () {

	try {
		const stats = await Fs.stat(Paddle.config.run.sockPath);
		if (!stats.isSocket())
			throw "Error: Cannot use socket at " +
				Paddle.config.run.socketPath;
		await Fs.unlink(Paddle.config.run.sockPath);
	} catch (error) {
		if (error.errno !== -OS.constants.errno.ENOENT)
			throw error;
	}

	if (Paddle.config.flags.is_sockHttp) {
		try {
			const stats = await Fs.stat(Paddle.config.http.sockPath);
			if (!stats.isSocket())
				throw "Error: Cannot use http socket at " +
					Paddle.config.http.sockPath;
			await Fs.unlink(Paddle.config.http.sockPath);
		} catch (error) {
			if (error.errno !== -OS.constants.errno.ENOENT)
				throw error;
		}
	}
}

async function chownUnixSockets () {
	const idu = await execFile('id', ['-u', Paddle.config.run.user]);
	const idg = await execFile('id', ['-g', Paddle.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await Fs.chown(Paddle.config.run.sockPath, ueid, geid);
	await Fs.chmod(Paddle.config.run.sockPath, 0770);
	if (Paddle.config.flags.is_sockHttp) {
		await Fs.chown(Paddle.config.http.sockPath, ueid, geid);
		await Fs.chmod(Paddle.config.http.sockPath, 0770);
	}
}

async function setguidProcess () {
	process.setegid(Paddle.config.run.group);
	process.seteuid(Paddle.config.run.user);

	console.log('Running as ' +
			`${Paddle.config.run.user}:${process.geteuid()},` +
			`${Paddle.config.run.group}:${process.getegid()}`);
}

function startPaddleServer () {
	Paddle.PaddleServer = Net.createServer(handlePaddleConnect);
	Paddle.PaddleServer.on('error', handleError);
	Paddle.PaddleServer.on('listening', handlePaddleListen);
	Paddle.PaddleServer.listen(Paddle.config.run.sockPath);
}

function handlePaddleListen () {
	console.log('Listening on ' + Paddle.config.run.sockPath);
}

function handlePaddleConnect (client) {
	client.setEncoding('utf8');
	client.setTimeout(500);

	let message = '';
	client.on('data', (chunk) => {
		message += chunk;
		if (message.length > 10240) {
			console.log("Warning message > 10KiB");
			client.end();
		}
	});

	client.on('end', () => {
		handlePaddleRequest(JSON.parse(message), client);
	});

	client.on('timeout', () => {
		console.log('Timeout');
		client.end();
	});
}

function handlePaddleRequest (request, client) {
	const service = lookupService(request.serviceName);
	if (service) {
		updateStats(request.stats, service.stats);
	} else {
		console.log(`Warning: Request discarded (serviceName: ${request.serviceName})`);
	}
}

function lookupService (name) {
	for (let service of Paddle.run.services) {
		if (service.config.name === name)
			return service;
	}
}

function updateStat (stat, stats) {
	if (typeof stat.id !== 'string')
		return;
	let target;
	for (let index = 0; index < stats.length; index++) {
		const item = stats[index];
		if (item.id === stat.id) {
			if (typeof stat.value === 'undefined') {
				stats.splice(index, 1);
				return;
			}
			target = item;
			break;
		}
	}
	if (!target) {
		target = {};
		stats.push(target);
	}
	target.id = stat.id;
	target.description = stat.description;
	target.value = stat.value;
}

function updateStats (src, dst) {
	for (let stat of src)
		updateStat(stat, dst);
}

function startHttpServer () {
	Paddle.httpServer = Http.createServer(handleHttpRequest);
	Paddle.httpServer.on('error', handleError);
	Paddle.httpServer.on('listening', handleHttpListen);
	const options = {};
	if (Paddle.config.flags.is_inetHttp)
		Object.assign(options, {
			port: Paddle.config.http.port,
			host: Paddle.config.http.host
		});
	if (Paddle.config.flags.is_sockHttp)
		options.path = Paddle.config.http.sockPath;
	Paddle.httpServer.listen(options);
}

function handleHttpListen () {
	let bindStr = 'http://';
	if (Paddle.config.flags.is_inetHttp)
		bindStr +=
			Paddle.config.http.host + ':' +
			Paddle.config.http.port;
	else if (Paddle.config.flags.is_sockHttp)
		bindStr +=
			'unix:' + Paddle.config.http.sockPath;
	console.log('Listening on ' + bindStr);
}

function handleHttpRequest  (request, response) {
	Logger.debug('Request', request.method, request.url);

	const url = new URL(request.url, `http://${request.headers.host}`);
	const route = findHttpRoute(url);
	if (route) {
		route.handler(request, response);
	} else {
		response.writeHead(404).end();
	}
}

function findHttpRoute (url) {
	for (let route of Paddle.routes) {
		const routePath = Paddle.config.http.urlPath + route.urlPath;
		Logger.debug('Match', routePath);
		if (url.pathname.startsWith(routePath))
			return route;
	}
}

async function updateStats () {
	for (let stat of Paddle.config.stats) {
		const state = Object.assign({}, stat);
		state.value = await stat.value(stat.options);
		updateStat(state, Paddle.run.stats);
	}
}

function notifyEv (name, payload) {
	Logger.debug('Event', name);
	for (let module of Paddle.modules) {
		if (typeof module.notifyEv === 'function')
			module.notifyEv(name, payload);
	}
}

function handleError (error) {
	console.log(error);
	process.exit(1);
}

Promise.resolve({})
	.then(initLog)
	.then(setupHostname)
	.then(setupWebhooks)
	.then(setupUnixSockets)
	.then(startPaddleServer)
	.then(startHttpServer)
	.then(chownUnixSockets)
	.then(setguidProcess);

