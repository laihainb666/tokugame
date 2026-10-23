/* ==========================================================
   ModLoader — 模组系统
   ----------------------------------------------------------
   一个模组 = 一个对象 + 一个 setup(api) 函数。
   api 提供的都是"扩展点"，不是"内部实现"，所以模组永远不需要
   hack 引擎内部。禁用模组时：
     1. 调 teardown(api)
     2. 按作用域摘掉它注册的所有钩子
     3. 撤销它注册的角色 / 模式 / 后端
   整个过程可逆，不残留。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  /* ---------------- 全局日志 ---------------- */
  FE.logBuf = [];
  FE.log = function (msg, type) {
    const rec = { msg: String(msg), type: type || 'hook', t: Date.now(), frame: -1 };
    FE.logBuf.push(rec);
    if (FE.logBuf.length > 400) FE.logBuf.shift();
    FE.bus.emit('ui:log', rec);
  };

  class ModLoader {
    constructor() {
      this.mods = new Map();       // id -> {def, state, api, hooks, registered, errors}
      this.ready = false;
    }

    /**
     * 注册模组定义（可在任意时刻调用）
     */
    register(def) {
      if (!def || !def.id) throw new Error('[mod] 模组必须有 id');
      if (!def.name) def.name = def.id;
      if (this.mods.has(def.id)) {
        // 覆盖已存在的（用于热重载）
        this.disable(def.id);
        this.mods.delete(def.id);
      }
      const rec = {
        def,
        enabled: false,
        api: null,
        errors: [],
        registered: { characters: [], modes: [], renderers: [], inputs: [] },
        state: {}
      };
      this.mods.set(def.id, rec);
      if (this.ready) this.enable(def.id);
      return rec;
    }

    /** 创建模组 API（每个模组独立作用域） */
    makeApi(rec) {
      const def = rec.def;
      const scope = 'mod:' + def.id;
      const bus = FE.bus.scoped(scope);
      const self = this;

      const api = {
        id: def.id,
        name: def.name,
        scope,
        state: rec.state,
        config: def.config || {},
        /* --- 钩子 --- */
        on: (n, f, o) => bus.on(n, f, o),
        once: (n, f, o) => bus.once(n, f, o),
        emit: (n, p, c) => bus.emit(n, p, c),
        chain: (n, v, c) => bus.chain(n, v, c),
        /* --- 日志 --- */
        log: (...args) => FE.log('[' + def.name + '] ' + args.map(a =>
          typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'hook'),
        /* --- 数据扩展 --- */
        balance: FE.balance,
        patchBalance(obj) {
          for (const k in obj) {
            if (typeof obj[k] === 'number' && typeof FE.balance[k] === 'number') {
              FE.balance[k] = obj[k];
            }
          }
          FE.log(`[${def.name}] 平衡参数已改写 (${Object.keys(obj).length} 项)`, 'hook');
        },
        addCharacter(id, cdef) {
          FE.characters.register(id, cdef);
          rec.registered.characters.push(id);
          if (FE.charOrder && !FE.charOrder.includes(id)) FE.charOrder.push(id);
          FE.log(`[${def.name}] 注册角色：${cdef.name || id}`, 'hook');
          return FE.characters.get(id);
        },
        patchCharacter(id, patch) {
          return FE.characters.patch(id, patch);
        },
        addMode(id, mdef) {
          FE.modes.register(id, mdef);
          rec.registered.modes.push(id);
          FE.log(`[${def.name}] 注册模式：${mdef.name || id}`, 'hook');
          return FE.modes.get(id);
        },
        addRenderer(id, rdef) {
          FE.renderers.register(id, rdef);
          rec.registered.renderers.push(id);
          return FE.renderers.get(id);
        },
        addInput(id, idef) {
          FE.input.register(id, idef);
          rec.registered.inputs.push(id);
          return FE.input.getDef(id);
        },
        /* --- 工具 --- */
        util: FE.util,
        moves: FE.moves,
        bus: FE.bus,
        engine: null
      };
      return api;
    }

    enable(id) {
      const rec = this.mods.get(id);
      if (!rec || rec.enabled) return false;
      try {
        rec.api = this.makeApi(rec);
        if (rec.def.setup) rec.def.setup(rec.api);
        rec.enabled = true;
        FE.bus.emit('mod:load', { id, def: rec.def, api: rec.api });
        FE.log(`模组已启用：${rec.def.name}`, 'sys');
        return true;
      } catch (err) {
        rec.errors.push(String(err && err.message || err));
        rec.enabled = false;
        FE.bus.emit('mod:error', { id, err });
        FE.log(`模组启用失败 ${rec.def.name}: ${err.message}`, 'err');
        try { FE.bus.offScope('mod:' + id); } catch (_) {}
        return false;
      }
    }

    disable(id) {
      const rec = this.mods.get(id);
      if (!rec || !rec.enabled) return false;
      try {
        if (rec.def.teardown) rec.def.teardown(rec.api);
      } catch (err) {
        FE.log(`teardown 出错 ${rec.def.name}: ${err.message}`, 'err');
      }
      // 摘钩子
      const n = FE.bus.offScope('mod:' + id);
      // 撤销注册
      for (const cid of rec.registered.characters) FE.characters.remove(cid);
      for (const mid of rec.registered.modes) FE.modes.remove(mid);
      for (const rid of rec.registered.renderers) FE.renderers.remove(rid);
      for (const iid of rec.registered.inputs) FE.input.defs.delete(iid);
      rec.registered = { characters: [], modes: [], renderers: [], inputs: [] };
      rec.enabled = false;
      rec.api = null;
      FE.bus.emit('mod:unload', { id, hooks: n });
      FE.log(`模组已停用：${rec.def.name}（摘除 ${n} 个钩子）`, 'sys');
      return true;
    }

    toggle(id) {
      const rec = this.mods.get(id);
      if (!rec) return false;
      return rec.enabled ? this.disable(id) : this.enable(id);
    }

    /** 从源码字符串动态载入 */
    loadSource(src) {
      if (!src || !src.trim()) return { ok: false, err: '源码为空' };
      const before = new Set(this.mods.keys());
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('FE', src);
        fn(FE);
      } catch (err) {
        return { ok: false, err: String(err && err.message || err) };
      }
      const added = [...this.mods.keys()].filter(k => !before.has(k));
      if (!added.length) return { ok: false, err: '源码没有调用 FE.registerMod()' };
      added.forEach(id => this.enable(id));
      return { ok: true, ids: added };
    }

    list() {
      return [...this.mods.values()].map(rec => ({
        id: rec.def.id,
        name: rec.def.name,
        version: rec.def.version || '1.0',
        desc: rec.def.desc || '',
        author: rec.def.author || '',
        enabled: rec.enabled,
        errors: rec.errors,
        hooks: this.hooksOf(rec),
        builtin: !!rec.def.builtin,
        dynamic: !!rec.def.dynamic
      }));
    }

    hooksOf(rec) {
      const scope = 'mod:' + rec.def.id;
      const out = [];
      for (const [name, list] of FE.bus.map) {
        if (list.some(e => e.scope === scope)) out.push(name);
      }
      return out;
    }

    markReady() {
      this.ready = true;
      // 启动时自动启用标记为 auto 的模组
      for (const rec of this.mods.values()) {
        if (rec.def.auto && !rec.enabled) this.enable(rec.def.id);
      }
    }
  }

  FE.mods = new ModLoader();
  FE.registerMod = def => FE.mods.register(def);
})();
