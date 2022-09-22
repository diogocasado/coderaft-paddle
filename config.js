exports.build = build;

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
		sockPath: '/run/paddle.sock'
	},
	http: {
		path: '/run/paddle_http.sock'
	},
	services: [
		{
			name: 'dummy',
			gitPath: '/root/dummy',
			location: '/',
			proxyPass: 'http://unix:/run/dummy.sock',
			publishStatsInterval: 30 * SEC,
			discord: {
				greetMessage: true,
				reuseStatsMessage: true,
				url: 'https://discord.com/api/webhooks/1022611971750764594/4AW7D23fNzSbJ79ZopJmX_BXrk3EqM8Xp6lPFPbBa-CStGxqEctB3t6itFd8mVr1R5A9'
			}
		}
	]
}

function build () {
	let baked = Object.assign({
		flags: {}
	}, Defaults);
	
	if (typeof baked.http.host === 'string' && 
	    typeof baked.http.port === 'number')
		baked.flags.is_inetHttp = true;
	else if (typeof baked.http.path === 'string')
		baked.flags.is_sockHttp = true;
	else
		throw 'Check Config.http.[host,port || path] for bind address';

	return baked;
};
