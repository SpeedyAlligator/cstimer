"use strict";

/* Production-only controls for the film-prop fork.  Stock timer paths ask
 * this module for an optional clock transform or scramble; it owns all state
 * and does not patch Date, performance, timers, or requestAnimationFrame. */
var production = execMain(function() {
	var CONFIG_KEY = 'production.config';
	var PRESETS_KEY = 'production.presets';
	var activeSolve = null;
	var lastSolve = null;
	var selectedPreset = '';
	var lastCurated = {};
	var modal, tabs, content, selectedTab = 'timer', captureId = null;
	var logoClicks = [], logoTid = 0, shiftTid = 0, shiftHeld = false;

	function wallNow() { return $.now(); }
	function clamp(value, fallback, min, max) {
		value = Number(value);
		if (!isFinite(value)) { value = fallback; }
		return Math.max(min, Math.min(max, value));
	}
	function copy(value) { return JSON.parse(JSON.stringify(value)); }
	function json(key, fallback) {
		try { return localStorage[key] ? JSON.parse(localStorage[key]) : fallback; } catch (err) { return fallback; }
	}
	function bindingDefaults() {
		return [
			{id: 'video', action: 'toggleVideoMode', target: '', binding: 'KeyV', activation: 'toggle', enabled: true, armed: true},
			{id: 'timer', action: 'toggleTimerManipulation', target: '', binding: 'KeyT', activation: 'toggle', enabled: true, armed: true},
			{id: 'presetA', action: 'activateTimerPreset', target: 'A', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'presetB', action: 'activateTimerPreset', target: 'B', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'presetC', action: 'activateTimerPreset', target: 'C', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'good', action: 'nextScrambleCategory', target: 'good', binding: 'Digit3', activation: 'oneshot', enabled: true, armed: true},
			{id: 'great', action: 'nextScrambleCategory', target: 'great', binding: 'Digit4', activation: 'oneshot', enabled: true, armed: true},
			{id: 'insane', action: 'nextScrambleCategory', target: 'insane', binding: '', activation: 'oneshot', enabled: true, armed: true},
			{id: 'jackpot', action: 'nextScrambleCategory', target: 'jackpot', binding: 'Digit5', activation: 'oneshot', enabled: true, armed: true},
			{id: 'specific', action: 'nextSpecificSavedScramble', target: '', binding: '', activation: 'oneshot', enabled: true, armed: true},
			{id: 'persistent', action: 'setPersistentScrambleMode', target: 'great', binding: '', activation: 'toggle', enabled: true, armed: true},
			{id: 'clearNext', action: 'clearNextScrambleOverride', target: '', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'clearAll', action: 'clearAllOneShotOverrides', target: '', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'disable', action: 'disableProductionActions', target: '', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'enable', action: 'enableProductionActions', target: '', binding: '', activation: 'instant', enabled: true, armed: true},
			{id: 'open', action: 'openProductionControl', target: '', binding: '', activation: 'instant', enabled: true, armed: true}
		];
	}
	function defaults() {
		return {
			version: 1,
			keybindsEnabled: false,
			timer: {
				enabled: false,
				speed: {value: 1, random: false, min: 0.8, max: 1},
				startFreeze: {enabled: false, value: 0, random: false, min: 0, max: 0},
				endCut: {enabled: false, value: 0, random: false, min: 0, max: 0},
				drift: {enabled: false, value: 0, random: false, min: 0, max: 0, curve: 'linear'},
				target: {enabled: false, value: 0, expectedDuration: 15, curve: 'smoothstep'},
				randomSeed: ''
			},
			video: {enabled: false, scale: 1},
			scramble: {persistentCategory: 'normal', pendingCategory: '', nextSpecificId: '', saved: [], lastOverride: '', historyWindow: 10},
			openGesture: {logoEnabled: true, logoClicks: 7, logoWindowMs: 3000, shiftEnabled: true, shiftHoldMs: 2000},
			bindings: bindingDefaults()
		};
	}
	function merge(value, fallback) {
		if (!fallback || typeof fallback !== 'object') { return value === undefined ? fallback : value; }
		if ($.isArray(fallback)) { return $.isArray(value) ? value : copy(fallback); }
		var ret = {}, key;
		value = value && typeof value === 'object' ? value : {};
		for (key in fallback) { ret[key] = merge(value[key], fallback[key]); }
		for (key in value) { if (!(key in ret)) { ret[key] = value[key]; } }
		return ret;
	}
	var state = merge(json(CONFIG_KEY, {}), defaults());
	var presets = json(PRESETS_KEY, {});
	if (!presets || typeof presets !== 'object' || $.isArray(presets)) { presets = {}; }

	/* Application time advances at video.scale × wall time. Rebase prevents a
	 * discontinuity when the scale changes while idle. */
	var wallAnchor = wallNow(), appAnchor = wallAnchor;
	function scale() { return state.video.enabled ? clamp(state.video.scale, 1, 0.1, 2) : 1; }
	function now() { return appAnchor + (wallNow() - wallAnchor) * scale(); }
	function rebaseClock() { var current = now(); wallAnchor = wallNow(); appAnchor = current; }
	function wallDuration(appMilliseconds) { return Math.max(0, appMilliseconds / scale()); }
	function appTimeout(callback, appMilliseconds) { return setTimeout(callback, wallDuration(appMilliseconds)); }
	function save() {
		try { localStorage[CONFIG_KEY] = JSON.stringify(state); localStorage[PRESETS_KEY] = JSON.stringify(presets); } catch (err) { DEBUG && console.log('[production] save failed', err); }
	}
	function commit() { rebaseClock(); save(); renderIfOpen(); }

	function randomForTake(seed) {
		var hash = 2166136261, i, text = String(seed || 'production-take');
		for (i = 0; i < text.length; i++) { hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); }
		return function() {
			hash += 0x6D2B79F5;
			var t = hash;
			t = Math.imul(t ^ t >>> 15, t | 1);
			t ^= t + Math.imul(t ^ t >>> 7, t | 61);
			return ((t ^ t >>> 14) >>> 0) / 4294967296;
		};
	}
	function sample(setting, min, max, random) {
		var value = clamp(setting.value, min, min, max);
		if (setting.random) {
			var low = clamp(setting.min, min, min, max), high = clamp(setting.max, value, min, max), tmp;
			if (high < low) { tmp = high; high = low; low = tmp; }
			value = low + (high - low) * random();
		}
		return value;
	}

	/* A solve snapshot is immutable. Configuration changes therefore affect the
	 * next solve rather than making an on-screen solve jump. */
	function beginSolve() {
		var timer = state.timer, enabled = !!timer.enabled, random = randomForTake(timer.randomSeed);
		activeSolve = {
			startedAt: now(), enabled: enabled, videoScale: scale(), randomSeed: timer.randomSeed || '',
			timerSpeed: enabled ? sample(timer.speed, 0.1, 2, random) : 1,
			startFreeze: enabled && timer.startFreeze.enabled ? sample(timer.startFreeze, 0, 10, random) * 1000 : 0,
			endCut: enabled && timer.endCut.enabled ? sample(timer.endCut, 0, 60, random) * 1000 : 0,
			driftAmount: enabled && timer.drift.enabled ? sample(timer.drift, 0, 60, random) * 1000 : 0,
			driftCurve: timer.drift.curve || 'linear',
			targetReduction: enabled && timer.target.enabled ? clamp(timer.target.value, 0, 0, 60) * 1000 : 0,
			targetCurve: timer.target.curve || 'smoothstep',
			expectedDuration: clamp(timer.target.expectedDuration, 15, 1, 300) * 1000
		};
		return copy(activeSolve);
	}
	function curve(name, progress) {
		progress = Math.max(0, Math.min(1, progress));
		if (name === 'ease-in') { return progress * progress; }
		if (name === 'ease-out') { return 1 - Math.pow(1 - progress, 2); }
		if (name === 'smoothstep') { return progress * progress * (3 - 2 * progress); }
		return progress;
	}
	/* Transform order: app elapsed -> freeze -> speed -> drift/target -> end cut
	 * -> finite non-negative millisecond result. */
	function displayElapsed(appElapsed) {
		if (!activeSolve || !activeSolve.enabled) { return Math.max(0, appElapsed); }
		var s = activeSolve, afterFreeze = Math.max(0, appElapsed - s.startFreeze), scaled = afterFreeze * s.timerSpeed;
		var reduction = s.driftAmount * curve(s.driftCurve, afterFreeze / s.expectedDuration);
		reduction += s.targetReduction * curve(s.targetCurve, afterFreeze / s.expectedDuration);
		return Math.max(0, scaled - reduction);
	}
	function finishSolve(appElapsed) {
		var result = displayElapsed(appElapsed);
		if (activeSolve && activeSolve.enabled) { result -= activeSolve.endCut; }
		result = Math.max(0, isFinite(result) ? result : 0);
		if (activeSolve) { lastSolve = copy(activeSolve); }
		activeSolve = null;
		return Math.round(result);
	}
	function cancelSolve() { activeSolve = null; }

	/* Generated at build time by scripts/cfop_scrambles/generate.js. The runtime
	 * only picks a saved record: it never invokes a cube solver. */
	var curatedDatabase = window.PRODUCTION_SCRAMBLES || {version: 1, categories: {}};
	var curated = curatedDatabase.categories || {};
	var categoryNames = ['good', 'great', 'insane', 'jackpot'];
	function is333(type) { return /^(?:333|333oh|333ft|mrbl)$/.test(type || ''); }
	function saved(id) {
		for (var i = 0; i < state.scramble.saved.length; i++) { if (state.scramble.saved[i].id === id) { return state.scramble.saved[i]; } }
	}
	function hasCurated(category) { return !!(curated[category] && curated[category].length); }
	function nextCurated(category) {
		var choices = curated[category], available = [], recent = lastCurated[category] || [], i;
		if (!choices || !choices.length) { return; }
		for (i = 0; i < choices.length; i++) { if (recent.indexOf(choices[i].scramble) < 0) { available.push(choices[i]); } }
		available = available.length ? available : choices;
		var entry = available[Math.floor(Math.random() * available.length)];
		recent.unshift(entry.scramble);
		recent.splice(Math.max(1, Math.round(clamp(state.scramble.historyWindow, 10, 1, 100))));
		lastCurated[category] = recent;
		return entry;
	}
	function armCategory(category) {
		if (['good', 'great', 'insane', 'jackpot'].indexOf(category) < 0) { return; }
		state.scramble.pendingCategory = category;
		state.scramble.nextSpecificId = '';
		state.scramble.lastOverride = category;
		commit();
	}
	function armSpecific(id) {
		if (!saved(id)) { return; }
		state.scramble.nextSpecificId = id;
		state.scramble.pendingCategory = '';
		state.scramble.lastOverride = 'specific';
		commit();
	}
	function clearOverrides() {
		state.scramble.pendingCategory = '';
		state.scramble.nextSpecificId = '';
		state.scramble.lastOverride = '';
		commit();
	}
	/* Priority is specific one-shot, category one-shot, persistent category,
	 * then null which leaves the normal csTimer generator untouched. */
	function requestScramble(type) {
		if (!is333(type)) { return null; }
		var entry;
		if (state.scramble.nextSpecificId) {
			entry = saved(state.scramble.nextSpecificId);
			state.scramble.nextSpecificId = ''; state.scramble.lastOverride = ''; save();
			return entry && entry.scramble || null;
		}
		if (state.scramble.pendingCategory) {
			entry = nextCurated(state.scramble.pendingCategory);
			state.scramble.pendingCategory = ''; state.scramble.lastOverride = ''; save();
			return entry && entry.scramble;
		}
		if (state.scramble.persistentCategory !== 'normal') { entry = nextCurated(state.scramble.persistentCategory); return entry && entry.scramble; }
		return null;
	}
	function requiresManualScrambleAdvance() {
		return !!(state.scramble.nextSpecificId || state.scramble.pendingCategory && hasCurated(state.scramble.pendingCategory) || state.scramble.persistentCategory !== 'normal' && hasCurated(state.scramble.persistentCategory));
	}
	function evaluateScramble(text) {
		var category, i;
		for (category in curated) for (i = 0; i < (curated[category] || []).length; i++) if (curated[category][i].scramble === text) { return copy(curated[category][i]); }
		return {crossMoves: null, classification: 'unrated', crossColor: null, xcrossMoves: null, xxcrossMoves: null, xxxcrossMoves: null, estimatedMoves: $.trim(text || '').split(/\s+/).length};
	}
	function generateScrambleMeetingCriteria(criteria) {
		criteria = criteria || {};
		var categories = ['jackpot', 'insane', 'great', 'good'], minimum = criteria.minimumCategory;
		for (var i = 0; i < categories.length; i++) {
			if ((!minimum || categories.indexOf(categories[i]) <= categories.indexOf(minimum)) && hasCurated(categories[i])) { return copy(nextCurated(categories[i])); }
		}
		return null;
	}

	function keyText(e) {
		var source = e.originalEvent || e;
		var code = source.code || e.code || '';
		if (!code && e.which >= 48 && e.which <= 57) { code = 'Digit' + (e.which - 48); }
		if (!code && e.which >= 65 && e.which <= 90) { code = 'Key' + String.fromCharCode(e.which); }
		if (!code && e.which === 32) { code = 'Space'; }
		if (!code || /^(?:Control|Shift|Alt|Meta)(?:Left|Right)?$/.test(code)) { return ''; }
		var parts = [];
		if (source.ctrlKey) { parts.push('Ctrl'); }
		if (source.altKey) { parts.push('Alt'); }
		if (source.shiftKey) { parts.push('Shift'); }
		parts.push(code);
		return parts.join('+');
	}
	function readable(binding) { return (binding || '').replace(/^Key/, '').replace(/^Digit/, '') || 'Press key…'; }
	function allowed(e) {
		var focus = $(document.activeElement);
		return !kernel.ui.isPop() && !focus.is('input,textarea,select,[contenteditable=true]') && !$(e.target).is('input,textarea,select,[contenteditable=true]');
	}
	function findBinding(id) { for (var i = 0; i < state.bindings.length; i++) if (state.bindings[i].id === id) { return state.bindings[i]; } }
	function loadPreset(name) {
		var preset = presets[name];
		if (!preset) { return false; }
		preset = preset.config || preset;
		state.keybindsEnabled = !!preset.keybindsEnabled;
		state.timer = merge(preset.timer, defaults().timer);
		state.video = merge(preset.video, defaults().video);
		state.scramble = merge(preset.scramble, defaults().scramble);
		state.scramble.pendingCategory = ''; state.scramble.nextSpecificId = '';
		state.bindings = $.isArray(preset.bindings) ? preset.bindings : bindingDefaults();
		state.openGesture = merge(preset.openGesture, defaults().openGesture);
		selectedPreset = name; commit(); return true;
	}
	function run(binding) {
		switch (binding.action) {
		case 'toggleVideoMode': state.video.enabled = !state.video.enabled; commit(); break;
		case 'toggleTimerManipulation': state.timer.enabled = !state.timer.enabled; commit(); break;
		case 'activateTimerPreset': loadPreset(binding.target); break;
		case 'nextScrambleCategory': armCategory(binding.target); break;
		case 'nextSpecificSavedScramble': if (binding.target) { armSpecific(binding.target); } else if (state.scramble.saved.length) { armSpecific(state.scramble.saved[0].id); } break;
		case 'setPersistentScrambleMode': state.scramble.persistentCategory = ['normal', 'good', 'great', 'insane', 'jackpot'].indexOf(binding.target) >= 0 ? binding.target : 'normal'; commit(); break;
		case 'clearNextScrambleOverride': case 'clearAllOneShotOverrides': clearOverrides(); break;
		case 'disableProductionActions': state.keybindsEnabled = false; commit(); break;
		case 'enableProductionActions': state.keybindsEnabled = true; commit(); break;
		case 'openProductionControl': openModal(); break;
		}
	}
	function handleTimerKeydown(e, keyCode, status) {
		if (shiftHeld) { return keyCode === 16 || keyCode === 32; }
		var source = e.originalEvent || e;
		var repeated = !!(e.repeat || source.repeat);
		if (state.openGesture.shiftEnabled && status === -1 && keyCode === 32 && source.shiftKey && !repeated && !kernel.ui.isPop()) {
			shiftHeld = true;
			shiftTid = setTimeout(function() { if (shiftHeld) { shiftTid = 0; openModal(); } }, clamp(state.openGesture.shiftHoldMs, 2000, 500, 10000));
			kernel.clrKey(); return true;
		}
		if (!state.keybindsEnabled || repeated || !allowed(e)) { return false; }
		var key = keyText(e);
		if (!key || key.indexOf('Space') >= 0) { return false; }
		for (var i = 0; i < state.bindings.length; i++) {
			var binding = state.bindings[i];
			if (binding.enabled && binding.armed && binding.binding === key) { run(binding); kernel.clrKey(); return true; }
		}
		return false;
	}
	function handleTimerKeyup(e, keyCode) {
		if (!shiftHeld || (keyCode !== 16 && keyCode !== 32)) { return false; }
		shiftHeld = false;
		if (shiftTid) { clearTimeout(shiftTid); shiftTid = 0; }
		kernel.clrKey(); return true;
	}

	function standardLogo() {
		var about = $('#about'), title = about.children('h1').appendTo(kernel.temp).html();
		about.show(); kernel.showDialog([about, 0, undefined, 0], 'logo', title);
	}
	/* The normal About action is deferred only while checking the secret sequence.
	 * Seven clicks open production controls and never alter any production state. */
	function handleLogoClick() {
		if (!state.openGesture.logoEnabled) { return false; }
		var time = wallNow(), windowMs = clamp(state.openGesture.logoWindowMs, 3000, 500, 10000);
		var required = Math.round(clamp(state.openGesture.logoClicks, 7, 2, 12));
		logoClicks = $.grep(logoClicks, function(value) { return time - value <= windowMs; });
		logoClicks.push(time);
		if (logoTid) { clearTimeout(logoTid); }
		if (logoClicks.length >= required) { logoClicks = []; logoTid = 0; openModal(); }
		else { logoTid = setTimeout(function() { logoTid = 0; if (logoClicks.length && !kernel.ui.isPop()) { logoClicks = []; standardLogo(); } }, windowMs); }
		return true;
	}

	/* Compact csTimer-style production dialog. */
	function row(name, controls) { return $('<div class="production-row">').append($('<strong>').text(name), $('<span class="production-controls">').append(controls)); }
	function text(value, width) { return $('<input type="text">').val(value).css('width', width || '4em'); }
	function check(value, label, callback) { return $('<label class="production-check">').append($('<input type="checkbox">').prop('checked', !!value).change(function() { callback($(this).prop('checked')); }), ' ', label); }
	function field(label, value, callback, width) { return $('<span class="production-field">').append(label, ' ', text(value, width).change(function() { callback($(this).val()); })); }
	function select(value, values, callback) {
		var elem = $('<select>');
		$.each(values, function(_, item) { elem.append($('<option>').val(item[0]).text(item[1])); });
		return elem.val(value).change(function() { callback($(this).val()); });
	}
	function categories() { return [['normal', 'Normal'], ['good', 'Good'], ['great', 'Great'], ['insane', 'Insane'], ['jackpot', 'Jackpot']]; }
	function timerPanel() {
		var t = state.timer, panel = $('<div class="production-panel">');
		panel.append($('<p class="production-help">').text('Values are snapshotted at solve start; changing this panel cannot make a running timer jump.'));
		panel.append(row('Timer manipulation', check(t.enabled, 'Enabled', function(v) { t.enabled = v; commit(); })));
		panel.append(row('Speed', [field('x', t.speed.value, function(v) { t.speed.value = clamp(v, 1, .1, 2); commit(); }), check(t.speed.random, 'random', function(v) { t.speed.random = v; commit(); }), field('min', t.speed.min, function(v) { t.speed.min = clamp(v, .1, .1, 2); commit(); }), field('max', t.speed.max, function(v) { t.speed.max = clamp(v, 1, .1, 2); commit(); })]));
		function rangeRow(name, setting, maximum) {
			return row(name, [check(setting.enabled, 'enabled', function(v) { setting.enabled = v; commit(); }), field('seconds', setting.value, function(v) { setting.value = clamp(v, 0, 0, maximum); commit(); }), check(setting.random, 'random', function(v) { setting.random = v; commit(); }), field('min', setting.min, function(v) { setting.min = clamp(v, 0, 0, maximum); commit(); }), field('max', setting.max, function(v) { setting.max = clamp(v, 0, 0, maximum); commit(); })]);
		}
		panel.append(rangeRow('Start freeze', t.startFreeze, 10));
		panel.append(rangeRow('End cut', t.endCut, 60));
		panel.append(row('Gradual drift', [check(t.drift.enabled, 'enabled', function(v) { t.drift.enabled = v; commit(); }), field('seconds', t.drift.value, function(v) { t.drift.value = clamp(v, 0, 0, 60); commit(); }), check(t.drift.random, 'random', function(v) { t.drift.random = v; commit(); }), select(t.drift.curve, [['linear', 'linear'], ['ease-in', 'ease-in'], ['ease-out', 'ease-out'], ['smoothstep', 'smoothstep']], function(v) { t.drift.curve = v; commit(); })]));
		panel.append(row('Drift range', [field('min', t.drift.min, function(v) { t.drift.min = clamp(v, 0, 0, 60); commit(); }), field('max', t.drift.max, function(v) { t.drift.max = clamp(v, 0, 0, 60); commit(); })]));
		panel.append(row('Target reduction', [check(t.target.enabled, 'enabled', function(v) { t.target.enabled = v; commit(); }), field('seconds', t.target.value, function(v) { t.target.value = clamp(v, 0, 0, 60); commit(); }), field('expected solve', t.target.expectedDuration, function(v) { t.target.expectedDuration = clamp(v, 15, 1, 300); commit(); }), select(t.target.curve, [['linear', 'linear'], ['ease-in', 'ease-in'], ['ease-out', 'ease-out'], ['smoothstep', 'smoothstep']], function(v) { t.target.curve = v; commit(); })]));
		panel.append(row('Fixed random seed', text(t.randomSeed, '12em').attr('placeholder', 'optional').change(function() { t.randomSeed = $(this).val(); commit(); })));
		return panel;
	}
	function videoPanel() {
		var v = state.video, panel = $('<div class="production-panel">'), quick = $('<span class="production-presets">').append('Quick: ');
		panel.append($('<p class="production-help">').text('Application time is separate from the timer transform. Scale 0.50 requires 2.00× playback correction.'));
		panel.append(row('Video mode', check(v.enabled, 'Enabled', function(x) { v.enabled = x; commit(); })));
		panel.append(row('Application scale', field('x', v.scale, function(x) { v.scale = clamp(x, 1, .1, 2); commit(); }, '5em')));
		$.each([1, .75, .5, .4, .33], function(_, x) { quick.append($('<input type="button">').val(x.toFixed(2) + 'x').click(function() { v.scale = x; commit(); })); });
		panel.append(row('Convenience', quick));
		panel.append(row('Playback correction', $('<strong>').text((1 / scale()).toFixed(3) + 'x')));
		panel.append($('<p class="production-help">').text('Hold-to-green, inspection, timer text, voice thresholds, logo animation, and core csTimer dialog/window transitions use this scale.'));
		return panel;
	}
	function scramblePanel() {
		var s = state.scramble, panel = $('<div class="production-panel">'), oneShot = $('<select>'), savedPick = $('<select>');
		panel.append($('<p class="production-help">').text('Arming changes nothing on screen. The current scramble remains until the next manual 3×3 scramble request.'));
		panel.append(row('Persistent category', select(s.persistentCategory, categories(), function(v) { s.persistentCategory = v; commit(); })));
		$.each(categories().slice(1), function(_, item) { oneShot.append($('<option>').val(item[0]).text(item[1])); });
		panel.append(row('One-shot category', [oneShot, ' ', $('<input type="button">').val('Arm next').click(function() { armCategory(oneShot.val()); })]));
		savedPick.append($('<option>').val('').text('Saved scramble…'));
		$.each(s.saved, function(_, item) { savedPick.append($('<option>').val(item.id).text(item.name)); });
		panel.append(row('Specific saved', [savedPick, ' ', $('<input type="button">').val('Arm next').click(function() { armSpecific(savedPick.val()); })]));
		var name = text('', '10em').attr('placeholder', 'Take name'), moves = $('<textarea rows="2" class="production-scramble-input" placeholder="R U R\' U\' …"></textarea>');
		panel.append(row('Save scramble', [name, ' ', $('<input type="button">').val('Save').click(function() {
			var raw = $.trim(moves.val()); if (!raw) { return; }
			s.saved.push({id: 'saved-' + Date.now() + '-' + Math.floor(Math.random() * 10000), name: $.trim(name.val()) || 'Saved scramble', scramble: raw, metadata: {}}); commit();
		}), $('<br>'), moves]));
		if (s.saved.length) {
			var list = $('<div class="production-saved-list">');
			$.each(s.saved, function(_, item) { list.append($('<div>').append($('<span>').text(item.name + ': ' + item.scramble), ' ', $('<span class="click">').text('remove').click(function() { s.saved = $.grep(s.saved, function(candidate) { return candidate.id !== item.id; }); commit(); }))); });
			panel.append(row('Saved archive', list));
		}
		var archive = $('<table class="production-archive">').append('<tr><th>Category</th><th>Verified scrambles</th><th>Exact requirement</th></tr>');
		var requirements = {good: 'Cross', great: 'XCross', insane: 'XXCross', jackpot: 'XXXCross+'};
		$.each(categoryNames, function(_, cat) { archive.append($('<tr>').append($('<td>').text(cat), $('<td>').text((curated[cat] || []).length), $('<td>').text(requirements[cat]))); });
		panel.append(row('Generated database', archive));
		panel.append(row('Database build', $('<span>').text(curatedDatabase.generatedAt ? curatedDatabase.generatedAt : 'No generated records loaded')));
		panel.append(row('Next override', $('<strong>').text(s.nextSpecificId ? 'Specific saved scramble' : (s.pendingCategory || 'None'))));
		return panel;
	}
	var actionLabels = {toggleVideoMode: 'Toggle video mode', toggleTimerManipulation: 'Toggle timer manipulation', activateTimerPreset: 'Activate timer preset', nextScrambleCategory: 'Next scramble category', nextSpecificSavedScramble: 'Next specific saved scramble', setPersistentScrambleMode: 'Set persistent scramble mode', clearNextScrambleOverride: 'Clear next override', clearAllOneShotOverrides: 'Clear all one-shots', disableProductionActions: 'Disable production actions', enableProductionActions: 'Enable production actions', openProductionControl: 'Open production controls'};
	function capture(binding) {
		captureId = binding.id; renderIfOpen();
		$(document).off('keydown.productionCapture').on('keydown.productionCapture', function(e) {
			if (!captureId) { return; }
			var result = keyText(e); if (!result || result.indexOf('Space') >= 0) { return; }
			var target = findBinding(captureId); if (target) { target.binding = result; commit(); }
			captureId = null; $(document).off('keydown.productionCapture'); e.preventDefault(); e.stopImmediatePropagation();
		});
	}
	function keybindPanel() {
		var panel = $('<div class="production-panel">'), table = $('<table class="production-bindings">').append('<tr><th>Action</th><th>Target</th><th>Binding</th><th>Mode</th><th>On</th><th>Armed</th></tr>');
		panel.append(row('Production keybinds', check(state.keybindsEnabled, 'Enabled', function(v) { state.keybindsEnabled = v; commit(); })));
		panel.append($('<p class="production-help">').text('Hotkeys do nothing while typing, editing a binding, unarmed, or with the master switch off. Space is never bindable.'));
		$.each(state.bindings, function(_, b) {
			var target = text(b.target || '', '4em').change(function() { b.target = $(this).val(); commit(); });
			var bind = $('<input type="button">').val(captureId === b.id ? 'Press key…' : readable(b.binding)).click(function() { capture(b); });
			var mode = select(b.activation || 'instant', [['always', 'always'], ['toggle', 'toggle'], ['oneshot', 'one-shot'], ['instant', 'instant']], function(v) { b.activation = v; commit(); });
			table.append($('<tr>').append($('<td>').text(actionLabels[b.action] || b.action), $('<td>').append(target), $('<td>').append(bind, ' ', $('<span class="click production-clear-binding">').text('×').click(function() { b.binding = ''; commit(); })), $('<td>').append(mode), $('<td>').append($('<input type="checkbox">').prop('checked', !!b.enabled).change(function() { b.enabled = $(this).prop('checked'); commit(); })), $('<td>').append($('<input type="checkbox">').prop('checked', !!b.armed).change(function() { b.armed = $(this).prop('checked'); commit(); }))));
		});
		panel.append(table, $('<h4>').text('Opening gestures'));
		var g = state.openGesture;
		panel.append(row('Logo gesture', [check(g.logoEnabled, 'enabled', function(v) { g.logoEnabled = v; commit(); }), field('clicks', g.logoClicks, function(v) { g.logoClicks = Math.round(clamp(v, 7, 2, 12)); commit(); }), field('window ms', g.logoWindowMs, function(v) { g.logoWindowMs = clamp(v, 3000, 500, 10000); commit(); })]));
		panel.append(row('Shift + Space', [check(g.shiftEnabled, 'enabled', function(v) { g.shiftEnabled = v; commit(); }), field('hold ms', g.shiftHoldMs, function(v) { g.shiftHoldMs = clamp(v, 2000, 500, 10000); commit(); })]));
		return panel;
	}
	function presetPayload() { return {version: 1, keybindsEnabled: state.keybindsEnabled, timer: copy(state.timer), video: copy(state.video), scramble: {persistentCategory: state.scramble.persistentCategory, saved: copy(state.scramble.saved)}, bindings: copy(state.bindings), openGesture: copy(state.openGesture)}; }
	function download(name, value) {
		var blob = new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}), link = $('<a>').attr({href: URL.createObjectURL(blob), download: name}).appendTo('body');
		link[0].click(); setTimeout(function() { URL.revokeObjectURL(link.attr('href')); link.remove(); }, 0);
	}
	function presetsPanel() {
		var panel = $('<div class="production-panel">'), pick = $('<select>').append($('<option>').val('').text('Select preset…'));
		$.each(Object.keys(presets).sort(), function(_, name) { pick.append($('<option>').val(name).text(name)); });
		pick.val(selectedPreset).change(function() { selectedPreset = $(this).val(); });
		panel.append(row('Preset', pick));
		var buttons = $('<span class="production-presets">');
		function savePreset(name) { if (name) { presets[name] = {name: name, updatedAt: new Date().toISOString(), config: presetPayload()}; selectedPreset = name; commit(); } }
		buttons.append($('<input type="button">').val('New').click(function() { var name = window.prompt('Preset name'); if (name) { savePreset($.trim(name)); } }));
		buttons.append($('<input type="button">').val('Save').click(function() { savePreset(selectedPreset); }));
		buttons.append($('<input type="button">').val('Load').click(function() { if (pick.val()) { loadPreset(pick.val()); } }));
		buttons.append($('<input type="button">').val('Rename').click(function() { var name = selectedPreset && window.prompt('New preset name', selectedPreset); if (name && $.trim(name)) { presets[$.trim(name)] = presets[selectedPreset]; delete presets[selectedPreset]; selectedPreset = $.trim(name); commit(); } }));
		buttons.append($('<input type="button">').val('Duplicate').click(function() { var name = selectedPreset && window.prompt('Duplicate as', selectedPreset + ' copy'); if (name && $.trim(name)) { presets[$.trim(name)] = copy(presets[selectedPreset]); selectedPreset = $.trim(name); commit(); } }));
		buttons.append($('<input type="button">').val('Delete').click(function() { if (selectedPreset && presets[selectedPreset] && window.confirm('Delete preset "' + selectedPreset + '"?')) { delete presets[selectedPreset]; selectedPreset = ''; commit(); } }));
		buttons.append($('<input type="button">').val('Export JSON').click(function() { download('cstimer-production-presets.json', {schema: 1, presets: presets}); }));
		var file = $('<input type="file" accept="application/json" style="display:none">').change(function() {
			var selected = this.files && this.files[0]; if (!selected) { return; }
			var reader = new FileReader(); reader.onload = function() { try { var data = JSON.parse(reader.result), imported = data.presets || data; if (!imported || typeof imported !== 'object') { throw new Error('invalid'); } $.each(imported, function(name, preset) { if (preset && typeof preset === 'object') { presets[name] = preset; } }); commit(); } catch (err) { alert('Could not import production presets.'); } }; reader.readAsText(selected);
		});
		buttons.append($('<input type="button">').val('Import JSON').click(function() { file.click(); }), file);
		panel.append(row('Operations', buttons));
		panel.append($('<p class="production-help">').text('Presets configure the environment only. They never start, stop, solve, or advance a scramble.'));
		return panel;
	}
	function statusPanel() {
		var rows = [['Build', 'Production Fork'], ['Production keybinds', state.keybindsEnabled ? 'ON' : 'OFF'], ['Timer manipulation', state.timer.enabled ? 'ON' : 'OFF'], ['Current timer profile', selectedPreset || 'Manual'], ['Video mode', state.video.enabled ? scale().toFixed(2) + 'x' : 'OFF'], ['Required playback', (1 / scale()).toFixed(3) + 'x'], ['Persistent scramble', state.scramble.persistentCategory], ['Next scramble override', state.scramble.nextSpecificId ? 'Specific saved scramble' : (state.scramble.pendingCategory || 'None')], ['Transformation order', 'app → freeze → speed → drift/target → end cut → clamp']];
		if (activeSolve) { rows.push(['Sampled timer speed', activeSolve.timerSpeed.toFixed(3) + 'x'], ['Sampled start freeze', (activeSolve.startFreeze / 1000).toFixed(2) + ' sec'], ['Sampled end cut', (activeSolve.endCut / 1000).toFixed(2) + ' sec'], ['Sampled drift', (activeSolve.driftAmount / 1000).toFixed(2) + ' sec']); }
		else { rows.push(['Solve snapshot', 'No active solve']); }
		var panel = $('<div class="production-panel">'), table = $('<table class="production-status-table">');
		$.each(rows, function(_, rowData) { table.append($('<tr>').append($('<th>').text(rowData[0]), $('<td>').text(rowData[1]))); });
		return panel.append(table);
	}
	function renderPanel() {
		if (!content) { return; }
		content.empty();
		if (selectedTab === 'scramble') { content.append(scramblePanel()); }
		else if (selectedTab === 'video') { content.append(videoPanel()); }
		else if (selectedTab === 'keybinds') { content.append(keybindPanel()); }
		else if (selectedTab === 'presets') { content.append(presetsPanel()); }
		else if (selectedTab === 'status') { content.append(statusPanel()); }
		else { content.append(timerPanel()); }
		tabs.children().each(function() { $(this).toggleClass('enable', $(this).data('tab') === selectedTab); });
	}
	function initModal() {
		if (modal) { return; }
		modal = $('<div class="production-modal">'); tabs = $('<div class="production-tabs">'); content = $('<div class="production-tab-content">');
		$.each([['timer', 'Timer'], ['scramble', 'Scramble'], ['video', 'Video'], ['keybinds', 'Keybinds'], ['presets', 'Presets'], ['status', 'Status']], function(_, item) { tabs.append($('<span class="tab">').text(item[1]).data('tab', item[0]).click(function() { selectedTab = $(this).data('tab'); renderPanel(); })); });
		modal.append(tabs, content);
	}
	function idle() { return !window.timer || window.timer.status() === -1; }
	function openModal() {
		if (!idle() || kernel.ui.isPop()) { return false; }
		initModal(); renderPanel(); kernel.showDialog([modal, $.noop, undefined, $.noop], 'production', 'Production Controls'); return true;
	}
	function renderIfOpen() { if (kernel.ui.isPop() && modal && modal.parent().length) { renderPanel(); } }
	$(function() { initModal(); kernel.regListener('production', 'timerStatus', renderIfOpen); });

	return {
		wallNow: wallNow, now: now, getScale: scale, wallDuration: wallDuration, setTimeout: appTimeout,
		beginSolve: beginSolve, displayElapsed: displayElapsed, finishSolve: finishSolve, cancelSolve: cancelSolve,
		getActiveSolve: function() { return activeSolve && copy(activeSolve); }, getLastSolve: function() { return lastSolve && copy(lastSolve); },
		requestScramble: requestScramble, requiresManualScrambleAdvance: requiresManualScrambleAdvance, armCategory: armCategory, armSpecific: armSpecific, clearOverrides: clearOverrides,
		evaluateScramble: evaluateScramble, generateScrambleMeetingCriteria: generateScrambleMeetingCriteria, getCuratedScrambles: function() { return copy(curated); },
		handleTimerKeydown: handleTimerKeydown, handleTimerKeyup: handleTimerKeyup, handleLogoClick: handleLogoClick, open: openModal,
		getState: function() { return copy(state); }, loadPreset: loadPreset
	};
});
