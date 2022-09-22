const OS = require('node:os');
const Fs = require('node:fs').promises;
const Net = require('node:net');
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const Paddle = {
	config: Config.build(),
	webhooks: [],
	routes: [],
	run: {
		services: []
	}
};

async function setupWebhooks () {
	
	for (let webhook of Paddle.config.run.webhooks) {
		const module = require('./' + webhook);
		if (module.init(Paddle))
			Paddle.webhooks.push(module);
	}

	if (Paddle.webhooks.length > 0) {
		for (let index = 0; index < Paddle.config.services.length; index++) {
			const config = Paddle.config.services[index];
			const run = Paddle.run.services[index] = {
				config: config,
				stats: []
			};

			notifyEv('start', run);

			if (typeof config.publishStatsInterval !== 'undefined')
				run.publishInterval = setInterval(
					notifyEv,
					config.publishStatsInterval,
					'stats',
					run);
		}
	}
}

async function setupUnixSockets () {

	try {
		let stats = await Fs.stat(Paddle.config.run.sockPath);
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
			stats = await Fs.stat(Paddle.config.http.path);
			if (!stats.isSocket())
				throw "Error: Cannot use http socket at " +
					Paddle.config.http.path;
			await Fs.unlink(Paddle.config.http.path);
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
		await Fs.chown(Paddle.config.http.path, ueid, geid);
		await Fs.chmod(Paddle.config.http.path, 0770);
	}
}

async function setguidProcess () {

	process.setegid(Paddle.config.run.group);
	process.seteuid(Paddle.config.run.user);

	console.log('Running as ' +
			`${Paddle.config.run.user},${process.geteuid()}:` +
			`${Paddle.config.run.group},${process.getegid()}`);
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

	console.log('Connection: ' + client.remoteAddress);

	let message = '';
	client.on('data', (chunk) => {
		message += chunk;
		if (message.length > 10240) {
			console.log("Warning message > 10KiB");
			client.end();
		}
	});

	client.on('end', () => {
		console.log('Received: ' + message);
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
		console.log('Handled request', service);
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

function updateStats (src, dst) {
	for (let stat of src)
		updateStat(stat, dst);
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

function startHttpServer () {
	Paddle.httpServer = Http.createServer(handleHttpRequest);
	Paddle.httpServer.on('error', handleError);
	Paddle.httpServer.on('listening', handleHttpListen);
	Paddle.httpServer.listen(Paddle.config.http);
}

function handleHttpListen () {
	let bindStr = 'http://';
	if (Paddle.config.flags.is_inetHttp)
		bindStr +=
			Paddle.config.http.host + ':' +
			Paddle.config.http.port;
	else if (Paddle.config.flags.is_sockHttp)
		bindStr +=
			'unix:' + Paddle.config.http.path;
	console.log('Listening on ' + bindStr);
}

function handleHttpRequest  (request, response) {
	console.log('Request: ', request);
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('Hello back');
}

function notifyEv (name, serviceRun) {
	console.log(`Event ${name} ${serviceRun.config.name}`);

	for (let webhook of Paddle.webhooks) {
		if (typeof webhook.notifyEv === 'function')
			webhook.notifyEv(name, serviceRun);
	}

}

function handleError (error) {
	console.log(error);
	process.exit(1);
}

Promise.resolve({})
	.then(setupWebhooks)
	.then(setupUnixSockets)
	.then(startPaddleServer)
	.then(startHttpServer)
	.then(chownUnixSockets)
	.then(setguidProcess);

