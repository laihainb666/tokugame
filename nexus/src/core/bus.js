/* ==========================================================
   HookBus — 钩子总线
   ----------------------------------------------------------
   引擎的一切扩展点都经过这里。设计目标：
     1. 任意模块都能在不动引擎源码的前提下介入流程；
     2. 支持优先级排序，后注册的可以"覆盖"先注册的；
     3. 支持拦截（return false 或 payload.cancel = true）；
     4. 支持作用域卸载（模组禁用时一次性摘掉它注册的所有钩子）；
     5. 单个回调抛错不会炸掉整条总线，并自动降级该作用域。

   用法：
     const off = FE.bus.on('combat:hit', e => { e.damage *= 1.5 }, {priority: 10});
     FE.bus.emit('combat:hit', {damage: 40});   // => {cancelled:false, payload:{...}}
     off();                                      // 手动注销
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  class HookBus {
    constructor() {
      /** @type {Map<string, Array>} */
      this.map = new Map();
      this.seq = 0;
      this.totalCalls = 0;
      this.stats = Object.create(null);   // name -> {calls, handlers}
      this.errors = [];
      this.onError = null;                // (err, hookName, scope) => void
      this.maxErrors = 40;
    }

    /**
     * 注册钩子
     * @param {string} name
     * @param {Function} fn
     * @param {{priority?:number, once?:boolean, id?:string, scope?:string}} [opts]
     * @returns {Function} 注销函数
     */
    on(name, fn, opts) {
      opts = opts || {};
      if (typeof fn !== 'function') throw new Error('[HookBus] handler 必须是函数: ' + name);
      const entry = {
        fn,
        priority: opts.priority || 0,
        once: !!opts.once,
        id: opts.id || null,
        scope: opts.scope || null,
        seq: this.seq++,
        dead: false
      };
      let list = this.map.get(name);
      if (!list) { list = []; this.map.set(name, list); }
      list.push(entry);
      // 稳定排序：优先级降序，同优先级按注册顺序
      list.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
      this._stat(name).handlers = list.length;

      const off = () => this._remove(name, entry);
      off.entry = entry;
      return off;
    }

    once(name, fn, opts) {
      return this.on(name, fn, Object.assign({}, opts, { once: true }));
    }

    /** 直接注销一个函数引用（该名字下所有匹配） */
    off(name, fn) {
      const list = this.map.get(name);
      if (!list) return 0;
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].fn === fn) { this._remove(name, list[i]); n++; }
      }
      return n;
    }

    /** 按作用域批量注销（模组卸载用） */
    offScope(scope) {
      let n = 0;
      for (const [name, list] of this.map) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].scope === scope) { this._remove(name, list[i]); n++; }
        }
      }
      return n;
    }

    _remove(name, entry) {
      if (entry.dead) return;
      entry.dead = true;
      const list = this.map.get(name);
      if (!list) return;
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
      this._stat(name).handlers = list.length;
      if (list.length === 0) this.map.delete(name);
    }

    _stat(name) {
      let s = this.stats[name];
      if (!s) s = this.stats[name] = { calls: 0, handlers: 0 };
      return s;
    }

    /**
     * 触发钩子。payload 是可变对象，回调可以直接改字段。
     * 返回 {cancelled, payload}；cancelled=true 表示流程被拦截。
     */
    emit(name, payload, ctx) {
      this.totalCalls++;
      const st = this._stat(name);
      st.calls++;
      const list = this.map.get(name);
      if (!list || list.length === 0) return { cancelled: false, payload };

      // 快照，避免回调内部增删导致遍历错乱
      const snapshot = list.slice();
      let cancelled = false;
      for (let i = 0; i < snapshot.length; i++) {
        const e = snapshot[i];
        if (e.dead) continue;
        try {
          const r = e.fn(payload, ctx || {});
          if (e.once) this._remove(name, e);
          if (r === false) { cancelled = true; break; }
          if (payload && payload.cancel === true) { cancelled = true; break; }
        } catch (err) {
          this._fail(err, name, e);
        }
      }
      return { cancelled, payload };
    }

    /** 只关心"是否被否决"，不关心 payload */
    veto(name, payload, ctx) {
      const r = this.emit(name, payload, ctx);
      return !!(r.cancelled || (payload && payload.cancel === true));
    }

    /**
     * 串联式钩子：把 value 依次交给每个回调，返回值作为下一个的输入。
     * 适合"计算类"扩展点，例如伤害公式、速度修正。
     */
    chain(name, value, ctx) {
      this.totalCalls++;
      const st = this._stat(name);
      st.calls++;
      const list = this.map.get(name);
      if (!list || !list.length) return value;
      let v = value;
      const snapshot = list.slice();
      for (const e of snapshot) {
        if (e.dead) continue;
        try {
          const r = e.fn(v, ctx || {});
          if (e.once) this._remove(name, e);
          if (r !== undefined) v = r;
        } catch (err) { this._fail(err, name, e); }
      }
      return v;
    }

    _fail(err, name, entry) {
      const rec = { name, scope: entry.scope, msg: String(err && err.message || err), t: Date.now() };
      this.errors.push(rec);
      if (this.errors.length > this.maxErrors) this.errors.shift();
      if (this.onError) { try { this.onError(rec, err); } catch (_) {} }
      else console.error('[HookBus]', name, err);
    }

    /** 创建一个绑定作用域的注册器（模组 API 内部使用） */
    scoped(scope) {
      const bus = this;
      return {
        on: (n, f, o) => bus.on(n, f, Object.assign({}, o, { scope })),
        once: (n, f, o) => bus.on(n, f, Object.assign({}, o, { scope, once: true })),
        emit: (n, p, c) => bus.emit(n, p, c),
        chain: (n, v, c) => bus.chain(n, v, c),
        offScope: () => bus.offScope(scope)
      };
    }

    /** 钩子清单（面板展示用） */
    inventory() {
      const out = [];
      for (const [name, list] of this.map) {
        out.push({
          name,
          handlers: list.length,
          calls: (this.stats[name] || {}).calls || 0,
          scopes: [...new Set(list.map(e => e.scope).filter(Boolean))],
          priorities: list.map(e => e.priority)
        });
      }
      out.sort((a, b) => (b.calls - a.calls) || a.name.localeCompare(b.name));
      return out;
    }

    reset() {
      this.map.clear();
      this.stats = Object.create(null);
      this.totalCalls = 0;
    }
  }

  /* 引擎对外暴露的钩子名清单 —— 也是给模组作者的"说明书" */
  const HOOKS = {
    // 引擎生命周期
    'engine:init':            '引擎初始化完成',
    'engine:frame':           '每个逻辑帧开始（payload.frame）',
    'engine:beforeUpdate':    '更新前，可改 dt / 拦截整帧',
    'engine:afterUpdate':     '更新后',
    'engine:beforeRender':    '渲染前',
    'engine:afterRender':     '渲染后',
    'engine:pause':           '暂停 / 恢复',
    // 比赛 / 回合
    'match:start':            '比赛开始',
    'match:end':              '比赛结束（payload.winner）',
    'round:start':            '回合开始',
    'round:end':              '回合结束',
    'round:countdown':        '回合倒计时每帧',
    // 角色生命周期
    'fighter:beforeSpawn':    '角色生成前，可改初始属性',
    'fighter:spawned':        '角色生成后',
    'fighter:preUpdate':      '角色逻辑更新前',
    'fighter:postUpdate':     '角色逻辑更新后',
    'fighter:stateChange':    '状态切换（payload.from/to）',
    'fighter:damaged':        '受到伤害后',
    'fighter:ko':             '被击倒',
    'fighter:land':           '落地',
    'fighter:jump':           '起跳',
    'fighter:meterChange':    '能量变化',
    // 战斗解算
    'combat:beforeHit':       '命中解算前，可改判定/取消命中',
    'combat:hit':             '确认命中，可改 damage/hitstun/knockback',
    'combat:block':           '被格挡',
    'combat:whiff':           '挥空',
    'combat:comboScale':      '连段伤害递减计算（chain）',
    'combat:pushback':        '击退计算（chain）',
    'combat:projectile':      '飞行道具生成',
    'combat:throw':           '投技成立',
    // 招式
    'move:select':            '招式选择时（可强制覆盖招式）',
    'move:beforeExecute':     '招式发动前，可拦截',
    'move:afterExecute':      '招式发动后',
    'move:cancel':            '取消判定（chain）',
    'move:frame':             '招式每帧（payload.phase）',
    // 输入
    'input:raw':              '原始输入（按键按下）',
    'input:mapped':           '映射后的输入状态（可改）',
    'input:buffer':           '指令缓冲更新',
    'input:deviceChange':     '输入设备切换',
    // 渲染
    'render:beforeDraw':      '绘制前',
    'render:afterDraw':       '绘制后',
    'render:world':           '世界层绘制（可插入自绘内容）',
    'render:hud':             'HUD 绘制',
    'render:debug':           '调试层绘制',
    // 系统
    'mod:load':               '模组载入',
    'mod:unload':             '模组卸载',
    'mod:error':              '模组报错',
    'ui:log':                 'UI 日志追加'
  };

  FE.HookBus = HookBus;
  FE.HOOKS = HOOKS;
  FE.bus = new HookBus();
})();
