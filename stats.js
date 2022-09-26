
exports.fmtHumanReadable = fmtHumanReadable;

exports.upTime = {
	id: 'uptime',
	description: 'Uptime',
	value: upTime
};

exports.loadAvg = {
	id: 'loadavg',
	description: 'Load Average',
	value: loadAvg
};

exports.memInfo = {
	id: 'meminfo',
	description: 'Memory Info',
	value: memInfo
};

exports.diskInfo = {
	id: 'diskinfo',
	description: 'Disk Info',
	value: diskInfo,
	options: {
		devs: [
			'/dev/sda',
		],
		mnts: [
			'/'
		]
	}
};

const Fs = require('node:fs').promises;

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

function fromKibiToBytes (value) {
	return value * 1024;
}

function fmtRound (value, precision) {
	const power = Math.pow(10, precision || 0);
	return String(Math.round(value * power) / power);
}

function fmtHumanReadable (value, total) {

	const perct = typeof total !== 'undefined' ?
		' (' + fmtRound(value * 100 / total) + '%)' : null;

	const units = ['K', 'M', 'G'];
	let unit = '';
	for (let index = 0; index < units.length && value > 1000; index++) {
		value /= 1000;
		unit = units[index];
	}

	return fmtRound(value, 1) +
		(unit.length > 0 ? unit : '') +
		(perct ?? '');
}

const uptimeExpr = /\s*([\s\w:]+) up ([\s\w:,]+),\s*(\d+) user/;
async function upTime () {
	const uptime = await execFile('uptime');
	const values = uptime.stdout.match(uptimeExpr)
		.map(v => v.trim());
	return `Current Time: ${values[1]}\n` +
		`Up Time: ${values[2].split(/\s*,\s*/).join(' and ')}\n` +
		`Logged in: ${values[3]} users`;
}

async function loadAvg () {
	const loadavg = await Fs.readFile('/proc/loadavg', 'utf8');
	const values = loadavg.split(/\s/);
	return `1min ${values[0]}\n` + 
		`5min ${values[1]}\n` +
		`15min ${values[2]}`;
}

async function memInfo () {
	const meminfo = await Fs.readFile('/proc/meminfo', 'utf8');
	const lines = meminfo.split(/\n\r*/)
		.filter(l => l.length > 0);

	const stats = {};
	for (let line of lines) {
		const columns = line.split(/:\s*/);
		const description = columns[0];
		const value = columns[1].split(/\s+/);
		stats[description] = {
			value: +value[0],
			unit: value[1]
		};
	}

	let memTotal = 0;
	const types = [
		{
			stat: 'MemTotal',
			description: 'Total',
			value: (s) => {
				memTotal = fromKibiToBytes(s.value);
				return fmtHumanReadable(memTotal);
			}
		},
		{
			stat: 'MemFree',
			description: 'Free',
			value: (s) => fmtHumanReadable(fromKibiToBytes(s.value), memTotal)
		},
		{
			stat: 'MemAvailable',
			description: 'Available',
			value: (s) => fmtHumanReadable(fromKibiToBytes(s.value), memTotal)
		},
		{
			stat: 'Active',
			description: 'Active',
			value: (s) => fmtHumanReadable(fromKibiToBytes(s.value), memTotal)
		}
	];

	let out = '';
	for (let type of types) {
		const stat = stats[type.stat];
		if (stat) {
			if (out.length > 0) out += '\n';
			out += `${type.description}: ${type.value(stat)}`;
		}
	}

	return out;
}

async function diskInfo (options) {
	const df = await execFile('df');
	const lines = df.stdout.split(/\n\r?/)
		.filter(l => l.length > 0);
	for (let l = 0; l < lines.length; l++)
		lines.splice(l, 1, lines[l].split(/\s+/));

	const devs = options.devs ?? [];
	const mnts = options.mnts ?? [];

	let out = '';
	for (let l = 1; l < lines.length; l++) {
		const dev = lines[l][0];
		const mnt = lines[l][5];

		const print =
			devs.find(d => dev.startsWith(d)) ||
			mnts.find(m => mnt === m);

		if (print) {
			const used = fromKibiToBytes(+lines[l][2]);
			const avail = fromKibiToBytes(+lines[l][3]);
			const usedPerct = lines[l][4];
			if (out.length > 0) out += '\n';
			out += `${dev} ${fmtHumanReadable(used)} ` +
				`(${usedPerct}) of ` + 
				`${fmtHumanReadable(avail)}`
		}
	}
	return out;
}
