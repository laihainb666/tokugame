/* ==========================================================
   Registry + Util — 预制体注册表
   ----------------------------------------------------------
   引擎里所有"可被扩展的东西"都放在注册表里：
     角色 / 招式 / 战斗模式 / 渲染后端 / 输入设备 / HUD 面板。
   模组只需要往注册表里塞一个定义，就能出现在 UI 与对战里，
   完全不需要改引擎源码。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  /* ---------------- 工具 ---------------- */
  const U = FE.util = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    damp: (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt)),
    rnd: (a, b) => a + Math.random() * (b - a),
    rndi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: arr => arr[Math.floor(Math.random() * arr.length)],
    sign: v => (v < 0 ? -1 : v > 0 ? 1 : 0),
    /** 缓动 */
    ease: {
      linear: t => t,
      inQuad: t => t * t,
      outQuad: t => t * (2 - t),
      inOutQuad: t => (t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
      outCubic: t => 1 - Math.pow(1 - t, 3),
      inCubic: t => t * t * t,
      outBack: t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
      outElastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1
    },
    clone(o) {
      if (o === null || typeof o !== 'object') return o;
      if (Array.isArray(o)) return o.map(U.clone);
      const r = {};
      for (const k in o) r[k] = U.clone(o[k]);
      return r;
    },
    /** 深合并：patch 覆盖 target，数组整体替换 */
    merge(target, patch) {
      for (const k in patch) {
        const v = patch[k];
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
          U.merge(target[k], v);
        } else {
          target[k] = U.clone(v);
        }
      }
      return target;
    },
    uid: (() => { let n = 0; return p => (p || 'id') + '_' + (++n).toString(36); })(),
    fmt: n => (Math.round(n * 10) / 10).toString()
  };

  /* ---------------- 注册表 ---------------- */
  class Registry {
    constructor(kind, bus) {
      this.kind = kind;
      this.bus = bus;
      this.items = new Map();
    }

    /**
     * 注册一个预制体
     * @param {string} id
     * @param {object} def 必须含 name；其余字段由各类自行约定
     */
    register(id, def) {
      if (!id || typeof id !== 'string') throw new Error(`[${this.kind}] id 必须是非空字符串`);
      if (!def || typeof def !== 'object') throw new Error(`[${this.kind}] ${id} 定义必须是对象`);
      def.id = id;
      if (!def.name) def.name = id;
      if (def.enabled === undefined) def.enabled = true;
      this.items.set(id, def);
      this.bus.emit(this.kind + ':register', { id, def });
      return def;
    }

    /** 局部覆盖已注册的定义（模组做平衡性调整的常用手段） */
    patch(id, patch) {
      const base = this.items.get(id);
      if (!base) throw new Error(`[${this.kind}] 未找到 ${id}`);
      U.merge(base, patch);
      this.bus.emit(this.kind + ':patch', { id, def: base, patch });
      return base;
    }

    get(id) { return this.items.get(id); }
    has(id) { return this.items.has(id); }
    remove(id) { const r = this.items.delete(id); this.bus.emit(this.kind + ':remove', { id }); return r; }
    list() { return [...this.items.values()]; }
    listEnabled() { return this.list().filter(d => d.enabled !== false); }
    ids() { return [...this.items.keys()]; }
  }

  FE.Registry = Registry;
  FE.characters = new Registry('character', FE.bus);
  FE.modes = new Registry('mode', FE.bus);
  FE.renderers = new Registry('renderer', FE.bus);
  FE.inputs = new Registry('input', FE.bus);
  FE.hudPanels = new Registry('hud', FE.bus);
  FE.stages = new Registry('stage', FE.bus);

  /** 当前战场主题（渲染层读取，没有则用后端自己的默认配色） */
  FE.activeStage = null;
  FE.stageTheme = function () { return FE.activeStage; };

  /* ---------------- 全局运行时配置 ---------------- */
  FE.config = {
    renderer: '3d',        // 3d | 25d | data
    p1: 'flame',
    p2: 'frost',
    mode: 'duel',
    input1: 'keyboard',
    input2: 'keyboard2',
    debug: { hitbox: false, hurtbox: false, framedata: false, slow: false, hooklog: false },
    paused: false
  };
})();
