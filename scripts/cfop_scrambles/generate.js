#!/usr/bin/env node
"use strict";

/* Generate ordinary-looking 3x3 scrambles whose fixed-orientation CFOP state
 * is independently replay-verified. All category distances are total moves
 * from the displayed scrambled state, never moves after making a cross. */
var fs = require('fs');
var path = require('path');
var runtimeLoader = require('./cstimer-runtime');
var cfop = require('./cfop-analysis');

var ROOT = path.resolve(__dirname, '../..');
var CATEGORIES = ['good', 'great', 'insane', 'jackpot'];

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function integer(value, name, allowZero) {
	value = Number(value);
	if (!isFinite(value) || Math.floor(value) !== value || value < (allowZero ? 0 : 1)) { fail(name + ' must be ' + (allowZero ? 'a non-negative integer' : 'a positive integer')); }
	return value;
}
function resolve(file) { return path.resolve(process.cwd(), file); }
function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	var temporary = file + '.tmp';
	fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
	fs.renameSync(temporary, file);
}
function writeRuntime(file, value) {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	var temporary = file + '.tmp';
	fs.writeFileSync(temporary, '"use strict";\nwindow.PRODUCTION_SCRAMBLES = ' + JSON.stringify(value) + ';\n');
	fs.renameSync(temporary, file);
}
function usage() {
	return [
		'Usage: node scripts/cfop_scrambles/generate.js [options]',
		'  --good-count N --great-count N --insane-count N --jackpot-count N',
		'  --xcross-max-moves N --xxcross-max-moves N --xxxcross-max-moves N --xxxxcross-max-moves N',
		'  --scramble-source random-state|random-move --candidate-limit N --time-limit MINUTES',
		'  --seed TEXT --survey N --output FILE --analysis-output FILE --runtime-js FILE',
		'  --checkpoint FILE --resume --progress-every N --config FILE'
	].join('\n');
}
function parseArgs(args) {
	var result = {}, values = {
		'good-count': true, 'great-count': true, 'insane-count': true, 'jackpot-count': true,
		'xcross-max-moves': true, 'xxcross-max-moves': true, 'xxxcross-max-moves': true, 'xxxxcross-max-moves': true,
		'scramble-source': true, 'candidate-limit': true, 'time-limit': true, 'seed': true, 'survey': true,
		'output': true, 'analysis-output': true, 'runtime-js': true, 'checkpoint': true, 'progress-every': true, 'config': true
	};
	for (var i = 0; i < args.length; i++) {
		var arg = args[i];
		if (arg === '--help' || arg === '-h') { result.help = true; continue; }
		if (arg === '--resume') { result.resume = true; continue; }
		if (arg.indexOf('--') !== 0 || !values[arg.slice(2)]) { fail('Unknown option: ' + arg + '\n' + usage()); }
		if (++i >= args.length) { fail('Missing value for ' + arg); }
		result[arg.slice(2)] = args[i];
	}
	return result;
}
function lcg(seed) {
	var state = 0;
	for (var i = 0; i < seed.length; i++) { state = (Math.imul(state ^ seed.charCodeAt(i), 1664525) + 1013904223) >>> 0; }
	if (!state) { state = 0x6d2b79f5; }
	return {
		getState: function() { return state >>> 0; },
		setState: function(next) { state = (Number(next) >>> 0) || 0x6d2b79f5; },
		next: function() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
	};
}
function counts(entries) {
	var result = {};
	CATEGORIES.forEach(function(category) { result[category] = entries[category].length; });
	return result;
}
function targetsMet(entries, targets) {
	return CATEGORIES.every(function(category) { return entries[category].length >= targets[category]; });
}
function onlyGoodRemains(entries, targets) {
	return entries.good.length < targets.good && ['great', 'insane', 'jackpot'].every(function(category) { return entries[category].length >= targets[category]; });
}
function sortEntries(entries) {
	CATEGORIES.forEach(function(category) {
		entries[category].sort(function(a, b) { return b.quality.score - a.quality.score || a.scramble.localeCompare(b.scramble); });
	});
}
function runtimeRecord(entry) {
	return {
		scramble: entry.scramble,
		category: entry.category,
		crossColor: entry.crossColor,
		crossMoves: entry.crossMoves === undefined ? null : entry.crossMoves,
		xcrossMoves: entry.xcrossMoves === undefined ? null : entry.xcrossMoves,
		xxcrossMoves: entry.xxcrossMoves === undefined ? null : entry.xxcrossMoves,
		xxxcrossMoves: entry.xxxcrossMoves === undefined ? null : entry.xxxcrossMoves,
		xxxxcross: !!entry.xxxxcross,
		xxxxcrossMoves: entry.xxxxcrossMoves === undefined ? null : entry.xxxxcrossMoves,
		slots: entry.slots || []
	};
}
function configure(args) {
	var checkpointFile = resolve(args.checkpoint || path.join(__dirname, '.checkpoint.json'));
	var checkpoint = args.resume ? readJson(checkpointFile) : null;
	if (checkpoint && checkpoint.version !== 2) { fail('Checkpoint uses the obsolete pre-fixed-orientation category model; start a new run without --resume.'); }
	var config = copy(checkpoint ? checkpoint.generatorConfig : readJson(resolve(args.config || path.join(__dirname, 'config.json'))));
	if (!config.targets) { fail('Generator targets are missing'); }
	config.targets.good = args['good-count'] === undefined ? integer(config.targets.good, 'targets.good', true) : integer(args['good-count'], '--good-count', true);
	config.targets.great = args['great-count'] === undefined ? integer(config.targets.great, 'targets.great', true) : integer(args['great-count'], '--great-count', true);
	config.targets.insane = args['insane-count'] === undefined ? integer(config.targets.insane, 'targets.insane', true) : integer(args['insane-count'], '--insane-count', true);
	config.targets.jackpot = args['jackpot-count'] === undefined ? integer(config.targets.jackpot, 'targets.jackpot', true) : integer(args['jackpot-count'], '--jackpot-count', true);
	config.great.xcrossMaxMoves = args['xcross-max-moves'] === undefined ? config.great.xcrossMaxMoves : integer(args['xcross-max-moves'], '--xcross-max-moves', true);
	config.insane.xxcrossMaxMoves = args['xxcross-max-moves'] === undefined ? config.insane.xxcrossMaxMoves : integer(args['xxcross-max-moves'], '--xxcross-max-moves', true);
	config.jackpot.xxxcrossMaxMoves = args['xxxcross-max-moves'] === undefined ? config.jackpot.xxxcrossMaxMoves : integer(args['xxxcross-max-moves'], '--xxxcross-max-moves', true);
	config.exceptionalJackpot.xxxxcrossMaxMoves = args['xxxxcross-max-moves'] === undefined ? config.exceptionalJackpot.xxxxcrossMaxMoves : integer(args['xxxxcross-max-moves'], '--xxxxcross-max-moves', true);
	config.scrambleSource = args['scramble-source'] || config.scrambleSource;
	config.scrambleLength = integer(config.scrambleLength, 'scrambleLength');
	config.candidateLimit = args['candidate-limit'] === undefined ? integer(config.candidateLimit, 'candidateLimit') : integer(args['candidate-limit'], '--candidate-limit');
	config.timeLimitMinutes = args['time-limit'] === undefined ? integer(config.timeLimitMinutes, 'timeLimitMinutes') : integer(args['time-limit'], '--time-limit');
	config.progressEvery = args['progress-every'] === undefined ? integer(config.progressEvery, 'progressEvery') : integer(args['progress-every'], '--progress-every');
	config.seed = args.seed === undefined ? String(config.seed || '') : String(args.seed);
	if (['random-state', 'random-move'].indexOf(config.scrambleSource) < 0) { fail('--scramble-source must be random-state or random-move'); }
	cfop.validateConfig(config);
	if (checkpoint && JSON.stringify(checkpoint.generatorConfig) !== JSON.stringify(config)) { fail('Checkpoint configuration does not match this run. Start a new run without --resume to change it.'); }
	return {config: config, checkpoint: checkpoint, checkpointFile: checkpointFile};
}
function main() {
	var args = parseArgs(process.argv.slice(2));
	if (args.help) { process.stdout.write(usage() + '\n'); return; }
	var setup = configure(args), config = setup.config, checkpoint = setup.checkpoint;
	var survey = args.survey === undefined ? 0 : integer(args.survey, '--survey');
	if (survey && args.resume) { fail('--survey cannot be combined with --resume'); }
	var runtime = runtimeLoader.loadCsTimer(ROOT);
	var random = lcg(config.seed || 'cfop-scrambles');
	if (config.scrambleSource === 'random-state' && config.seed) { mathlib.setSeed(0, config.seed); }
	if (checkpoint && checkpoint.sourceState) {
		if (config.scrambleSource === 'random-move') { random.setState(checkpoint.sourceState.lcg); }
		else { mathlib.setSeed(checkpoint.sourceState.randomState[0], checkpoint.sourceState.randomState[1]); }
	}
	var accepted = checkpoint && checkpoint.accepted || {good: [], great: [], insane: [], jackpot: []};
	CATEGORIES.forEach(function(category) { accepted[category] = accepted[category] || []; });
	var seen = {}, candidates = checkpoint && checkpoint.candidates || 0;
	CATEGORIES.forEach(function(category) { accepted[category].forEach(function(entry) { seen[entry.scramble] = true; }); });
	var runStartCandidates = candidates;
	var startedAt = checkpoint && checkpoint.startedAt || new Date().toISOString();
	var started = Date.now();
	function sourceState() {
		return config.scrambleSource === 'random-move' ? {lcg: random.getState()} : {randomState: mathlib.getSeed()};
	}
	function nextCandidate() {
		var scramble = config.scrambleSource === 'random-move' ? runtime.randomMoveScramble(random.next, config.scrambleLength) : runtime.randomStateScramble();
		candidates++;
		return {scramble: scramble, moves: runtime.parseScramble(scramble)};
	}
	function saveCheckpoint(done) {
		writeJson(setup.checkpointFile, {version: 2, startedAt: startedAt, updatedAt: new Date().toISOString(), done: !!done, generatorConfig: config, candidates: candidates, accepted: accepted, sourceState: sourceState()});
	}
	function rate(count) { return candidates ? (100 * count / candidates).toFixed(5) + '%' : '0.00000%'; }
	function report(prefix) {
		var current = counts(accepted), rates = {};
		CATEGORIES.forEach(function(category) { rates[category] = rate(current[category]); });
		process.stdout.write(prefix + ' candidates=' + candidates + ' accepted=' + JSON.stringify(current) + ' rates=' + JSON.stringify(rates) + ' speed=' + ((candidates - runStartCandidates) / Math.max(1, (Date.now() - started) / 1000)).toFixed(1) + '/s\n');
	}
	function writeOutputs(partial) {
		sortEntries(accepted);
		var generatedAt = new Date().toISOString();
		var fullDatabase = {version: 2, generatedAt: generatedAt, partial: !!partial, generator: 'scripts/cfop_scrambles/generate.js', orientation: config.orientation, generatorConfig: config, candidatesExamined: candidates, categories: accepted};
		var runtimeDatabase = {version: 2, generatedAt: generatedAt, partial: !!partial, orientation: config.orientation, generatorConfig: config, categories: {}};
		CATEGORIES.forEach(function(category) { runtimeDatabase.categories[category] = accepted[category].map(runtimeRecord); });
		writeJson(resolve(args['analysis-output'] || 'src/data/production_scrambles.analysis.json'), fullDatabase);
		writeJson(resolve(args.output || 'src/data/production_scrambles.min.json'), runtimeDatabase);
		writeRuntime(resolve(args['runtime-js'] || 'src/js/production_scrambles.js'), runtimeDatabase);
	}
	if (survey) {
		var hits = {good: 0, great: 0, insane: 0, jackpot: 0, exceptionalJackpot: 0};
		var conditions = {crossSolved: 0, xcrossAtMostLimit: 0, xxcrossAtMostLimit: 0, xxxcrossAtMostLimit: 0, xxxxcrossAtMostLimit: 0};
		for (var tested = 0; tested < survey; tested++) {
			var candidate = nextCandidate();
			var analysis = cfop.analyzeCandidate(runtime, candidate.moves, config);
			if (analysis.snapshot.crossSolved) { conditions.crossSolved++; }
			if (analysis.details.xcross && analysis.details.xcross.moves <= config.great.xcrossMaxMoves) { conditions.xcrossAtMostLimit++; }
			if (analysis.details.xxcross && analysis.details.xxcross.moves <= config.insane.xxcrossMaxMoves) { conditions.xxcrossAtMostLimit++; }
			if (analysis.details.xxxcross && analysis.details.xxxcross.moves <= config.jackpot.xxxcrossMaxMoves) { conditions.xxxcrossAtMostLimit++; }
			if (analysis.details.xxxxcross && analysis.details.xxxxcross.moves <= config.exceptionalJackpot.xxxxcrossMaxMoves) { conditions.xxxxcrossAtMostLimit++; }
			if (analysis.category) { hits[analysis.category]++; }
			if (analysis.entry && analysis.entry.xxxxcross) { hits.exceptionalJackpot++; }
			if ((tested + 1) % config.progressEvery === 0 || tested === 0) { process.stdout.write('Survey progress candidates=' + candidates + ' categories=' + JSON.stringify(hits) + ' conditions=' + JSON.stringify(conditions) + '\n'); }
		}
		var seconds = (Date.now() - started) / 1000, speed = survey / Math.max(seconds, .001);
		process.stdout.write('Empirical fixed-orientation CFOP survey\n');
		process.stdout.write('Orientation: White D / Yellow U / Green F\n');
		var conditionLabels = {crossSolved: 'Cross already solved (Good condition)', xcrossAtMostLimit: 'XCross <= ' + config.great.xcrossMaxMoves, xxcrossAtMostLimit: 'XXCross <= ' + config.insane.xxcrossMaxMoves, xxxcrossAtMostLimit: 'XXXCross <= ' + config.jackpot.xxxcrossMaxMoves, xxxxcrossAtMostLimit: 'XXXXCross <= ' + config.exceptionalJackpot.xxxxcrossMaxMoves + ' among XXXCross Jackpots'};
		Object.keys(conditions).forEach(function(name) {
			var hit = conditions[name], denominator = name === 'xxxxcrossAtMostLimit' ? conditions.xxxcrossAtMostLimit : survey, probability = denominator ? hit / denominator : 0;
			process.stdout.write(conditionLabels[name] + ': hits=' + hit + '/' + denominator + ' probability=' + (100 * probability).toFixed(6) + '%\n');
		});
		process.stdout.write('Highest-category acceptance and projected target time\n');
		CATEGORIES.forEach(function(category) {
			var hit = hits[category], probability = hit / survey, target = config.targets[category];
			var projected = hit ? (target / probability / speed / 60).toFixed(1) + ' min for ' + target : 'no finite estimate (0 hits)';
			process.stdout.write(category + ': hits=' + hit + '/' + survey + ' probability=' + (100 * probability).toFixed(6) + '% projected=' + projected + '\n');
		});
		process.stdout.write('Speed: ' + speed.toFixed(1) + ' candidates/s (' + seconds.toFixed(1) + 's)\n');
		return;
	}
	report('Starting');
	while (!targetsMet(accepted, config.targets)) {
		if (candidates >= config.candidateLimit || Date.now() - started > config.timeLimitMinutes * 60000) {
			writeOutputs(true); saveCheckpoint(false); report('Partial database written');
			fail(candidates >= config.candidateLimit ? 'Candidate limit reached; checkpoint saved at ' + setup.checkpointFile : 'Time limit reached; checkpoint saved at ' + setup.checkpointFile);
		}
		var candidate = nextCandidate();
		if (seen[candidate.scramble]) { continue; }
		seen[candidate.scramble] = true;
		/* Once every higher category is full, a state without an already solved
		 * white cross cannot possibly fill the sole remaining Good quota. A
		 * cross-solved state still receives full high-category analysis so it is
		 * never incorrectly demoted. */
		if (onlyGoodRemains(accepted, config.targets) && !runtime.isCrossSolved(runtime.cubeFromMoves(candidate.moves))) { continue; }
		var analysis = cfop.analyzeCandidate(runtime, candidate.moves, config);
		if (analysis.entry && accepted[analysis.category].length < config.targets[analysis.category]) {
			var entry = cfop.entryForScramble(candidate.scramble, analysis);
			accepted[analysis.category].push(entry);
			process.stdout.write(cfop.formatExample(entry) + '\n\n');
		}
		if (candidates === 1 || candidates % config.progressEvery === 0) { report('Progress'); saveCheckpoint(false); }
	}
	writeOutputs(false); saveCheckpoint(true); report('Complete');
	process.stdout.write('Wrote fixed-orientation runtime and analysis databases.\n');
}

try { main(); } catch (error) { process.stderr.write('generate: ' + error.message + '\n'); process.exitCode = 1; }
