/* ==========================================================
   Packs — 内容包：把外部项目的数据转成引擎角色
   ----------------------------------------------------------
   数据包（toku-pack.js）只保存"原项目的数据"。
   这个文件负责翻译：
     原字段             → 引擎字段
     colors.main        → palette.main
     hp / speed / jumpV → stats.health / walk / jump
     pAtk               → 飞行道具招式（236 + 特殊）
     small              → 突进技（214 + 特殊）
     skill2             → 第二必杀（623 + 特殊）
     special            → 超必杀（236 + 超必）
     head               → look（发型/体型/围巾）

   这样原项目 326 个角色一个不少地进入引擎，而且**每个都能打**，
   不需要为任何一个单独写代码。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  /* 头部类型 → 外观 */
  const HEAD_LOOK = {
    ultra:    { hair: 'short', build: 1.14, height: 1.08, scarf: false, glow: 0.78 },
    tiga:     { hair: 'short', build: 1.12, height: 1.06, scarf: false, glow: 0.70 },
    legend:   { hair: 'short', build: 1.15, height: 1.08, scarf: false, glow: 0.90 },
    noa:      { hair: 'short', build: 1.13, height: 1.07, scarf: false, glow: 0.85 },
    saga:     { hair: 'short', build: 1.16, height: 1.09, scarf: false, glow: 0.92 },
    king:     { hair: 'short', build: 1.20, height: 1.10, scarf: false, glow: 0.88 },
    ohma:     { hair: 'short', build: 1.10, height: 1.06, scarf: true,  glow: 0.95 },
    dark:     { hair: 'short', build: 1.12, height: 1.06, scarf: false, glow: 0.90 },
    belial:   { hair: 'short', build: 1.14, height: 1.07, scarf: false, glow: 0.92 },
    rider:    { hair: 'short', build: 1.00, height: 1.00, scarf: true,  glow: 0.55 },
    kabuto:   { hair: 'short', build: 1.02, height: 1.02, scarf: true,  glow: 0.55 },
    sentai:   { hair: 'spiky', build: 1.00, height: 1.00, scarf: true,  glow: 0.50 },
    kunoichi: { hair: 'long',  build: 0.92, height: 1.00, scarf: true,  glow: 0.45 },
    kaiju:    { hair: 'bald',  build: 1.34, height: 1.13, scarf: false, glow: 0.40 },
    bee:      { hair: 'bald',  build: 1.20, height: 1.05, scarf: false, glow: 0.40 },
    robot:    { hair: 'bald',  build: 1.24, height: 1.06, scarf: false, glow: 0.62 },
    alien:    { hair: 'hood',  build: 1.08, height: 1.04, scarf: false, glow: 0.60 },
    thor:     { hair: 'long',  build: 1.16, height: 1.04, scarf: true,  glow: 0.65 },
    ironman:  { hair: 'short', build: 1.06, height: 1.02, scarf: false, glow: 0.80 },
    hulk:     { hair: 'short', build: 1.42, height: 1.16, scarf: false, glow: 0.35 },
    goku:     { hair: 'spiky', build: 1.02, height: 1.00, scarf: false, glow: 0.85 },
    naruto:   { hair: 'spiky', build: 1.00, height: 1.00, scarf: false, glow: 0.70 },
    luffy:    { hair: 'short', build: 1.00, height: 1.00, scarf: false, glow: 0.55 },
    saitama:  { hair: 'bald',  build: 1.04, height: 1.02, scarf: false, glow: 0.30 },
    eren:     { hair: 'short', build: 1.02, height: 1.02, scarf: false, glow: 0.40 },
    doraemon: { hair: 'bald',  build: 1.10, height: 0.90, scarf: false, glow: 0.35 },
    tanjiro:  { hair: 'short', build: 1.00, height: 1.00, scarf: true,  glow: 0.50 },
    spiderman:{ hair: 'short', build: 0.98, height: 1.00, scarf: false, glow: 0.55 },
    pikachu:  { hair: 'spiky', build: 0.86, height: 0.82, scarf: false, glow: 0.75 },
    zoro:     { hair: 'short', build: 1.04, height: 1.02, scarf: true,  glow: 0.45 },
    sasuke:   { hair: 'spiky', build: 1.00, height: 1.00, scarf: false, glow: 0.65 },
    ben10:    { hair: 'short', build: 0.98, height: 0.98, scarf: false, glow: 0.55 },
    godzilla: { hair: 'bald',  build: 1.40, height: 1.18, scarf: false, glow: 0.45 },
    gen:      { hair: 'short', build: 1.02, height: 1.00, scarf: false, glow: 0.45 },
    sans:     { hair: 'bald',  build: 0.94, height: 0.94, scarf: true,  glow: 0.50 }
  };
  const DEFAULT_LOOK = { hair: 'short', build: 1.0, height: 1.0, scarf: false, glow: 0.45 };

  /* 飞行道具类型 → 引擎元素（决定颜色与命中特效） */
  function elementOf(pt) {
    const s = String(pt || '').toLowerCase();
    if (/fire|flame|ember|blaze|burn|incen|solar|nova/.test(s)) return 'fire';
    if (/ice|frost|snow|petal|water/.test(s)) return 'ice';
    if (/rock|earth|stone|ground|sand/.test(s)) return 'earth';
    if (/shadow|dark|black|cursed|void|death|ghost/.test(s)) return 'shadow';
    return 'neutral';
  }

  const PACK_ID = 'toku';

  /** 把一条原始记录翻译成引擎角色定义 */
  function buildCharacter(raw) {
    const c = raw.colors;
    const palette = {
      main: c[0],
      dark: c[1],
      light: c[2],
      accent: c[3],
      skin: c[2],
      hair: c[1],
      gi: c[0],
      belt: c[1],
      aura: c[4]
    };

    const D = FE.moves.derive;
    const pw = raw.power || 3;
    const ds = 0.82 + pw * 0.06;          // power 3 → 1.0, 5 → 1.12

    const moves = [
      D('light', { id: 'light', name: '轻击', damage: Math.round(34 * ds) }),
      D('heavy', { id: 'heavy', name: '重击', damage: Math.round(76 * ds) }),
      D('kick', { id: 'kick', name: '踢击', damage: Math.round(70 * ds) }),
      D('crouch_light', { id: 'crouch_light', name: '蹲击' }),
      D('sweep', { id: 'sweep', name: '扫腿', damage: Math.round(64 * ds) }),
      D('uppercut', { id: 'uppercut', name: '升击', damage: Math.round(90 * ds) }),
      D('air_light', { id: 'air_light', name: '空击' }),
      D('air_heavy', { id: 'air_heavy', name: '空踢' }),
      D('throw', { id: 'throw', name: '投技' })
    ];

    /* 飞行道具：236 + 特殊 */
    if (raw.pAtk) {
      const [nm, dmg, pt, col] = raw.pAtk;
      const size = 26 + Math.min(18, (dmg || 4) * 2.5);
      moves.push(D('fireball', {
        id: 'shot', name: nm, anim: 'cast', startup: 11, recovery: 21,
        meterGain: 11,
        projectile: {
          speed: 7.6 + (dmg || 4) * 0.28,
          damage: Math.round(34 + (dmg || 4) * 5),
          hitstun: 20, blockstun: 12, hitstop: 6,
          w: size, h: size, life: 120,
          kb: { x: 3, y: 1.2 },
          fx: 'orb',
          element: elementOf(pt),
          tint: col
        }
      }));
    }

    /* 突进技：214 + 特殊 */
    if (raw.small) {
      const [nm, , dmg] = raw.small;
      moves.push(D('rush', {
        id: 'rush', name: nm, damage: Math.round(62 + (dmg || 9) * 2.4),
        self: { x: 10.5, y: 0 }
      }));
    }

    /* 第二必杀：623 + 特殊 */
    if (raw.skill2) {
      const [nm, pt, dmg] = raw.skill2;
      moves.push(D('fireball', {
        id: 'skill2', name: nm, anim: 'cast',
        startup: 13, recovery: 24, meterGain: 13,
        projectile: {
          speed: 6.4 + (dmg || 11) * 0.16,
          damage: Math.round(44 + (dmg || 11) * 3.6),
          hitstun: 24, blockstun: 14, hitstop: 8,
          w: 40, h: 26, life: 130,
          kb: { x: 3.4, y: 2.2 },
          fx: 'orb',
          element: elementOf(pt),
          tint: raw.colors[4]
        }
      }));
    }

    /* 超必杀：236 + 超必 */
    if (raw.special) {
      const [nm, , dmg] = raw.special;
      moves.push(D('super', {
        id: 'super', name: nm,
        damage: Math.round(180 + (dmg || 25) * 2.6)
      }));
    }

    const look = Object.assign({}, DEFAULT_LOOK, HEAD_LOOK[raw.head] || {});
    if (raw.scarf) look.scarf = true;

    return {
      id: PACK_ID + '_' + raw.id,
      name: raw.name,
      title: raw.style,
      archetype: raw.style,
      desc: raw.desc,
      avatar: (raw.name || '?')[0],
      pack: PACK_ID,
      group: raw.group,
      palette,
      look,
      stats: {
        health: U.clamp(raw.hp / 100, 0.7, 2.0),
        walk: U.clamp(raw.speed / 255, 0.62, 1.72),
        dash: U.clamp(raw.speed / 255, 0.75, 1.6),
        jump: U.clamp(raw.jump / 950, 0.82, 1.32),
        weight: U.clamp(0.8 + (raw.hp - 100) / 250, 0.7, 1.45),
        gravity: 1,
        meterGain: 1
      },
      /* 我们为它生成了全后端外观，所以九个后端都算"已适配" */
      adapters: ['3d', '25d', 'data', 'c', 'pixel', 'ink', 'neon', 'toon', 'hyper'],
      moves,
      tag: { assist: 'rush', switchIn: 'rush', call: raw.small ? raw.small[0] : '突进' },
      quote: raw.taunt || raw.desc,
      raw
    };
  }

  /* ---------------- 内容包管理 ---------------- */
  const packs = {
    list: [],
    enabled: {},

    /** 注册一个包（数据已挂在 window 上） */
    load(data) {
      if (!data || !data.meta) return null;
      const pack = {
        id: data.meta.id,
        name: data.meta.name,
        version: data.meta.version,
        author: data.meta.author,
        repo: data.meta.repo,
        chars: data.chars || [],
        stages: data.stages || [],
        registered: []
      };
      this.list.push(pack);
      return pack;
    },

    /** 把包内所有角色注册进引擎 */
    enable(id) {
      const pack = this.list.find(p => p.id === id);
      if (!pack || this.enabled[id]) return 0;
      let n = 0;
      for (const raw of pack.chars) {
        const def = buildCharacter(raw);
        if (FE.characters.has(def.id)) continue;
        FE.characters.register(def.id, def);
        FE.charOrder.push(def.id);
        pack.registered.push(def.id);
        n++;
      }
      for (const s of pack.stages) {
        if (!FE.stages.has(s.id)) FE.stages.register(s.id, s);
      }
      this.enabled[id] = true;
      FE.log(`内容包已载入：${pack.name} ${pack.version}（${n} 名角色 / ${pack.stages.length} 张战场）`, 'sys');
      return n;
    },

    disable(id) {
      const pack = this.list.find(p => p.id === id);
      if (!pack || !this.enabled[id]) return 0;
      let n = 0;
      for (const cid of pack.registered) {
        if (FE.characters.remove(cid)) n++;
        const i = FE.charOrder.indexOf(cid);
        if (i >= 0) FE.charOrder.splice(i, 1);
      }
      pack.registered.length = 0;
      this.enabled[id] = false;
      FE.log(`内容包已卸载：${pack.name}（移除 ${n} 名角色）`, 'sys');
      return n;
    },

    isEnabled(id) { return !!this.enabled[id]; }
  };

  FE.packs = packs;
  FE.packBuild = buildCharacter;
})();
