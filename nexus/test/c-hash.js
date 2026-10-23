const CK = require('../src/kernel/c-kernel.js');
const seed = 12345, frames = 900;
const k = new CK(seed);
let h60 = 0;
for (let i = 0; i < frames; i++) {
  k.step();
  if (k.frame === 60) h60 = k.hash;
  if (k.winner >= 0) break;
}
const hex = n => n.toString(16).toUpperCase().padStart(8, '0');
console.log('frames =', k.frame);
console.log('winner =', k.winner);
console.log('hp     =', k.f[0].health, '/', k.f[1].health);
console.log('combo  =', k.f[0].combo, '/', k.f[1].combo);
console.log('replay =', k.replayLen);
console.log('hash@60=', hex(h60));
console.log('FINAL  =', hex(k.hash));
