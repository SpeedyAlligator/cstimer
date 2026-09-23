"use strict";

/* Load the same cubie representation and CFOP search code used by csTimer.
 * This is intentionally a build-time adapter: none of this search runs in the
 * browser when a production scramble is selected. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var FACES = 'FRUBLD';

function loadFile(root, relative) {
	vm.runInThisContext(fs.readFileSync(path.join(root, relative), 'utf8'), {filename: relative});
}

function installBrowserShims() {
	global.window = global;
	global.DEBUG = false;
	global.ISCSTIMER = false;
	global.$ = global.$ || {isArray: Array.isArray, noop: function() {}};
	global.$.isArray = global.$.isArray || Array.isArray;
	global.$.noop = global.$.noop || function() {};
	global.execMain = global.execMain || function() {};
	global.scrMgr = global.scrMgr || {
		reg: function() {
			var chain = function() { return chain; };
			return chain;
		}
	};
}

function parseScramble(scramble) {
	var tokens = String(scramble || '').trim().split(/\s+/);
	if (!tokens[0]) { throw new Error('Scramble is empty'); }
	return tokens.map(function(token) {
		if (!/^[FRUBLD](?:2|')?$/.test(token)) {
			throw new Error('Unsupported 3x3 move: ' + token);
		}
		return [FACES.indexOf(token.charAt(0)), 1, token.length === 1 ? 1 : token.charAt(1) === '2' ? 2 : 3];
	});
}

function randomMoveScramble(rng, length) {
	var result = [], previousAxis = -1;
	length = Number(length) || 20;
	for (var i = 0; i < length; i++) {
		var face;
		do { face = Math.floor(rng() * FACES.length); } while (face % 3 === previousAxis);
		previousAxis = face % 3;
		var suffix = ['', '2', "'"][Math.floor(rng() * 3)];
		result.push(FACES.charAt(face) + suffix);
	}
	return result.join(' ');
}

function loadCsTimer(root) {
	installBrowserShims();
	loadFile(root, 'src/js/lib/isaac.js');
	loadFile(root, 'src/js/lib/mathlib.js');
	loadFile(root, 'src/js/lib/min2phase.js');
	loadFile(root, 'src/js/scramble/scramble_333_edit.js');
	loadFile(root, 'src/js/tools/cross.js');
	return {
		cross: global.cross,
		randomStateScramble: global.scramble_333.getRandomScramble,
		parseScramble: parseScramble,
		randomMoveScramble: randomMoveScramble,
		faces: FACES
	};
}

module.exports = {loadCsTimer: loadCsTimer, parseScramble: parseScramble, randomMoveScramble: randomMoveScramble, FACES: FACES};
