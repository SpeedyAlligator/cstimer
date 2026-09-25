"use strict";

/*
 * Fixed-orientation CFOP analysis shared by generation and validation.
 * The cube is never rotated for classification:
 * U yellow, D white, F green, B blue, R red, L orange.
 */
var SLOT_ORDER = ['FR', 'FL', 'BL', 'BR'];
var REQUIRED_ORIENTATION = {U: 'yellow', D: 'white', F: 'green', B: 'blue', R: 'red', L: 'orange'};

function fail(message) { throw new Error(message); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function normalizedSolution(solution) {
	if (!solution) { return null; }
	if (typeof solution === 'string') { solution = solution.split(/\s+/); }
	return solution.map(function(move) { return String(move).trim(); }).filter(function(move) { return move.length; });
}
function numberAt(object, name) {
	var value = Number(object && object[name]);
	if (!isFinite(value) || value < 0 || Math.floor(value) !== value) { fail('Invalid configuration value: ' + name); }
	return value;
}
function validateConfig(config) {
	var face;
	if (!config || typeof config !== 'object') { fail('Generator configuration is missing'); }
	for (face in REQUIRED_ORIENTATION) {
		if (!config.orientation || config.orientation[face] !== REQUIRED_ORIENTATION[face]) {
			fail('This generator requires the fixed orientation U yellow / D white / F green / B blue / R red / L orange');
		}
	}
	if (numberAt(config.good, 'crossMoves') !== 0) { fail('Good is fixed at exactly zero white-cross moves'); }
	return {
		goodCrossMoves: 0,
		xcrossMaxMoves: numberAt(config.great, 'xcrossMaxMoves'),
		xxcrossMaxMoves: numberAt(config.insane, 'xxcrossMaxMoves'),
		xxxcrossMaxMoves: numberAt(config.jackpot, 'xxxcrossMaxMoves'),
		xxxxcrossMaxMoves: numberAt(config.exceptionalJackpot, 'xxxxcrossMaxMoves')
	};
}
function normalizedSlots(slots) {
	slots = (slots || []).slice().filter(function(slot) { return SLOT_ORDER.indexOf(slot) >= 0; });
	slots.sort(function(a, b) { return SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b); });
	return slots;
}
function verifiedDetail(runtime, initialState, detail, requiredSlotCount, label) {
	if (!detail || !detail.solution) { return null; }
	var solution = normalizedSolution(detail.solution);
	var state = runtime.applyMoves(initialState, solution);
	var slots = normalizedSlots(runtime.solvedSlots(state));
	if (!runtime.isCrossSolved(state) || slots.length < requiredSlotCount) {
		fail(label + ' solver result fails replay verification');
	}
	return {moves: solution.length, solution: solution, slots: slots};
}
function verifiedFullF2L(runtime, initialState, solution) {
	solution = normalizedSolution(solution);
	if (!solution) { return null; }
	var state = runtime.applyMoves(initialState, solution);
	if (!runtime.isFullF2LSolved(state)) { fail('XXXXCross solver result fails replay verification'); }
	return {moves: solution.length, solution: solution, slots: runtime.slotOrder.slice()};
}
function qualityFor(category, snapshot, details) {
	var score = snapshot.slots.length * 10;
	if (category === 'good') { score += 100; }
	if (category === 'great') { score += 300 + (4 - details.xcross.moves) * 20; }
	if (category === 'insane') { score += 500 + (6 - details.xxcross.moves) * 20; }
	if (category === 'jackpot') {
		score += 700 + (8 - details.xxxcross.moves) * 20;
		if (details.xxxxcross) { score += 300 + (9 - details.xxxxcross.moves) * 20; }
	}
	return {score: score, initialSolvedSlots: snapshot.slots.slice(), exceptionalJackpot: !!details.xxxxcross};
}
function makeEntry(scramble, category, snapshot, details) {
	var entry = {
		scramble: scramble,
		category: category,
		crossColor: 'white',
		quality: qualityFor(category, snapshot, details)
	};
	if (category === 'good') {
		entry.crossMoves = 0;
		entry.slots = snapshot.slots.slice();
	} else if (category === 'great') {
		entry.xcrossMoves = details.xcross.moves;
		entry.xcrossSolution = details.xcross.solution;
		entry.slots = details.xcross.slots;
	} else if (category === 'insane') {
		entry.xxcrossMoves = details.xxcross.moves;
		entry.xxcrossSolution = details.xxcross.solution;
		entry.slots = details.xxcross.slots;
	} else if (category === 'jackpot') {
		entry.xxxcrossMoves = details.xxxcross.moves;
		entry.xxxcrossSolution = details.xxxcross.solution;
		entry.slots = details.xxxcross.slots;
		entry.xxxxcross = !!details.xxxxcross;
		if (details.xxxxcross) {
			entry.xxxxcrossMoves = details.xxxxcross.moves;
			entry.xxxxcrossSolution = details.xxxxcross.solution;
		}
	}
	return entry;
}
function formatExample(entry) {
	var lines = [entry.category.toUpperCase(), 'Scramble: ' + entry.scramble, 'Hold: White D / Yellow U / Green F'];
	if (entry.crossMoves === 0) { lines.push('Cross: already solved (0 moves)'); }
	if (entry.xcrossMoves !== undefined) { lines.push('XCross: ' + entry.xcrossSolution.join(' ') + ' (' + entry.xcrossMoves + ' moves, ' + entry.slots.join(', ') + ')'); }
	if (entry.xxcrossMoves !== undefined) { lines.push('XXCross: ' + entry.xxcrossSolution.join(' ') + ' (' + entry.xxcrossMoves + ' moves, ' + entry.slots.join(', ') + ')'); }
	if (entry.xxxcrossMoves !== undefined) { lines.push('XXXCross: ' + entry.xxxcrossSolution.join(' ') + ' (' + entry.xxxcrossMoves + ' moves, ' + entry.slots.join(', ') + ')'); }
	if (entry.xxxxcross) { lines.push('XXXXCross: ' + entry.xxxxcrossSolution.join(' ') + ' (' + entry.xxxxcrossMoves + ' moves, complete F2L)'); }
	return lines.join('\n');
}

