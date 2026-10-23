/* 把 toku-raw.json 转成引擎可用的紧凑数据包 */
const fs = require('fs');
const raw = require('./out/toku-raw.json');

const all = [...raw.CHARS, ...raw.NEW_CHARS];

function group(style) {
  if (!style) return '其他';
  if (style.startsWith('奥特曼')) return '奥特曼';
  if (style.startsWith('假面骑士')) return '假面骑士';
  if (style.startsWith('战队')) return '战队';
  if (style.startsWith('漫威')) return '漫威';
  if (style.startsWith('DC')) return 'DC';
  if (style.startsWith('动漫')) return '动漫';
  if (style.startsWith('游戏')) return '游戏';
  if (style.startsWith('西方')) return '西方';
  if (style.startsWith('中国')) return '中国';
  if (style.startsWith('Ben 10')) return 'Ben 10';
  return '其他';
}

const seen = new Set();
const chars = [];
for (const c of all) {
  if (!c || !c.id || seen.has(c.id)) continue;
  seen.add(c.id);
  const col = c.colors || {};
  chars.push({
    id: c.id,
    name: c.name || c.id,
    style: c.style || '其他',
    group: group(c.style),
    desc: (c.desc || '').slice(0, 80),
    colors: [
      col.main || '#888888',
      col.dark || '#333333',
      col.fore || '#cccccc',
      col.accent || '#ffd166',
      col.glow || col.accent || '#ffffff',
      col.eye || '#ffffff'
    ],
    hp: c.hp || 100,
    speed: c.speed || 255,
    jump: c.jumpV || 950,
    power: c.power || 3,
    tech: c.tech || 3,
    agi: c.agility || 3,
    pAtk: c.pAtk ? [c.pAtk.name || '气弹', c.pAtk.dmg || 4, c.pAtk.ptype || 'orb', c.pAtk.col || '#ffffff'] : null,
    special: c.special ? [c.special.name || '必杀', c.special.type || 'beam', c.special.dmg || 25] : null,
    small: c.small ? [c.small.name || '特技', c.small.type || 'slash', c.small.dmg || 9] : null,
    skill2: c.skill2 ? [c.skill2.name || '技二', c.skill2.type || 'slash', c.skill2.dmg || 11] : null,
    head: c.head || 'ultra',
    scarf: c.scarf || null,
    taunt: c.taunt || null
  });
}

const stages = raw.STAGES.map(s => ({
  id: s.id,
  name: s.name,
  sub: s.sub || '',
  sky: s.sky || ['#0a1020', '#152238', '#2a3a52'],
  far: s.far || '#0c1620',
  near: s.near || '#081018',
  ground: s.ground || ['#141c28', '#0c1118', '#05080c'],
  plat: s.platCol ? s.platCol[0] : '#1c2840',
  edge: s.platEdge || '#4a6ad8',
  moon: s.moon || null
}));

const body = chars.map(c => '    ' + JSON.stringify(c)).join(',\n');
const sbody = stages.map(s => '    ' + JSON.stringify(s)).join(',\n');

const out = `/* ==========================================================
   TOKUSATSU HERO BRAWL — 数据包（自动生成，请勿手改）
   ----------------------------------------------------------
   来源：D:/tokugame/repo/tokugame-v38-marvis.html
   生成：tools/gen-pack.js  →  node tools/gen-pack.js

   包含 ${chars.length} 名角色 + ${stages.length} 张战场。
   这里只保留"原项目的数据"，如何变成引擎角色由 src/data/packs.js 决定。
   ========================================================== */
(function () {
  'use strict';
  window.TOKU_PACK = {
    meta: {
      id: 'toku',
      name: '特摄英雄大乱斗',
      version: 'v38',
      author: 'laihainb666',
      repo: 'https://github.com/laihainb666/tokugame',
      count: ${chars.length},
      stageCount: ${stages.length}
    },
    chars: [
${body}
    ],
    stages: [
${sbody}
    ]
  };
})();
`;

fs.writeFileSync('src/data/toku-pack.js', out);
console.log('角色', chars.length, '战场', stages.length);
console.log('文件大小', (fs.statSync('src/data/toku-pack.js').size / 1024).toFixed(0) + 'KB');

const g = {};
chars.forEach(c => g[c.group] = (g[c.group] || 0) + 1);
console.log('分组:', JSON.stringify(g));
