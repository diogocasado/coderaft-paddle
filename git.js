exports.init = init;
exports.notifyEv = handleEv;

const OS = require('node:os');
const Fs = require('node:fs').promises;
const Path = require('node:path');
const Log = require('./log');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

var Paddle = null;
var Logger = null;

async function init (instance) {
	let load = false;

	for (let config of instance.config.services) {
		if (typeof config.git !== 'undefined') {
			load = true;
		}
	}

	if (load) {
		Logger = Log.createLogger(instance, 'Git');
		Logger.listen(handleLog);

		Paddle = instance;
		Paddle.git = {};
	}

	Logger.debug(`Init (load: ${load})`);
	return load;
}

function handleEv (name, payload) {
	if (name === 'start') {
		const service = payload;
		if (service.config.git) {
			service.git = {};
		}
	}
}

function handleLog (source, type, args) {
	for (let service of Paddle.run.services) {
		if (typeof service.config.git !== 'undefined' &&
		    type === Log.GIT_PUSH)
			handlePush(service, args);
	}
}

async function handlePush (service, args) {
	const push = args[0];

	if (push.repo === service.config.git.repo &&
	    push.ref === service.config.git.ref) {
		service.config.git.pull && await execPull(service);
		service.config.git.restart && await execRestart(service);
	}
}

async function execPull (service) {
	Logger.info(`Pulling repository ${service.config.git.repo} @${Paddle.run.hostname}`);
	const pull = await Paddle.root.exec(
		'git', ['-C', service.config.path, 'pull'],
		{ cwd: service.config.path });

	const pullOut = pull.stderr.length > 0 ?
		pull.stderr : pull.stdout;
	Logger.info(...pullOut.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 1))
}

async function execRestart (service) {
	Logger.info(`Restarting service ${service.config.name} @${Paddle.run.hostname}`);
	const restart = await Paddle.root.exec(
		'systemctl', ['restart', service.config.name]);

	const status = await Paddle.root.exec(
		'systemctl', ['status', service.config.name,'-n3']);
	const statusLines = status.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 1);
	Logger.info(
		statusLines[0],
		statusLines[2],
		...statusLines.slice(9));
}

