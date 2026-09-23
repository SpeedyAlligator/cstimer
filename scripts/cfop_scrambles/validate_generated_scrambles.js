#!/usr/bin/env node
"use strict";

/* Re-run the exact offline search over a generated analysis database. */
var fs = require('fs');
var path = require('path');
var runtimeLoader = require('./cstimer-runtime');

var ROOT = path.resolve(__dirname, '../..');
var CATEGORIES = ['good', 'great', 'insane', 'jackpot'];
var COLOR_FACES = {white: 0, yellow: 1, orange: 2, red: 3, green: 4, blue: 5};

function fail(message) { throw new Error(message); }
function parseArgs(args) {
	var result = {};
	for (var i = 0; i < args.length; i++) {
		if (args[i] === '--help' || args[i] === '-h') { result.help = true; continue; }
		if ((args[i] !== '--input' && args[i] !== '--sample') || ++i >= args.length) { fail('Usage: node scripts/cfop_scrambles/validate_generated_scrambles.js [--input FILE] [--sample N]'); }
		result[args[i - 1].slice(2)] = args[i];
	}
	return result;
}
function categoryFor(analysis, thresholds) {
	if (analysis.xxxcross && analysis.xxxcross.moves <= thresholds.xxxcrossMax) { return 'jackpot'; }
	if (analysis.xxcross && analysis.xxcross.moves <= thresholds.xxcrossMax) { return 'insane'; }
	if (analysis.xcross && analysis.xcross.moves <= thresholds.xcrossMax) { return 'great'; }
	if (analysis.cross && analysis.cross.moves <= thresholds.crossMax) { return 'good'; }
	return null;
}
function rank(category) { return CATEGORIES.indexOf(category); }
function main() {
	var args = parseArgs(process.argv.slice(2));
	if (args.help) { process.stdout.write('Usage: node scripts/cfop_scrambles/validate_generated_scrambles.js [--input FILE] [--sample N]\n'); return; }
	var input = path.resolve(process.cwd(), args.input || 'src/data/production_scrambles.analysis.json');
	var database = JSON.parse(fs.readFileSync(input, 'utf8'));
	if (!database.generatorConfig || !database.categories) { fail('Not a production analysis database: ' + input); }
	var thresholds = database.generatorConfig.thresholds;
	var sample = args.sample === undefined ? null : Number(args.sample);
	if (sample !== null && (!isFinite(sample) || sample < 1)) { fail('--sample must be positive'); }
	var runtime = runtimeLoader.loadCsTimer(ROOT), seen = {}, checked = 0, failures = [];
	CATEGORIES.forEach(function(category) {
		var entries = database.categories[category] || [];
		(sample === null ? entries : entries.slice(0, sample)).forEach(function(entry, index) {
			try {
				if (seen[entry.scramble]) { fail('duplicate scramble'); }
				seen[entry.scramble] = true;
				if (entry.classification !== category) { fail('stored classification is ' + entry.classification); }
				if (COLOR_FACES[entry.crossColor] === undefined) { fail('unknown cross color ' + entry.crossColor); }
				var moves = runtime.parseScramble(entry.scramble);
				var depth = Math.max(thresholds.crossMax, thresholds.xcrossMax, thresholds.xxcrossMax, thresholds.xxxcrossMax);
				var colors = database.generatorConfig.crossColor === 'BEST_OF_SIX' ? Object.keys(COLOR_FACES) : [entry.crossColor];
				var actual = null, storedAnalysis = null;
				colors.forEach(function(color) {
					var analysis = runtime.cross.analyze(moves, COLOR_FACES[color], {crossMax: depth, xcrossMax: depth, xxcrossMax: depth, xxxcrossMax: thresholds.xxxcrossMax});
					var candidate = categoryFor(analysis, thresholds);
					if (color === entry.crossColor) { storedAnalysis = analysis; }
					if (candidate && (!actual || rank(candidate) > rank(actual))) { actual = candidate; }
				});
				if (actual !== category) { fail('re-analysis classifies as ' + (actual || 'none')); }
				if (!storedAnalysis || entry.crossMoves !== storedAnalysis.cross.moves) { fail('stored cross depth does not match exact re-analysis'); }
				checked++;
			} catch (error) { failures.push(category + '[' + index + ']: ' + error.message); }
		});
	});
	process.stdout.write('Validated ' + checked + ' generated scrambles from ' + input + '.\n');
	if (failures.length) { process.stderr.write(failures.join('\n') + '\n'); process.exitCode = 1; }
	else { process.stdout.write('All categories are legal, unique, and meet their highest exact CFOP classification.\n'); }
}

try { main(); } catch (error) { process.stderr.write('validate: ' + error.message + '\n'); process.exitCode = 1; }
