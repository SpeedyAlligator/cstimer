"use strict";

/* Load the same cubie representation and CFOP search code used by csTimer.
 * This is intentionally a build-time adapter: none of this search runs in the
 * browser when a production scramble is selected. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var FACES = 'FRUBLD';
var CUBE_FACES = 'URFDLB';
var SLOT_DEFINITIONS = {
	FR: {corner: 4, edge: 8},
	FL: {corner: 5, edge: 9},
	BL: {corner: 6, edge: 10},
	BR: {corner: 7, edge: 11}
};
var SLOT_ORDER = ['FR', 'FL', 'BL', 'BR'];
/* U is deliberately unconstrained. Every D sticker and the lower two rows of
 * F/R/B/L must match their fixed centers, which is exactly Cross + all F2L. */
var F2L_TARGET = '----U-------RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB';
var fullF2LSolver;

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

function tokenFromMove(move) {
	return FACES.charAt(move[0]) + (move[2] === 1 ? '' : move[2] === 2 ? '2' : "'");
}

function copyCube(cube) {
	return new mathlib.CubieCube().init(cube.ca, cube.ea);
}

function applyMoves(cube, moves) {
	cube = copyCube(cube);
	for (var i = 0; i < moves.length; i++) {
		var token = (typeof moves[i] === 'string' ? moves[i] : tokenFromMove(moves[i])).trim();
		var face = CUBE_FACES.indexOf(token.charAt(0));
		var power = token.length === 1 ? 1 : token.charAt(1) === '2' ? 2 : 3;
		if (face < 0) { throw new Error('Unsupported cube move: ' + token); }
		var next = new mathlib.CubieCube();
		mathlib.CubieCube.CubeMult(cube, mathlib.CubieCube.moveCube[face * 3 + power - 1], next);
		cube = next;
	}
	return cube;
}

function cubeFromMoves(moves) {
	return applyMoves(new mathlib.CubieCube(), moves);
}

function isCrossSolved(cube) {
	return [4, 5, 6, 7].every(function(edge) { return cube.ea[edge] === edge * 2; });
}

function solvedSlots(cube) {
	return SLOT_ORDER.filter(function(name) {
		var slot = SLOT_DEFINITIONS[name];
		return cube.ca[slot.corner] === slot.corner && cube.ea[slot.edge] === slot.edge * 2;
	});
}

function isFullF2LSolved(cube) {
	return isCrossSolved(cube) && solvedSlots(cube).length === SLOT_ORDER.length;
}

function fullF2LMove(state, token) {
	var face = CUBE_FACES.indexOf(token.charAt(0));
	var power = token.length === 1 ? 1 : token.charAt(1) === '2' ? 2 : 3;
	var permutation = mathlib.CubieCube.moveCube[face * 3 + power - 1].toPerm();
	return permutation.map(function(index) { return state.charAt(index); }).join('');
}

function fullF2LMoves() {
	var moves = {}, suffixes = ['', '2', "'"];
	for (var i = 0; i < CUBE_FACES.length; i++) {
		for (var j = 0; j < suffixes.length; j++) {
			moves[CUBE_FACES.charAt(i) + suffixes[j]] = i * 3 + j;
		}
	}
	return moves;
}

function solveFullF2L(moves, maxDepth) {
	if (!fullF2LSolver) {
		/* mathlib.gSolver is csTimer's generic iterative-deepening solver. The
		 * target leaves the last layer unconstrained and searches exact distance. */
		fullF2LSolver = new mathlib.gSolver([F2L_TARGET], fullF2LMove, fullF2LMoves());
	}
	var state = F2L_TARGET;
	for (var i = 0; i < moves.length; i++) { state = fullF2LMove(state, tokenFromMove(moves[i])); }
	return fullF2LSolver.search(state, 0, maxDepth);
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
		cubeFromMoves: cubeFromMoves,
		applyMoves: applyMoves,
		isCrossSolved: isCrossSolved,
		solvedSlots: solvedSlots,
		isFullF2LSolved: isFullF2LSolved,
		solveFullF2L: solveFullF2L,
		slotOrder: SLOT_ORDER.slice(),
		faces: FACES
	};
}

module.exports = {loadCsTimer: loadCsTimer, parseScramble: parseScramble, randomMoveScramble: randomMoveScramble, FACES: FACES};
