exports.createLogger = createLogger;
exports.formatGitPushObj = formatGitPushObj;
exports.formatGitCommitObj = formatGitCommitObj;
exports.formatIssueObj = formatIssueObj;
exports.formatIssueCommentObj = formatIssueCommentObj;

const Loggers = [];

const LOG_DATA = 'DATA';
const LOG_DEBUG = 'DEBUG';
const LOG_INFO = 'INFO';
const LOG_WARN = 'WARN';
const LOG_ERROR = 'ERROR';

exports.DATA = LOG_DATA;
exports.DEBUG = LOG_DEBUG;
exports.INFO = LOG_INFO;
exports.WARN = LOG_WARN;
exports.ERROR = LOG_ERROR;

exports.PRIMITIVES = [
	LOG_DATA,
	LOG_DEBUG,
	LOG_INFO,
	LOG_WARN,
	LOG_ERROR
];

const LOG_GIT_PUSH = 'GIT-PUSH';
const LOG_ISSUE = 'ISSUE';
const LOG_ISSUE_COMMENT = 'ISSUE-COMMENT';

exports.GIT_PUSH = LOG_GIT_PUSH;
exports.ISSUE = LOG_ISSUE;
exports.ISSUE_COMMENT = LOG_ISSUE_COMMENT;

function createLogger (instance, modname) {
	return new Logger(instance, modname);
}

function Logger (instance, modname) {
	this.paddle = instance;
	Loggers.push(this);
	if (modname)
		this.modname = modname;
}

Object.assign(Logger.prototype, {

	isRoot () {
		return typeof this.modname === 'undefined';
	},

	prefix (type, args) {
		const values = [];
		if (!this.isRoot())
			values.push(`[${this.modname}]`);
		if (type !== LOG_INFO)
			values.push(type);
		values.push(...args);
		return values;
	},

	async data (...args) {
		if (this.paddle.config.log.data && args.length > 0) {
			console.log(...this.prefix(LOG_DATA, args));
			await this.broadcast(LOG_DATA, ...args);
		}
		return !!this.paddle.config.log.data;
	},

	async debug (...args) {
		if (this.paddle.config.log.debug && args.length > 0) {
			console.log(...this.prefix(LOG_DEBUG, args));
			this.broadcast(LOG_DEBUG, ...args);
		}
		return !!this.paddle.config.log.debug;
	},

	async info (...args) {
		if (this.paddle.config.log.info && args.length > 0) {
			console.log(...this.prefix(LOG_INFO, args));
			await this.broadcast(LOG_INFO, ...args);
		}
		return !!this.paddle.config.log.info;
	},

	async warn (...args) {
		if (this.paddle.config.log.warn && args.length > 0) {
			console.log(...this.prefix(LOG_WARN, args));
			await this.broadcast(LOG_WARN, ...args);
		}
		return !!this.paddle.config.log.warn;
	},

	async error (...args) {
		if (this.paddle.config.log.error && args.length > 0) {
			console.log(...this.prefix(LOG_ERROR, args));
			await this.broadcast(LOG_ERROR, ...args);
		}
		return !!this.paddle.config.log.error;
	},

	listen (listener) {
		this.listener = listener;
	},

	async broadcast (type, ...args) {
		const awaits = [];
		for (let logger of Loggers) {
			if (logger !== this &&
			    typeof logger.listener === 'function')
				awaits.push(logger.listener(this, type, args));
		}
		return awaits.length > 0 ?
			Promise.all(awaits) : false;
	}
});

function formatGitPushObj (push) {
	return `${push.host} ${push.username} ` +
		`pushed to ${push.repo} (${push.ref})`;
}

function formatGitCommitObj (commit) {
	const shortHash = commit.id.substring(0, 7);
	const date = new Date(commit.timestamp).toLocaleDateString('en-us', {
		weekday:'short',
		day: 'numeric',
		month: 'short',
		year: '2-digit'
	});
	return `${commit.message} (${commit.username} on ${date}) ${shortHash}`;
}

function formatIssueObj (issue) {
	const date = new Date(issue.timestamp).toLocaleDateString('en-us', {
		weekday:'short',
		day: 'numeric',
		month: 'short',
		year: '2-digit'
	});
	return `Issue [${issue.action}] ${issue.title} @${issue.repo} (${issue.username} on ${date})`;
}

function formatIssueCommentObj (comment) {
	const date = new Date(comment.timestamp).toLocaleDateString('en-us', {
		weekday:'short',
		day: 'numeric',
		month: 'short',
		year: '2-digit'
	});
	return `Comment [${comment.action}] ${comment.content} (${comment.username} on ${date})`;
}

