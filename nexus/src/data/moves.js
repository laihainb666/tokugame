/* ==========================================================
   Moves — 招式预制体与帧数据
   ----------------------------------------------------------
   招式是纯数据。引擎不认识"轻拳"或"升龙"，它只认识：
     起手帧 / 判定帧 / 收招帧 / 判定盒 / 取消窗口 / 指令。
   所以新增招式 = 往数组里加一条数据，零代码。

   帧数据单位：逻辑帧（60fps）。startup=起手，active=判定，
   recovery=收招，总帧数 = 三者之和。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  /* 所有招式字段的默认值 —— 写新招式时只需写差异部分 */
  const DEFAULTS = {
    name: '招式',
    input: null,            // light | heavy | special | super | launcher
    stance: 'any',          // stand | crouch | air | any
    cmd: null,              // qcf | qcb | dp | dd | null
    startup: 6, active: 3, recovery: 10,
    hitbox: { x: 46, y: 108, w: 52, h: 26 },
    damage: 50,
    hitstun: 16, blockstun: 10, hitstop: 6,
    kb: { x: 2.2, y: 0 },
    self: { x: 0, y: 0 },
    height: 'mid',          // high | mid | low | overhead | unblockable
    cancel: [],             // 可取消进入的招式 tag 或 id
    cancelFrom: [2, 99],    // 取消窗口（相对招式帧）
    meterGain: 5, meterCost: 0,
    anim: 'jab',
    fx: 'spark',
    armor: 0,               // 霸体可吃几次
    invuln: null,           // [from, to] 无敌帧
    projectile: null,
    hits: 1,                // 多段攻击次数
    hitInterval: 4,
    onHit: null,            // launch | knockdown | crumple | wallbounce
    tags: [],               // 供取消与模组识别的标签
    priority: 0,            // 同帧多招匹配时的优先级
    sfx: 'punch',
    desc: ''
  };

  /** 基于模板派生新招式 */
  function derive(baseId, overrides) {
    const base = TEMPLATES[baseId];
    if (!base) throw new Error('未知招式模板: ' + baseId);
    const m = U.clone(base);
    U.merge(m, overrides || {});
    return m;
  }

  /* ---------------- 通用招式模板 ---------------- */
  const TEMPLATES = {
    /* 站立轻攻击：快、可连打、取消窗口大 */
    light: {
      name: '轻击', input: 'light', stance: 'stand',
      startup: 4, active: 3, recovery: 7,
      hitbox: { x: 44, y: 116, w: 54, h: 24 },
      damage: 36, hitstun: 15, blockstun: 9, hitstop: 5,
      kb: { x: 1.5, y: 0 },
      cancel: ['light', 'heavy', 'special', 'super'], cancelFrom: [4, 14],
      meterGain: 5, anim: 'jab', fx: 'spark', tags: ['light', 'normal'],
      desc: '最快的起手，命中后可接重击或必杀'
    },
    /* 站立重攻击：慢、伤害高、击退强 */
    heavy: {
      name: '重击', input: 'heavy', stance: 'stand',
      startup: 9, active: 4, recovery: 15,
      hitbox: { x: 50, y: 110, w: 62, h: 32 },
      damage: 82, hitstun: 21, blockstun: 13, hitstop: 8,
      kb: { x: 3.4, y: 0 },
      cancel: ['special', 'super'], cancelFrom: [9, 20],
      meterGain: 9, anim: 'straight', fx: 'impact', tags: ['heavy', 'normal'],
      desc: '主力确认手段'
    },
    /* 中段脚 */
    kick: {
      name: '中踢', input: 'heavy', stance: 'stand',
      startup: 11, active: 4, recovery: 16,
      hitbox: { x: 54, y: 96, w: 66, h: 30 },
      damage: 74, hitstun: 19, blockstun: 12, hitstop: 7,
      kb: { x: 2.8, y: 0 },
      cancel: ['special', 'super'], cancelFrom: [11, 22],
      meterGain: 8, anim: 'kick_mid', fx: 'impact', tags: ['heavy', 'normal'],
      desc: '距离更远的重击'
    },
    /* 蹲轻 */
    crouch_light: {
      name: '蹲轻', input: 'light', stance: 'crouch',
      startup: 4, active: 3, recovery: 8,
      hitbox: { x: 40, y: 56, w: 50, h: 22 },
      damage: 30, hitstun: 14, blockstun: 9, hitstop: 5,
      kb: { x: 1.2, y: 0 },
      cancel: ['light', 'heavy', 'special', 'super'], cancelFrom: [4, 15],
      meterGain: 4, anim: 'crouch_jab', fx: 'spark', tags: ['light', 'normal'],
      desc: '蹲姿起手，下段前置'
    },
    /* 扫腿：下段击倒 */
    sweep: {
      name: '扫腿', input: 'heavy', stance: 'crouch',
      startup: 10, active: 4, recovery: 22,
      hitbox: { x: 48, y: 26, w: 74, h: 26 },
      damage: 68, hitstun: 26, blockstun: 13, hitstop: 9,
      kb: { x: 3.6, y: 5.5 },
      height: 'low', onHit: 'knockdown',
      cancel: ['super'], cancelFrom: [10, 18],
      meterGain: 9, anim: 'sweep', fx: 'dust', tags: ['heavy', 'normal', 'low'],
      desc: '下段，命中击倒，蹲防可挡'
    },
    /* 升龙类：起手无敌 */
    uppercut: {
      name: '升击', input: 'heavy', stance: 'stand', cmd: 'dp',
      startup: 5, active: 5, recovery: 26,
      hitbox: { x: 40, y: 130, w: 58, h: 76 },
      damage: 96, hitstun: 28, blockstun: 14, hitstop: 10,
      kb: { x: 2.4, y: 9.5 },
      onHit: 'launch', invuln: [0, 8],
      cancel: ['super'], cancelFrom: [5, 12],
      meterGain: 11, anim: 'uppercut', fx: 'impact', tags: ['special', 'anti_air'],
      desc: '起手无敌，对空主力'
    },
    /* 空中攻击 */
    air_light: {
      name: '空轻', input: 'light', stance: 'air',
      startup: 4, active: 6, recovery: 6,
      hitbox: { x: 42, y: 78, w: 54, h: 34 },
      damage: 34, hitstun: 16, blockstun: 9, hitstop: 5,
      kb: { x: 1.4, y: -1.2 },
      cancel: [], anim: 'air_jab', fx: 'spark', tags: ['light', 'air'],
      desc: '空对空起手'
    },
    air_heavy: {
      name: '空重', input: 'heavy', stance: 'air',
      startup: 7, active: 8, recovery: 8,
      hitbox: { x: 46, y: 62, w: 62, h: 42 },
      damage: 70, hitstun: 22, blockstun: 12, hitstop: 8,
      kb: { x: 2.2, y: -2.6 },
      height: 'overhead', cancel: [], anim: 'air_kick', fx: 'impact',
      tags: ['heavy', 'air', 'overhead'],
      desc: '中段，落地可接连段'
    },
    /* 投技 */
    throw: {
      name: '投技', input: 'heavy', stance: 'stand', cmd: 'dd',
      startup: 3, active: 3, recovery: 20,
      hitbox: { x: 40, y: 100, w: 56, h: 90 },
      damage: 110, hitstun: 40, blockstun: 0, hitstop: 12,
      kb: { x: 6.5, y: 4 },
      height: 'unblockable', onHit: 'knockdown',
      cancel: [], anim: 'throw', fx: 'impact', tags: ['throw'],
      desc: '破防，无法格挡'
    },
    /* 波动：飞行道具 */
    fireball: {
      name: '气弹', input: 'special', stance: 'any', cmd: 'qcf',
      startup: 12, active: 2, recovery: 24,
      hitbox: { x: 52, y: 104, w: 0, h: 0 },
      damage: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      kb: { x: 0, y: 0 }, cancel: [],
      meterGain: 12, anim: 'cast', fx: 'cast', tags: ['special', 'projectile'],
      projectile: {
        speed: 9.5, damage: 62, hitstun: 20, blockstun: 12, hitstop: 7,
        w: 34, h: 30, life: 110, kb: { x: 3.2, y: 1.2 }, fx: 'orb'
      },
      desc: '远距离牵制'
    },
    /* 突进：位移 + 打击 */
    rush: {
      name: '突进', input: 'special', stance: 'any', cmd: 'qcb',
      startup: 10, active: 6, recovery: 20,
      hitbox: { x: 48, y: 104, w: 68, h: 40 },
      damage: 88, hitstun: 22, blockstun: 13, hitstop: 9,
      kb: { x: 5.2, y: 2.4 },
      self: { x: 9.5, y: 0 },
      cancel: ['super'], cancelFrom: [10, 16],
      meterGain: 12, anim: 'rush', fx: 'trail', tags: ['special', 'dash'],
      desc: '快速拉近距离'
    },
    /* 超必杀 */
    super: {
      name: '超必杀', input: 'super', stance: 'any', cmd: 'qcf',
      startup: 8, active: 10, recovery: 30,
      hitbox: { x: 46, y: 90, w: 150, h: 130 },
      damage: 240, hitstun: 34, blockstun: 20, hitstop: 16,
      kb: { x: 8, y: 6 },
      meterCost: 50, invuln: [0, 14],
      cancel: [], anim: 'super', fx: 'super', tags: ['super'],
      desc: '消耗 50 能量，起手无敌'
    }
  };

  /* ---------------- 归一化 ---------------- */
  function normalize(m, i) {
    const out = U.clone(DEFAULTS);
    U.merge(out, m);
    if (!out.id) out.id = (out.input || 'move') + '_' + i;
    if (!out.total) out.total = out.startup + out.active + out.recovery;
    if (!out.tags.length) out.tags = [out.input || 'normal'];
    // 判定帧区间
    out.activeFrom = out.startup;
    out.activeTo = out.startup + out.active - 1;
    return out;
  }

  FE.moves = {
    TEMPLATES,
    DEFAULTS,
    derive,
    normalize,
    /** 把角色定义里的招式数组变成 id -> 招式 的映射 */
    resolveList(list) {
      const map = new Map();
      list.forEach((m, i) => {
        const nm = normalize(m, i);
        map.set(nm.id, nm);
      });
      return map;
    }
  };
})();
