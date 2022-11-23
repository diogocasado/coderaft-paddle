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

	if (typeof instance.config.db.dirPath !== 'undefined')
		load = true;

	if (load) {
		Logger = Log.createLogger(instance, 'DB');

		Paddle = instance;
		Paddle.db = {};
		Paddle.db.get = get;
		Paddle.db.put = put;

		await setupDbDir();
	}

	Logger.debug(`Init (load: ${load})`);
	return load;
}

async function setupDbDir () {

	try {
		const stats = await Fs.stat(Paddle.config.db.dirPath);
		if (!stats.isDirectory())
			throw "Error: Cannot use db at " +
				Paddle.config.db.dirPath;
	} catch (error) {
		if (error.errno !== -OS.constants.errno.ENOENT)
			throw error;
		
		await Fs.mkdir(Paddle.config.db.dirPath);
	}

	const idu = await execFile('id', ['-u', Paddle.config.run.user]);
	const idg = await execFile('id', ['-g', Paddle.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await Fs.chown(Paddle.config.db.dirPath, ueid, geid);
	await Fs.chmod(Paddle.config.db.dirPath, 0770);
}

function handleEv (name, payload) {
	if (name === 'start') {
		const service = payload;
		service.db = {};
	}
}

const pathRule =/[^0-9a-zA-Z\.]+/;

async function walk (logicPath, carvePath) {

	if (Array.isArray(logicPath))
		logicPath = logicPath.join('.');

	if (pathRule.test(logicPath))
		throw 'Invalid characters for path ' + logicPath;

	const nodes = logicPath.split(/\.+/);
	const property = nodes.pop();
	const diskPath = Path.join(
		Paddle.config.db.dirPath,
		...nodes);

	if (nodes.length > 0) try {
		const stats = await Fs.stat(diskPath);
		if (!stats.isDirectory())
			throw "Error: Cannot use db at " +
				Paddle.config.db.dirPath;
	} catch (error) {
		if (error.errno !== -OS.constants.errno.ENOENT)
			throw error;
		if (carvePath)
			await Fs.mkdir(diskPath, { recursive: true });
	}

	return Path.join(
		diskPath,
		property + '.json');
};

async function get (logicPath) {
	let value = undefined;
	const fullPath = await walk(logicPath);
	try {
		const data = await Fs.readFile(fullPath, { encoding: 'utf8' });
		value = JSON.parse(data);
	} catch (error) {
		if (error.errno !== -OS.constants.errno.ENOENT)
			throw error;
	}
	Logger.debug('Get', logicPath, value);
	return value;
}

async function put (logicPath, value) {
	Logger.debug('Put', logicPath, value);
	const fullPath = await walk(logicPath, true);
	await Fs.writeFile(fullPath, JSON.stringify(value), { encoding: 'utf8' });
}

