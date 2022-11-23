
const OS = require('node:os');
const Fs = require('node:fs').promises;
const Path = require('node:path');
const Log = require('./log');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

var Paddle = null;
var Logger = null;

Promise.resolve()
	.then(init)
	.catch(processError);

async function init (instance) {

	if (!process.channel)
		throw 'This module should run as a forked process.'

	process.on('message', handleMessage);

	process.send({ type: 'ready' });
}

async function handleMessage (message) {
	if (message.type === 'exec') {
		const result = { id: message.id };
		try {
			const options = { cwd: message.cwd };
			const cmd = await execFile(
				message.cmd, message.args || [], options);
			result.stdout = cmd.stdout;
			result.stderr = cmd.stderr;
		} catch (error) {
			result.code = error.code;
			result.stderr = error.stderr;
		}
		process.send(result);
		return true;
	}
	return false;
}

function processError (error) {
	console.log(error);
	process.exit(1);
}