/* All screen values are admissible lower bounds. Exact searches are only run
 * for candidates whose lower bound leaves the configured target reachable. */
function analyzeCandidate(runtime, moves, config) {
	var limits = validateConfig(config);
	var initialState = runtime.cubeFromMoves(moves);
	var snapshot = {crossSolved: runtime.isCrossSolved(initialState), slots: normalizedSlots(runtime.solvedSlots(initialState))};
	var xScreen = runtime.cross.screenXCross(moves, 0);
	var xxScreen = runtime.cross.screenXXCross(moves, 0, false);
	var xxxScreen = runtime.cross.screenXXCross(moves, 0, true);
	var result = {snapshot: snapshot, screens: {xcross: xScreen, xxcross: xxScreen, xxxcross: xxxScreen}, details: {xcross: null, xxcross: null, xxxcross: null, xxxxcross: null}, category: null, entry: null};
	var solverResult = null;
	if (xxxScreen <= limits.xxxcrossMaxMoves) {
		solverResult = runtime.cross.analyze(moves, 0, {
			crossMax: limits.xxxcrossMaxMoves,
			xcrossMax: limits.xxxcrossMaxMoves,
			xxcrossMax: limits.xxxcrossMaxMoves,
			xxxcrossMax: limits.xxxcrossMaxMoves
		});
	} else if (xxScreen <= limits.xxcrossMaxMoves) {
		solverResult = runtime.cross.analyze(moves, 0, {
			crossMax: limits.xxcrossMaxMoves,
			xcrossMax: limits.xxcrossMaxMoves,
			xxcrossMax: limits.xxcrossMaxMoves,
			stopAfter: 'xxcross'
		});
	} else if (xScreen <= limits.xcrossMaxMoves) {
		solverResult = runtime.cross.analyze(moves, 0, {
			crossMax: limits.xcrossMaxMoves,
			xcrossMax: limits.xcrossMaxMoves,
			stopAfter: 'xcross'
		});
	}
	if (solverResult) {
		result.details.xcross = verifiedDetail(runtime, initialState, solverResult.xcross, 1, 'XCross');
		result.details.xxcross = verifiedDetail(runtime, initialState, solverResult.xxcross, 2, 'XXCross');
		result.details.xxxcross = verifiedDetail(runtime, initialState, solverResult.xxxcross, 3, 'XXXCross');
	}
	if (result.details.xxxcross && result.details.xxxcross.moves <= limits.xxxcrossMaxMoves) {
		result.details.xxxxcross = verifiedFullF2L(runtime, initialState, runtime.solveFullF2L(moves, limits.xxxxcrossMaxMoves));
	}
	if (result.details.xxxxcross && result.details.xxxxcross.moves <= limits.xxxxcrossMaxMoves) { result.category = 'jackpot'; }
	else if (result.details.xxxcross && result.details.xxxcross.moves <= limits.xxxcrossMaxMoves) { result.category = 'jackpot'; }
	else if (result.details.xxcross && result.details.xxcross.moves <= limits.xxcrossMaxMoves) { result.category = 'insane'; }
	else if (result.details.xcross && result.details.xcross.moves <= limits.xcrossMaxMoves) { result.category = 'great'; }
	else if (snapshot.crossSolved) { result.category = 'good'; }
	if (result.category) { result.entry = makeEntry('', result.category, snapshot, result.details); }
	return result;
}
function entryForScramble(scramble, analysis) {
	if (!analysis.entry) { return null; }
	var entry = copy(analysis.entry);
	entry.scramble = scramble;
	return entry;
}
function compareEntries(stored, calculated) {
	if (!stored || stored.category !== calculated.category) { return 'stored category does not match exact analysis'; }
	var fields = ['crossMoves', 'xcrossMoves', 'xxcrossMoves', 'xxxcrossMoves', 'xxxxcross', 'xxxxcrossMoves'];
	for (var i = 0; i < fields.length; i++) {
		var field = fields[i];
		if ((stored[field] === undefined ? null : stored[field]) !== (calculated[field] === undefined ? null : calculated[field])) { return field + ' does not match exact analysis'; }
	}
	var structuredFields = ['slots', 'xcrossSolution', 'xxcrossSolution', 'xxxcrossSolution', 'xxxxcrossSolution'];
	for (var j = 0; j < structuredFields.length; j++) {
		var structured = structuredFields[j];
		if (JSON.stringify(stored[structured] === undefined ? null : stored[structured]) !== JSON.stringify(calculated[structured] === undefined ? null : calculated[structured])) { return structured + ' does not match exact replay'; }
	}
	return null;
}

module.exports = {
	REQUIRED_ORIENTATION: REQUIRED_ORIENTATION,
	validateConfig: validateConfig,
	analyzeCandidate: analyzeCandidate,
	entryForScramble: entryForScramble,
	compareEntries: compareEntries,
	formatExample: formatExample,
	normalizedSolution: normalizedSolution
};
