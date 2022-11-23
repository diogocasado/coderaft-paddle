const OS = require('node:os');
const Fs = require('node:fs').promises;
const Path = require('node:path');
const Child = require('node:child_process');
const Net = require('node:net');
const Http = require('node:http');

const Config = require('./config');
const Log = require('./log');

const promisify = require('node:util').promisify;
const execFile = promisify(Child.execFile);

const Paddle = {
	config: Config.build(),
	modules: [],
	routes: [],
	run: {
		hostname: null,
		services: [],
		stats: [],
	},
	root: undefined,
	db: undefined,
	discord: undefined,
	github: undefined,
	ready: false
};

const Logger = Log.createLogger(Paddle);

const Root = {
	process: undefined,
	queue: []
};

Paddle.root = {
	async exec (cmd, args, options) {
		return new Promise ((resolve, reject) => {
			const id = Date.now() + ':' + Root.queue.length;
			Root.queue.push({
				id: id,
				resolve: resolve,
				reject: reject
			});
			const message = {
				id: id,
				type: 'exec',
				cmd: cmd,
				args: args || [],
				cwd: options?.cwd
			};
			Logger.data('=> Root', message);
			Root.process.send(message);
		});
	}
};

Promise.resolve({})
	.then(initLog)
	.then(setupHostname)
	.then(setupModules)
	.then(setupUnixSockets)
	.then(startLocalServer)
	.then(startHttpServer)
	.then(chownUnixSockets)
	.then(setguidProcess)
	.then(setReady);

async function initLog () {
	console.log('== Paddle ==');
}

async function setupHostname () {
	const hostname = await execFile('hostname');
	const lines = hostname.stdout.split(/\n\r?/);
	Paddle.run.hostname = lines[0].trim();
	Logger.info(`Hostname: ${Paddle.run.hostname}`);
}

async function setupModules () {
	
	for (let modname of Paddle.config.run.modules) {
		Logger.debug(`Load ${modname}`);
		const module = require('./' + modname);
		if (await module.init(Paddle))
			Paddle.modules.push(module);
	}

	if (Paddle.modules.length > 0) {
		for (let index = 0; index < Paddle.config.services.length; index++) {
			const config = Paddle.config.services[index];
			const run = Paddle.run.services[index] = {
				idx: index,
				config: config,
				stats: []
			};

			Logger.info(`Start service (${config.name})`);
			await notifyEv('start', run);

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

	Logger.info('Running as ' +
		`${Paddle.config.run.user}:${Paddle.config.run.group}`);
}

function setReady () {
	Paddle.ready = true;
}

function startLocalServer () {
	Logger.debug('Starting root process');
	Root.process = Child.fork(Path.resolve(__dirname, 'root'));
	Root.process.on('message', handleRootMessage);
	setTimeout(handleRootMessage, 500, { type: 'check' });
	
	Paddle.run.localServer = Net.createServer(handleLocalConnect);
	Paddle.run.localServer.on('error', handleError);
	Paddle.run.localServer.on('listening', handleLocalListen);
	Paddle.run.localServer.listen(Paddle.config.run.sockPath);
}

function handleLocalListen () {
	console.log('Listening on ' + Paddle.config.run.sockPath);
}

function handleLocalConnect (client) {
	client.setEncoding('utf8');
	client.setTimeout(500);

	let message = '';
	client.on('data', (chunk) => {
		message += chunk;
		if (message.length > 10240) {
			Logger.warn("Service message > 10KiB");
			client.end();
		}
	});

	client.on('end', () => {
		handleLocalRequest(JSON.parse(message), client);
	});

	client.on('timeout', () => {
		client.end();
	});
}

function handleLocalRequest (request, client) {
	Logger.data('Service Request', request);
	const service = lookupService(request.serviceName);
	if (service) {
		for (let stat of request.stats)
			updateStat(stat, service.stats);
	} else {
		Logger.warn(`Request discarded (serviceName: ${request.serviceName})`);
	}
}

function handleRootMessage (message) {
	Logger.data('<= Root', message);
	if (message.type === 'check' && !Root.ready) {
		console.log('FATAL: Root process did not respond');
		process.exit(1);
	}
	if (message.type === 'ready') {
		Root.ready = true;
	}
	if (typeof message.id !== 'undefined') {
		const index = Root.queue.findIndex(request =>
			request.id === message.id);
		if (index >= 0) {
			const request = Root.queue[index];
			Root.queue.splice(index, 1);

			if (typeof message.error !== 'undefined')
				request.reject(message);
			else
				request.resolve(message);
		}
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
	Logger.debug('Update stat', target.id, target.value.replaceAll('\n', ' '));
}

function startHttpServer () {
	Paddle.run.httpServer = Http.createServer(handleHttpRequest);
	Paddle.run.httpServer.on('error', handleError);
	Paddle.run.httpServer.on('listening', handleHttpListen);
	const options = {};
	if (Paddle.config.flags.is_inetHttp)
		Object.assign(options, {
			port: Paddle.config.http.port,
			host: Paddle.config.http.host
		});
	if (Paddle.config.flags.is_sockHttp)
		options.path = Paddle.config.http.sockPath;
	Paddle.run.httpServer.listen(options);
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
	Logger.info('Listening on ' + bindStr);
}

function handleHttpRequest  (request, response) {
	Logger.debug('Http Request', request.method, request.url);

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

async function notifyEv (name, payload) {
	Logger.debug('Event', name);
	for (let module of Paddle.modules) {
		if (typeof module.notifyEv === 'function')
			await module.notifyEv(name, payload);
	}
}

function handleError (error) {
	Logger.error(error);
	process.exit(1);
}


