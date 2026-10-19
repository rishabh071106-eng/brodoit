// The five Mind games, in library order. Each module exports { meta, levelConfig(n), start(host, cfg, api) }.
import * as memory from './memory.js';
import * as clash from './clash.js';
import * as hunt from './hunt.js';
import * as math from './math.js';
import * as words from './words.js';

export const GAMES = [memory, clash, hunt, math, words];
export const byId = id => GAMES.find(g => g.meta.id === id) || null;
// The skill each game trains, in the order Elevate-style performance bars are shown.
export const SKILLS = ['Memory', 'Focus', 'Speed', 'Math', 'Language'];
export const SKILL_ICON = { Memory: 'brain', Focus: 'target', Speed: 'zap', Math: 'hash', Language: 'languages' };
