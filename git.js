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

async function handleEv (name, payload) {
	if (name === 'start') {
		const service = payload;
		if (service.config.git)
			await configService(service);
	}
}

async function configService (service) {
	const git = {};
	try {
		git.repo = await getRepoName(service.config.path);
		git.branch = await getCurrBranch(service.config.path);
		Logger.info(`Detected repo ${git.repo}/${git.branch}`);
		const effRepo = service.config.git.repo ?? git.repo;
		if (effRepo !== git.repo)
			Logger.warn('Overriding repo name ${service.config.repo}');
		service.git = git;
	} catch (error) {
		Logger.error(`Could not determine branch info`, error);
	}
}

function handleLog (source, type, args) {
	for (let service of Paddle.run.services) {
		if (typeof service.git !== 'undefined' &&
		    type === Log.GIT_PUSH)
			handlePush(service, args);
	}
}

async function handlePush (service, args) {
	const push = args[0];

	const ref = 'refs/heads/' + service.git.branch;
	if (push.repo === (service.config.git.repo ?? service.git.repo) &&
	    push.ref === ref) {
		if (service.config.git.pull) {
			await execPull(service);
			if (service.config.git.restart)
				await execRestart(service);
		}
	}
}

async function getRepoName (path) {
	const exec = Paddle.ready ?
		Padddle.root.exec : execFile;

	const gitExec = await exec(
		'git', ['-C', path, 'config', '--get', 'remote.origin.url']);

	if (gitExec.stderr.length > 0)
		throw gitExec.stderr;

	return gitExec.stdout
		.split('/')
		.slice(-1)[0]
		.split('.git')[0].trim();
}


async function getCurrBranch (path) {
	const exec = Paddle.ready ?
		Padddle.root.exec : execFile;

	const gitExec = await exec(
		'git', ['-C', path, 'branch', '--show-current']);

	if (gitExec.stderr.length > 0)
		throw gitExec.stderr;

	return gitExec.stdout.trim();
}

async function execPull (service) {
	const out = [
		`Pulling repository ${service.config.git.repo} @${Paddle.run.hostname}\n`
	];

	const pullExec = await Paddle.root.exec(
		'git', ['-C', service.config.path, 'pull']);

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

