#!/usr/bin/env node
"use strict";

/* Focused regression checks for fixed orientation, replay, and full F2L. */
var assert = require('assert');
var path = require('path');
var runtimeLoader = require('./cstimer-runtime');
var cfop = require('./cfop-analysis');

var ROOT = path.resolve(__dirname, '../..');
var config = require('./config.json');
var database = require('../../src/data/production_scrambles.analysis.json');
var runtime = runtimeLoader.loadCsTimer(ROOT);

cfop.validateConfig(config);
var firstGood = database.categories.good[0];
assert(firstGood, 'generated database needs a Good fixture');
var goodState = runtime.cubeFromMoves(runtime.parseScramble(firstGood.scramble));
assert(runtime.isCrossSolved(goodState), 'Good fixture must begin with its white cross solved');

/* R U R' leaves three F2L slots solved. Its exact full-F2L completion proves
 * that XXXXCross detection replays a real all-four-slot target. */
var exceptional = cfop.analyzeCandidate(runtime, runtime.parseScramble("R U R'"), config).entry;
assert(exceptional && exceptional.category === 'jackpot', 'complete F2L fixture must rank as Jackpot');
assert(exceptional.xxxxcross, 'complete F2L fixture must be exceptional');
assert.strictEqual(exceptional.xxxxcrossMoves, 3, 'XXXXCross length must be total moves from the scrambled state');

process.stdout.write('Fixed-orientation CFOP regression checks passed.\n');
