/* ==========================================================
   Characters — 角色预制体
   ----------------------------------------------------------
   一个角色 = 一组数值 + 一组招式数据 + 一套配色 + 一个 tag 协战配置。
   引擎不含任何"某角色专属逻辑"，所以模组注册一个新角色就能直接开打。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const D = FE.moves.derive;

  /* 通用招式打包：每个角色都从这 8 招起手，再各自加必杀 */
  function baseKit(o) {
    o = o || {};
    return [
      D('light', Object.assign({ id: 'light', name: o.lightName || '轻击' }, o.light || {})),
      D('heavy', Object.assign({ id: 'heavy', name: o.heavyName || '重击' }, o.heavy || {})),
      D('kick', Object.assign({ id: 'kick', name: o.kickName || '中踢' }, o.kick || {})),
      D('crouch_light', Object.assign({ id: 'crouch_light', name: '蹲轻' }, o.cl || {})),
      D('sweep', Object.assign({ id: 'sweep', name: o.sweepName || '扫腿' }, o.sweep || {})),
      D('uppercut', Object.assign({ id: 'uppercut', name: o.dpName || '升击' }, o.dp || {})),
      D('air_light', Object.assign({ id: 'air_light', name: '空轻' }, o.al || {})),
      D('air_heavy', Object.assign({ id: 'air_heavy', name: '空重' }, o.ah || {})),
      D('throw', Object.assign({ id: 'throw', name: o.throwName || '投技' }, o.throw || {}))
    ];
  }

  /* ---------------------------------------------------------
     1) 焰 FLAME — 突进型 / 空中连段 / 火属性
     --------------------------------------------------------- */
  FE.characters.register('flame', {
    name: '焰', title: 'FLAME', archetype: '突进 / 空连',
    avatar: '焰',
    desc: '速度最快，空连收益极高，贴身压制型角色。',
    /* 全后端适配 */
    adapters: ['3d', '25d', 'data', 'c', 'pixel', 'ink', 'neon', 'toon', 'hyper'],
    palette: {
      main: '#ff5a3c', dark: '#b02a18', light: '#ffa07a',
      accent: '#ffd23d', skin: '#f0b48c', hair: '#2b1a14',
      gi: '#e8432a', belt: '#1b1b1b', aura: '#ff7a2e'
    },
    stats: {
      health: 1.0, walk: 1.12, dash: 1.15, jump: 1.08,
      weight: 0.9, gravity: 1.0, meterGain: 1.15
    },
    moves: baseKit({
      lightName: '炎拳', heavyName: '烈冲拳', kickName: '旋风腿',
      dpName: '昇龙炎'
    }).concat([
      D('fireball', {
        id: 'fireball', name: '火球术', damage: 0,
        anim: 'cast', fx: 'fire',
        projectile: {
          speed: 10.5, damage: 58, hitstun: 20, blockstun: 12, hitstop: 7,
          w: 38, h: 34, life: 120, kb: { x: 3, y: 1.4 }, fx: 'fire', element: 'fire'
        },
        desc: '高速火球，压制起身'
      }),
      D('rush', {
        id: 'rush', name: '疾风突', damage: 84, self: { x: 11, y: 0 },
        anim: 'rush', fx: 'fire', element: 'fire',
        desc: '长距离突进，命中后可在空中追打'
      }),
      D('super', {
        id: 'super', name: '烈焰连舞', damage: 262, anim: 'super', fx: 'super',
        element: 'fire', hits: 6, hitInterval: 4,
        desc: '多段乱舞，最后一段击飞'
      })
    ]),
    tag: { assist: 'uppercut', switchIn: 'rush', call: '昇龙炎' },
    quote: '烧尽一切。'
  });

  /* ---------------------------------------------------------
     2) 霜 FROST — 立回型 / 长手 / 冰属性
     --------------------------------------------------------- */
  FE.characters.register('frost', {
    name: '霜', title: 'FROST', archetype: '立回 / 牵制',
    avatar: '霜',
    desc: '攻击距离最长，靠冰刃与反击控制节奏。',
    /* 未做像素 / 霓虹适配 —— 切到这两个后端会自动降级 */
    adapters: ['3d', '25d', 'data', 'c', 'ink', 'toon', 'hyper'],
    palette: {
      main: '#4d8dff', dark: '#254a9e', light: '#a8c8ff',
      accent: '#8ef0ff', skin: '#efd9c8', hair: '#dff3ff',
      gi: '#2f5fc4', belt: '#0d1a33', aura: '#5fd8ff'
    },
    stats: {
      health: 0.95, walk: 0.96, dash: 0.95, jump: 1.0,
      weight: 1.0, gravity: 1.0, meterGain: 1.0
    },
    moves: baseKit({
      lightName: '霜刺', heavyName: '冰槌', kickName: '踏雪',
      dpName: '冰柱昇'
    }).concat([
      D('fireball', {
        id: 'ice_shard', name: '冰刃', damage: 0,
        startup: 10, recovery: 20, anim: 'cast', fx: 'ice',
        meterGain: 10,
        projectile: {
          speed: 7.2, damage: 66, hitstun: 24, blockstun: 14, hitstop: 6,
          w: 44, h: 22, life: 130, kb: { x: 2.4, y: 0.8 }, fx: 'ice', element: 'ice',
          slow: { mul: 0.55, frames: 42 }
        },
        desc: '命中后减速对手'
      }),
      D('rush', {
        id: 'ice_step', name: '冰踏', damage: 76,
        self: { x: 8, y: 0 }, anim: 'rush', fx: 'ice', element: 'ice',
        desc: '位移较短但收招更快'
      }),
      D('super', {
        id: 'super', name: '绝对零度', damage: 236, anim: 'super', fx: 'super',
        element: 'ice', hits: 4, hitInterval: 6,
        desc: '冻结对手后全力一击'
      })
    ]),
    tag: { assist: 'fireball', switchIn: 'ice_step', call: '冰刃' },
    quote: '冷静，是唯一的武器。'
  });

  /* ---------------------------------------------------------
     3) 岩 ROCK — 投技型 / 高耐久 / 霸体
     --------------------------------------------------------- */
  FE.characters.register('rock', {
    name: '岩', title: 'ROCK', archetype: '投技 / 重装',
    avatar: '岩',
    desc: '移动缓慢但单发伤害恐怖，必杀带霸体。',
    /* 未做水墨 / 赛璐璐适配 */
    adapters: ['3d', '25d', 'data', 'c', 'pixel', 'neon', 'hyper'],
    palette: {
      main: '#c88a3d', dark: '#7a4c1a', light: '#e8c48a',
      accent: '#ffd75e', skin: '#c98d5f', hair: '#2a1a0e',
      gi: '#8a5a24', belt: '#3a2410', aura: '#ffb02e'
    },
    stats: {
      health: 1.22, walk: 0.84, dash: 0.86, jump: 0.92,
      weight: 1.35, gravity: 1.12, meterGain: 0.9
    },
    moves: baseKit({
      lightName: '铁肘', heavyName: '碎岩拳', kickName: '地裂腿',
      dpName: '岩柱昇'
    }).concat([
      D('fireball', {
        id: 'rock_shot', name: '岩弹', damage: 0,
        startup: 16, recovery: 26, anim: 'cast', fx: 'rock', meterGain: 14,
        projectile: {
          speed: 5.4, damage: 82, hitstun: 22, blockstun: 16, hitstop: 9,
          w: 50, h: 44, life: 110, kb: { x: 4.2, y: 1 }, fx: 'rock', element: 'earth'
        },
        desc: '慢速高伤投射'
      }),
      D('rush', {
        id: 'tackle', name: '冲撞', damage: 104, armor: 1,
        self: { x: 7, y: 0 }, anim: 'rush', fx: 'rock', element: 'earth',
        desc: '带 1 次霸体，可硬吃一下反击'
      }),
      D('super', {
        id: 'super', name: '大地崩裂', damage: 288, anim: 'super', fx: 'super',
        element: 'earth', hits: 3, hitInterval: 8, startup: 12,
        desc: '起手慢但伤害最高'
      })
    ]),
    tag: { assist: 'tackle', switchIn: 'tackle', call: '冲撞' },
    quote: '山不会让路。'
  });

  /* 角色选择顺序 */
  FE.charOrder = ['flame', 'frost', 'rock'];
})();
