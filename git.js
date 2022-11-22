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
	const out = [
		`Pulling repository ${service.config.git.repo} @${Paddle.run.hostname}\n`
	];

	const pullExec = await Paddle.root.exec(
		'git', ['-C', service.config.path, 'pull'],
		{ cwd: service.config.path });

	const pullOut = pullExec.stderr.length > 0 ?
		pullExec.stderr : pullExec.stdout;

	out.push(pullOut.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 1)
		.join('\n'));

	await Logger.info(...out);
}

async function execRestart (service) {
	const out = [
		`Restarting service ${service.config.name} @${Paddle.run.hostname}\n`
	];

	const restartExec = await Paddle.root.exec(
		'systemctl', ['restart', service.config.name]);

	const statusExec = await Paddle.root.exec(
		'systemctl', ['status', service.config.name,'-n3']);

	const statusLines = statusExec.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 1);

	out.push([
		statusLines[2].split(' since ')[0],
		...statusLines.slice(9)
			.map(line => line.slice(line.indexOf(': ') + 1))
		].join('\n'));

	await Logger.info(...out);
}

