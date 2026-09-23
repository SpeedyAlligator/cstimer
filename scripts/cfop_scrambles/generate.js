#!/usr/bin/env node
"use strict";

/*
 * Build a verified, static production scramble database.  Candidates are
 * ordinary legal 3x3 random-state scrambles by default (or legal random move
 * sequences for fast, deterministic test runs); no favorable state is built
 * directly.  Classification is the highest exact CFOP goal found by csTimer's
 * own cross / XCross / XXCross / XXXCross IDA searches.
 */
var fs = require('fs');
var path = require('path');
var runtimeLoader = require('./cstimer-runtime');

var ROOT = path.resolve(__dirname, '../..');
var CATEGORIES = ['good', 'great', 'insane', 'jackpot'];
var COLOR_FACES = {
	white: 0,
	yellow: 1,
	orange: 2,
	red: 3,
	green: 4,
	blue: 5
};
var COLORS = Object.keys(COLOR_FACES).map(function(name) { return {name: name, face: COLOR_FACES[name]}; });

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function merge(value, fallback) {
	var result = {}, key;
	if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) { return value === undefined ? fallback : value; }
	value = value && typeof value === 'object' ? value : {};
	for (key in fallback) { result[key] = merge(value[key], fallback[key]); }
	for (key in value) { if (!(key in result)) { result[key] = value[key]; } }
	return result;
}
function positive(value, name, allowZero) {
	value = Number(value);
	if (!isFinite(value) || value < (allowZero ? 0 : 1)) { fail(name + ' must be ' + (allowZero ? 'non-negative' : 'positive')); }
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
		'  --cross-max N --xcross-max N --xxcross-max N --xxxcross-max N',
		'  --cross-color WHITE_ONLY|BEST_OF_SIX',
		'  --scramble-source random-state|random-move --candidate-limit N --time-limit MINUTES',
		'  --seed TEXT --output FILE --analysis-output FILE --runtime-js FILE',
		'  --checkpoint FILE --resume --progress-every N --config FILE'
	].join('\n');
}
function parseArgs(args) {
	var result = {}, values = {
		'good-count': true, 'great-count': true, 'insane-count': true, 'jackpot-count': true,
		'cross-max': true, 'xcross-max': true, 'xxcross-max': true, 'xxxcross-max': true,
		'cross-color': true, 'scramble-source': true, 'candidate-limit': true, 'time-limit': true,
		'seed': true, 'output': true, 'analysis-output': true, 'runtime-js': true,
		'checkpoint': true, 'progress-every': true, 'config': true
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
function detail(value) {
	return value ? {moves: value.moves, slots: value.slots || (value.slot ? [value.slot] : []), solution: value.solution} : null;
}
function categoryFor(analysis, thresholds) {
	if (analysis.xxxcross && analysis.xxxcross.moves <= thresholds.xxxcrossMax) { return 'jackpot'; }
	if (analysis.xxcross && analysis.xxcross.moves <= thresholds.xxcrossMax) { return 'insane'; }
	if (analysis.xcross && analysis.xcross.moves <= thresholds.xcrossMax) { return 'great'; }
	if (analysis.cross && analysis.cross.moves <= thresholds.crossMax) { return 'good'; }
	return null;
}
function rank(category) { return CATEGORIES.indexOf(category); }
function chooseAnalysis(candidates, thresholds) {
	var chosen = null;
	candidates.forEach(function(candidate) {
		var category = categoryFor(candidate.analysis, thresholds);
		if (!category) { return; }
		if (!chosen || rank(category) > rank(chosen.category) || rank(category) === rank(chosen.category) && candidate.analysis.cross.moves < chosen.analysis.cross.moves) {
			chosen = {category: category, color: candidate.color, analysis: candidate.analysis};
		}
	});
	return chosen;
}
function makeEntry(scramble, choice) {
	var analysis = choice.analysis;
	return {
		scramble: scramble,
		classification: choice.category,
		crossColor: choice.color.name,
		crossMoves: analysis.cross.moves,
		crossSolution: analysis.cross.solution,
		xcross: detail(analysis.xcross),
		xxcross: detail(analysis.xxcross),
		xxxcross: detail(analysis.xxxcross),
		/* The generator deliberately does not claim LL skips or a fourth pair. */
		xxxxcross: false,
		ollSkip: false,
		pllSkip: false
	};
}
function runtimeRecord(entry) {
	return {
		scramble: entry.scramble,
		classification: entry.classification,
		crossColor: entry.crossColor,
		crossMoves: entry.crossMoves,
		xcrossMoves: entry.xcross && entry.xcross.moves || null,
		xxcrossMoves: entry.xxcross && entry.xxcross.moves || null,
		xxxcrossMoves: entry.xxxcross && entry.xxxcross.moves || null
	};
}
function counts(accepted) {
	var result = {};
	CATEGORIES.forEach(function(category) { result[category] = accepted[category].length; });
	return result;
}
function targetsMet(accepted, targets) {
	return CATEGORIES.every(function(category) { return accepted[category].length >= targets[category]; });
}
function main() {
	var args = parseArgs(process.argv.slice(2));
	if (args.help) { process.stdout.write(usage() + '\n'); return; }
	var checkpointFile = resolve(args.checkpoint || path.join(__dirname, '.checkpoint.json'));
	var checkpoint = args.resume ? readJson(checkpointFile) : null;
	var configFile = resolve(args.config || path.join(__dirname, 'config.json'));
	var defaults = readJson(configFile);
	if (checkpoint && !checkpoint.generatorConfig) { fail('Checkpoint has no generator configuration: ' + checkpointFile); }
	/* A bare --resume deliberately reuses the recorded configuration. Explicit
	 * flags may still be supplied, but changing the candidate source or analysis
	 * thresholds is rejected below because its saved RNG position is no longer a
	 * reproducible continuation. */
	var config = merge({}, checkpoint ? checkpoint.generatorConfig : defaults);
	config.targets.good = args['good-count'] === undefined ? config.targets.good : positive(args['good-count'], '--good-count', true);
	config.targets.great = args['great-count'] === undefined ? config.targets.great : positive(args['great-count'], '--great-count', true);
	config.targets.insane = args['insane-count'] === undefined ? config.targets.insane : positive(args['insane-count'], '--insane-count', true);
	config.targets.jackpot = args['jackpot-count'] === undefined ? config.targets.jackpot : positive(args['jackpot-count'], '--jackpot-count', true);
	config.thresholds.crossMax = args['cross-max'] === undefined ? config.thresholds.crossMax : positive(args['cross-max'], '--cross-max', true);
	config.thresholds.xcrossMax = args['xcross-max'] === undefined ? config.thresholds.xcrossMax : positive(args['xcross-max'], '--xcross-max', true);
	config.thresholds.xxcrossMax = args['xxcross-max'] === undefined ? config.thresholds.xxcrossMax : positive(args['xxcross-max'], '--xxcross-max', true);
	config.thresholds.xxxcrossMax = args['xxxcross-max'] === undefined ? config.thresholds.xxxcrossMax : positive(args['xxxcross-max'], '--xxxcross-max', true);
	config.crossColor = args['cross-color'] || config.crossColor;
	config.scrambleSource = args['scramble-source'] || config.scrambleSource;
	config.scrambleLength = positive(config.scrambleLength, 'scrambleLength');
	config.candidateLimit = args['candidate-limit'] === undefined ? config.candidateLimit : positive(args['candidate-limit'], '--candidate-limit');
	config.timeLimitMinutes = args['time-limit'] === undefined ? config.timeLimitMinutes : positive(args['time-limit'], '--time-limit');
	config.progressEvery = args['progress-every'] === undefined ? config.progressEvery : positive(args['progress-every'], '--progress-every');
	config.seed = args.seed === undefined ? String(config.seed || '') : String(args.seed);
	if (['WHITE_ONLY', 'BEST_OF_SIX'].indexOf(config.crossColor) < 0) { fail('--cross-color must be WHITE_ONLY or BEST_OF_SIX'); }
	if (['random-state', 'random-move'].indexOf(config.scrambleSource) < 0) { fail('--scramble-source must be random-state or random-move'); }
	var output = resolve(args.output || 'src/data/production_scrambles.min.json');
	var analysisOutput = resolve(args['analysis-output'] || 'src/data/production_scrambles.analysis.json');
	var runtimeOutput = resolve(args['runtime-js'] || 'src/js/production_scrambles.js');
	var generatorConfig = copy(config);
	if (checkpoint && JSON.stringify(checkpoint.generatorConfig) !== JSON.stringify(generatorConfig)) {
		fail('Checkpoint configuration does not match this run. Use the original options or start a new run without --resume.');
	}
	var runtime = runtimeLoader.loadCsTimer(ROOT);
	var random = lcg(config.seed || 'cfop-scrambles');
	if (config.scrambleSource === 'random-state' && config.seed) { mathlib.setSeed(0, config.seed); }
	if (checkpoint && checkpoint.sourceState) {
		if (config.scrambleSource === 'random-move') { random.setState(checkpoint.sourceState.lcg); }
		else { mathlib.setSeed(checkpoint.sourceState.randomState[0], checkpoint.sourceState.randomState[1]); }
	}
	var accepted = checkpoint && checkpoint.accepted || {good: [], great: [], insane: [], jackpot: []};
	CATEGORIES.forEach(function(category) { accepted[category] = accepted[category] || []; });
	var seen = {};
	CATEGORIES.forEach(function(category) { accepted[category].forEach(function(entry) { seen[entry.scramble] = true; }); });
	var candidates = checkpoint && checkpoint.candidates || 0;
	var startedAt = checkpoint && checkpoint.startedAt || new Date().toISOString();
	var started = Date.now();
	var colors = config.crossColor === 'BEST_OF_SIX' ? COLORS : [COLORS[0]];
	var analysisLimit = Math.max(config.thresholds.crossMax, config.thresholds.xcrossMax, config.thresholds.xxcrossMax, config.thresholds.xxxcrossMax);
	function sourceState() {
		return config.scrambleSource === 'random-move' ? {lcg: random.getState()} : {randomState: mathlib.getSeed()};
	}
	function saveCheckpoint(done) {
		writeJson(checkpointFile, {version: 1, startedAt: startedAt, updatedAt: new Date().toISOString(), done: !!done, generatorConfig: generatorConfig, candidates: candidates, accepted: accepted, sourceState: sourceState()});
	}
	function report(prefix) {
		var current = counts(accepted), rate = {};
		CATEGORIES.forEach(function(category) { rate[category] = candidates ? (100 * current[category] / candidates).toFixed(2) + '%' : '0.00%'; });
		process.stdout.write(prefix + ' candidates=' + candidates + ' accepted=' + JSON.stringify(current) + ' rates=' + JSON.stringify(rate) + ' elapsed=' + ((Date.now() - started) / 1000).toFixed(1) + 's\n');
	}
	report('Starting');
	while (!targetsMet(accepted, config.targets)) {
		if (candidates >= config.candidateLimit) { saveCheckpoint(false); fail('Candidate limit reached; checkpoint saved at ' + checkpointFile); }
		if (Date.now() - started > config.timeLimitMinutes * 60000) { saveCheckpoint(false); fail('Time limit reached; checkpoint saved at ' + checkpointFile); }
		var scramble = config.scrambleSource === 'random-move' ? runtime.randomMoveScramble(random.next, config.scrambleLength) : runtime.randomStateScramble();
		candidates++;
		if (seen[scramble]) { continue; }
		seen[scramble] = true;
		var moves = runtime.parseScramble(scramble);
		/* A cross lower bound above every target means no higher structure can
		 * qualify; this cheap screen avoids unnecessary full searches. */
		var analyses = [];
		colors.forEach(function(color) {
			if (runtime.cross.screen(moves, color.face) > analysisLimit) { return; }
			analyses.push({color: color, analysis: runtime.cross.analyze(moves, color.face, {
				crossMax: analysisLimit,
				xcrossMax: analysisLimit,
				xxcrossMax: analysisLimit,
				xxxcrossMax: config.thresholds.xxxcrossMax
			})});
		});
		var choice = chooseAnalysis(analyses, config.thresholds);
		if (choice && accepted[choice.category].length < config.targets[choice.category]) {
			accepted[choice.category].push(makeEntry(scramble, choice));
		}
		if (candidates === 1 || candidates % config.progressEvery === 0) { report('Progress'); saveCheckpoint(false); }
	}
	var generatedAt = new Date().toISOString();
	var fullDatabase = {version: 1, generatedAt: generatedAt, generator: 'scripts/cfop_scrambles/generate.js', generatorConfig: generatorConfig, candidatesExamined: candidates, categories: accepted};
	var runtimeDatabase = {version: 1, generatedAt: generatedAt, generatorConfig: generatorConfig, categories: {}};
	CATEGORIES.forEach(function(category) { runtimeDatabase.categories[category] = accepted[category].map(runtimeRecord); });
	writeJson(analysisOutput, fullDatabase);
	writeJson(output, runtimeDatabase);
	writeRuntime(runtimeOutput, runtimeDatabase);
	saveCheckpoint(true);
	report('Complete');
	process.stdout.write('Wrote runtime database: ' + output + '\nWrote analysis database: ' + analysisOutput + '\nWrote browser data: ' + runtimeOutput + '\n');
}

try { main(); } catch (error) { process.stderr.write('generate: ' + error.message + '\n'); process.exitCode = 1; }
