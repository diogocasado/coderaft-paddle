exports.build = build;

const Stats = require('./stats');

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;

const Defaults = {
	run: {
		user: 'www-data',
		group:  'www-data',
		webhooks: [
			'discord'
		],
		sockPath: '/run/paddle.sock',
		collectStatsInterval: 5 * SEC,
	},
	http: {
		path: '/run/paddle_http.sock'
	},
	discord: {
		greetMessage: true,
		reuseStatsMessage: true,
		combineStatsMessage: true,
		// url: 'copied from integrations ins discord'
	},
	services: [
		/* Provide a local.js file that adds a service. E.g.:
		exports.config = (config) => {
			config.services.push({
				name: 'dummy',
				gitPath: '/root/dummy',
				location: '/',
				proxyPass: 'http://unix:/run/dummy.sock',
				publishStatsInterval: 60000,
				discord: {
					url: 'copied from integrations in discord'
				}
			});
		}
		* Coderaft does this automagically.
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

	if (typeof baked.http.host === 'string' && 
	    typeof baked.http.port === 'number')
		baked.flags.is_inetHttp = true;
	else if (typeof baked.http.path === 'string')
		baked.flags.is_sockHttp = true;
	else
		throw 'Check Config.http.[host,port || path] for bind address';

	return baked;
};
