// play.html?g=<game>&l=<level>[&w=1] — validates the level (locked → the current level) and hands over to the engine.
import { GAMES, byId } from './games/index.js';
import * as store from './store.js';
import { play } from './engine.js';
import { unlockAudio } from './util.js';

unlockAudio();
const q = new URLSearchParams(location.search);
const mod = byId(q.get('g'));
if (!mod) location.replace('/mind/');
else {
  const p = store.read();
  let level = parseInt(q.get('l'), 10);
  if (!(level >= 1 && level <= store.LEVELS)) level = store.current(p, mod.meta.id);
  const workout = q.get('w') === '1';
  // a locked level (old link, shared URL) goes to the level path with a toast instead of silently playing another level
  if (!store.isOpen(p, mod.meta.id, level) && !workout) location.replace(`/mind/game.html?g=${mod.meta.id}&locked=1`);
  else {
    if (!store.isOpen(p, mod.meta.id, level)) level = store.current(p, mod.meta.id);
    play({ mod, level, workout, games: GAMES });
  }
}
