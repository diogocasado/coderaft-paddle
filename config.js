exports.build = build;

const Log = require('./log');
const Stats = require('./stats');

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;

const Defaults = {
	log: {
		data: false,
		debug: false,
		info: true,
		warn: true,
		error: true
	},
	run: {
		user: 'www-data',
		group:  'www-data',
		modules: [
			'db',
			'discord',
			'github',
			'git'
		],
		sockPath: '/run/paddle.sock',
		statsInterval: 5 * SEC,
	},
	http: {
		// host: '127.0.0.1',
		// port: 80,
		sockPath: '/run/paddle_http.sock',
		urlPath: '/paddle'
	},
	db: {
		dirPath: '.db'
	},
	discord: {
		greetMessage: false,
		reuseStatsMessage: true,
		combineStatsMessage: true
		// url: 'copied from integrations in discord'
	},
	github: {
		urlPath: '/github'
	},
	services: [
		/* Provide a local.js file that adds a service.
		 * E.g.:
		exports.config = (config) => {
			config.services.push({
				name: 'dummy',
				path: '/root/dummy',
				proxyPass: 'http://unix:/run/dummy.sock',
				publishStatsInterval: 60000,
				discord: {
					url: 'copied from integrations in discord',
					// Forward log messages using this filter:
					log: [ Log.TIP, Log.GIT_PUSH, Log.ISSUE ],
					use_threads: false
				},
				github: {
					urlPath: '/dummy',
					secret: 'same secret from webhook settings',
				},
				git: {
					repo: '(optional) override name',
					pull: true,
					restart: true
				}
			});
		}
		* Coderaft generates this automagically.
		*/
	],
	stats: [
		Stats.upTime,
		Stats.loadAvg,
		Stats.memInfo,
		Stats.diskInfo
	]
}

function build () {

	const Local = require('./local.js');

	let baked = Object.assign({
		flags: {}
	}, Defaults);
	
	Local.config(baked);

	if (typeof baked.http.port === 'number')
		baked.flags.is_inetHttp = true;
	else if (typeof baked.http.sockPath === 'string')
		baked.flags.is_sockHttp = true;
	else
		throw 'Check Config.http.[host,port || path] for bind address';

	return baked;
};
