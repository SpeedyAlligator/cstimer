#!/usr/bin/env node
"use strict";

/* Recompute fixed-orientation categories and replay every stored solution. */
var fs = require('fs');
var path = require('path');
var runtimeLoader = require('./cstimer-runtime');
var cfop = require('./cfop-analysis');

var ROOT = path.resolve(__dirname, '../..');
var CATEGORIES = ['good', 'great', 'insane', 'jackpot'];

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
function positive(value, name) {
	value = Number(value);
	if (!isFinite(value) || value < 1 || Math.floor(value) !== value) { fail(name + ' must be a positive integer'); }
	return value;
}
function main() {
	var args = parseArgs(process.argv.slice(2));
	if (args.help) { process.stdout.write('Usage: node scripts/cfop_scrambles/validate_generated_scrambles.js [--input FILE] [--sample N]\n'); return; }
	var input = path.resolve(process.cwd(), args.input || 'src/data/production_scrambles.analysis.json');
	var database = JSON.parse(fs.readFileSync(input, 'utf8'));
	if (database.version !== 2 || !database.generatorConfig || !database.categories) { fail('Not a version 2 fixed-orientation production analysis database: ' + input); }
	cfop.validateConfig(database.generatorConfig);
	var sample = args.sample === undefined ? null : positive(args.sample, '--sample');
	var runtime = runtimeLoader.loadCsTimer(ROOT), seen = {}, checked = 0, failures = [];
	CATEGORIES.forEach(function(category) {
		var entries = database.categories[category] || [];
		(sample === null ? entries : entries.slice(0, sample)).forEach(function(entry, index) {
			try {
				if (seen[entry.scramble]) { fail('duplicate scramble'); }
				seen[entry.scramble] = true;
				if (entry.category !== category) { fail('stored category is ' + entry.category); }
				if (entry.crossColor !== 'white') { fail('cross color is not fixed white'); }
				var moves = runtime.parseScramble(entry.scramble);
				var analysis = cfop.analyzeCandidate(runtime, moves, database.generatorConfig);
				if (!analysis.entry) { fail('re-analysis finds no qualifying category'); }
				var difference = cfop.compareEntries(entry, cfop.entryForScramble(entry.scramble, analysis));
				if (difference) { fail(difference); }
				checked++;
			} catch (error) { failures.push(category + '[' + index + ']: ' + error.message); }
		});
	});
	process.stdout.write('Validated ' + checked + ' fixed-orientation generated scrambles from ' + input + '.\n');
	if (failures.length) { process.stderr.write(failures.join('\n') + '\n'); process.exitCode = 1; }
	else { process.stdout.write('All entries replay to their claimed Cross/F2L target and retain their highest exact category.\n'); }
}

try { main(); } catch (error) { process.stderr.write('validate: ' + error.message + '\n'); process.exitCode = 1; }
