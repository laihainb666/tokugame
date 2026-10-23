/* ==========================================================
   Input — 多模态输入抽象层
   ----------------------------------------------------------
   引擎只认一种输入结构：
     { dir:{x,y}, pressed:{...}, buffer:[...], dashDir }
   键盘 / 手柄 / 触屏 / AI / 回放 都实现成"设备"，注册进
   FE.input 就能给任意角色用。模组也可以注册自己的设备
   （例如语音指令、摄像头姿态、网络对战）。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  const BUTTONS = ['light', 'heavy', 'special', 'super', 'switch', 'assist', 'jump'];

  /* ---------------- 设备状态 ---------------- */
  class DeviceState {
    constructor() {
      this.dir = { x: 0, y: 0 };
      this.pressed = {};
      this.held = {};
      this.buffer = [];
      this.frame = 0;
      this.dashDir = 0;
      this._lastTapDir = 0;
      this._lastTapFrame = -99;
      this._prevDir = { x: 0, y: 0 };
      this.enabled = true;
    }
    clearPressed() { this.pressed = {}; }
    press(b) { if (b && !this.pressed[b]) this.pressed[b] = true; }
    setDir(x, y) {
      this.dir.x = x; this.dir.y = y;
    }
  }

  /* ---------------- 键盘映射 ---------------- */
  const KEYMAP = {
    keyboard: {
      left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
      light: ['KeyJ'], heavy: ['KeyK'], special: ['KeyL'], super: ['KeyU'],
      switch: ['KeyI'], assist: ['KeyO']
    },
    keyboard2: {
      left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
      light: ['Numpad1', 'Comma'], heavy: ['Numpad2', 'Period'],
      special: ['Numpad3', 'Slash'], super: ['Numpad5', 'Semicolon'],
      switch: ['Numpad7', 'Quote'], assist: ['Numpad9', 'BracketLeft']
    }
  };

  const down = new Set();
  const queue = [];

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    down.add(e.code);
    queue.push(e.code);
    // 避免空格/方向键滚屏
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { down.delete(e.code); });
  window.addEventListener('blur', () => down.clear());

  /* ---------------- 输入系统 ---------------- */
  class InputSystem {
    constructor() {
      this.states = new Map();     // deviceId -> DeviceState
      this.bindings = new Map();   // fighterUid -> deviceId
      this.defs = new Map();
      this.touch = { dir: { x: 0, y: 0 }, buttons: {} };
      this.frame = 0;
      this.registerBuiltins();
    }

    register(id, def) {
      this.defs.set(id, Object.assign({ id, name: id, short: id }, def));
      return this.defs.get(id);
    }

    getDef(id) { return this.defs.get(id); }
    list() { return [...this.defs.values()]; }

    registerBuiltins() {
      /* --- 键盘 P1 --- */
      this.register('keyboard', {
        name: '键盘 (WASD)', short: 'KB1',
        poll(st, fighter, match) { return InputSystem.readKeyboard(st, 'keyboard', true); }
      });
      /* --- 键盘 P2 --- */
      this.register('keyboard2', {
        name: '键盘 (方向键)', short: 'KB2',
        poll(st, fighter, match) { return InputSystem.readKeyboard(st, 'keyboard2', false); }
      });
      /* --- 手柄 --- */
      this.register('gamepad', {
        name: '手柄', short: 'PAD',
        poll(st, fighter, match) { return InputSystem.readGamepad(st); }
      });
      /* --- AI --- */
      this.register('ai', {
        name: 'AI (普通)', short: 'AI', ai: true, level: 'normal',
        poll(st, fighter, match) { return FE.ai.poll(st, fighter, match, 'normal'); }
      });
      this.register('ai_hard', {
        name: 'AI (困难)', short: 'AI+', ai: true, level: 'hard',
        poll(st, fighter, match) { return FE.ai.poll(st, fighter, match, 'hard'); }
      });
      this.register('ai_easy', {
        name: 'AI (简单)', short: 'AI-', ai: true, level: 'easy',
        poll(st, fighter, match) { return FE.ai.poll(st, fighter, match, 'easy'); }
      });
      /* --- 空输入（用于纯观察内核） --- */
      this.register('empty', {
        name: '无输入', short: 'NULL',
        poll(st) { return st; }
      });
    }

    /* --- 键盘读取 --- */
    static readKeyboard(st, mapId, isP1) {
      const map = KEYMAP[mapId];
      const isDown = (list) => list.some(k => down.has(k));

      let x = 0, y = 0;
      if (isDown(map.left)) x -= 1;
      if (isDown(map.right)) x += 1;
      if (isDown(map.down)) y += 1;
      if (isDown(map.up)) y -= 1;

      // 触屏合流（仅 P1）
      if (isP1 && FE.input.touch) {
        x += FE.input.touch.dir.x;
        y += FE.input.touch.dir.y;
      }
      x = Math.max(-1, Math.min(1, x));
      y = Math.max(-1, Math.min(1, y));

      // 按键边沿：来自事件队列，保证不漏帧
      st.clearPressed();
      for (const code of queue) {
        for (const b of BUTTONS) {
          if (!map[b]) continue;
          if (map[b].includes(code)) st.press(b);
        }
        if (isP1 && FE.input.touchQueue) {
          // 触屏按键走队列
        }
      }
      if (isP1 && FE.input.touch) {
        for (const b in FE.input.touch.buttons) {
          if (FE.input.touch.buttons[b]) st.press(b);
        }
        // 触屏按下后立刻松开（边沿）
        FE.input.touch.buttons = {};
      }
      // 跳跃取边沿：按住上不会连跳
      if (y < 0 && st._prevDir.y >= 0) st.press('jump');

      st.setDir(x, y);
      return st;
    }

    /* --- 手柄读取 --- */
    static readGamepad(st) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) if (p && p.connected) { gp = p; break; }
      st.clearPressed();
      if (!gp) { st.setDir(0, 0); return st; }
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dz = 0.35;
      st.setDir(Math.abs(ax) > dz ? Math.sign(ax) : 0, Math.abs(ay) > dz ? Math.sign(ay) : 0);
      const btn = i => gp.buttons[i] && gp.buttons[i].pressed;
      const map = { 0: 'light', 1: 'heavy', 2: 'special', 3: 'super', 4: 'switch', 5: 'assist' };
      for (const i in map) {
        const b = map[i];
        if (btn(+i) && !st.held[b]) st.press(b);
        st.held[b] = btn(+i);
      }
      if (btn(12)) st.press('jump');
      return st;
    }

    /* --- 绑定与轮询 --- */
    bind(fighter, deviceId) {
      this.bindings.set(fighter.uid, deviceId);
      if (!this.states.has(fighter.uid)) this.states.set(fighter.uid, new DeviceState());
      const st = this.states.get(fighter.uid);
      st.enabled = deviceId !== 'empty';
      return st;
    }

    stateOf(fighter) {
      let st = this.states.get(fighter.uid);
      if (!st) st = this.bind(fighter, 'empty');
      return st;
    }

    pollAll(match) {
      this.frame++;
      for (const f of match.fighters) {
        if (!f.active) continue;
        if (f.isGhost) {
          f.input = { dir: { x: 0, y: 0 }, pressed: {}, buffer: [] };
          continue;
        }
        const devId = this.bindings.get(f.uid) || (f.side === 0 ? FE.config.input1 : FE.config.input2);
        const def = this.defs.get(devId) || this.defs.get('empty');
        const st = this.stateOf(f);
        st.frame = this.frame;
        if (!st.enabled) {
          st.clearPressed();
          st.setDir(0, 0);
        } else {
          try { def.poll(st, f, match); }
          catch (err) { console.warn('[input]', devId, err); st.clearPressed(); }
        }
        this.postProcess(st, f);
        f.input = st;
      }
      // 清空一次性队列（AI/手柄不需要）
      queue.length = 0;
    }

    /** 后处理：指令缓冲、双击冲刺 */
    postProcess(st, f) {
      const facing = f.facing || 1;
      const key = this.dirKey(st.dir, facing);
      const last = st.buffer[st.buffer.length - 1];
      st.dashDir = 0;
      if (!last || last.k !== key) {
        st.buffer.push({ k: key, frame: this.frame });
        if (st.buffer.length > 24) st.buffer.shift();
        // 双击冲刺
        if (key === 'f' || key === 'b') {
          if (st._lastTapDir === key && this.frame - st._lastTapFrame < 15) {
            st.dashDir = key === 'f' ? 1 : -1;
          }
          st._lastTapDir = key;
          st._lastTapFrame = this.frame;
        }
      } else {
        last.frame = this.frame;
      }
      st._prevDir.x = st.dir.x;
      st._prevDir.y = st.dir.y;
      // 清理过期缓冲
      while (st.buffer.length && this.frame - st.buffer[0].frame > 40) st.buffer.shift();
    }

    /** 方向 → 相对朝向的键位 */
    dirKey(dir, facing) {
      const fx = dir.x * (facing >= 0 ? 1 : -1);
      const y = dir.y;
      if (y > 0) return fx > 0 ? 'df' : fx < 0 ? 'db' : 'd';
      if (y < 0) return fx > 0 ? 'uf' : fx < 0 ? 'ub' : 'u';
      return fx > 0 ? 'f' : fx < 0 ? 'b' : 'n';
    }

    /** 指令识别：宽松序列匹配 */
    matchMotion(inp, cmd) {
      if (!cmd) return true;
      const PAT = {
        qcf: [['d', 'df', 'db'], ['df', 'f']],
        qcb: [['d', 'df', 'db'], ['db', 'b']],
        dp: [['f', 'df'], ['d', 'df', 'db'], ['f', 'df']],
        dd: [['d'], ['n', 'd', 'db', 'df'], ['d']],
        qcf2: [['d'], ['df', 'f'], ['d'], ['df', 'f']]
      };
      const pat = PAT[cmd];
      if (!pat) return true;
      const window = cmd === 'dd' ? 22 : 16;
      const buf = inp.buffer || [];
      let pi = pat.length - 1;
      for (let i = buf.length - 1; i >= 0; i--) {
        const e = buf[i];
        if (this.frame - e.frame > window) break;
        if (pat[pi].includes(e.k)) {
          pi--;
          if (pi < 0) return true;
        }
      }
      return false;
    }

    /* 便捷：查询某角色当前设备类型 */
    deviceOf(f) { return this.bindings.get(f.uid) || 'ai'; }
    isAI(f) { const d = this.defs.get(this.deviceOf(f)); return !!(d && d.ai); }
  }

  FE.input = new InputSystem();
  FE.INPUT_BUTTONS = BUTTONS;
})();
