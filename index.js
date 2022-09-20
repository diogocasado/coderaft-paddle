const OS = require('node:os');
const Fs = require('node:fs').promises;
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const paddle = {
	config: Config.build(),
	routes: []
};

async function setupWebhooks () {

}

async function setupUnixSocket () {

	try {
		let stats = await Fs.stat(paddle.config.http.path);
		if (!stats.isSocket())
			throw "Error: Cannot use http socket at " + paddle.config.http.path;
	
	} catch (error) {

		if (error.errno === -OS.constants.errno.ENOENT)
			return;

		throw error;
	}

	await Fs.unlink(paddle.config.http.path);
}

async function chownUnixSocket () {
	const idu = await execFile('id', ['-u', paddle.config.run.user]);
	const idg = await execFile('id', ['-g', paddle.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await Fs.chown(paddle.config.http.path, ueid, geid);
}

async function startHttpServer () {
	
	if (paddle.config.flags.is_sock)
		await setupUnixSocket();

	paddle.server = Http.createServer(handleRequest);
	paddle.server.on('error', handleError);
	paddle.server.on('listening', handleListen);
	paddle.server.listen(paddle.config.http);

	if (paddle.config.flags.is_sock)
		await chownUnixSocket();
}

async function setguidProcess () {

	process.setegid(paddle.config.run.group);
	process.seteuid(paddle.config.run.user);

	console.log('Running as ' +
			`${paddle.config.run.user},${process.geteuid()}:` +
			`${paddle.config.run.group},${process.getegid()}`);
}


function handleListen () {
	let bindStr = 'http://';
	if (paddle.config.flags.is_inet)
		bindStr +=
			paddle.config.http.host + ':' +
			paddle.config.http.port;
	else if (paddle.config.flags.is_sock)
		bindStr +=
			'unix:' + paddle.config.http.path;
	console.log('Listening on: ' + bindStr);
}


function handleError (error) {
	console.log(error);
	process.exit(1);
}

function handleRequest  (request, response) {
	console.log('Request: ', request);
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('Hello back');
}

Promise.resolve({})
	.then(setupWebhooks)
	.then(startHttpServer)
	.then(setguidProcess);
