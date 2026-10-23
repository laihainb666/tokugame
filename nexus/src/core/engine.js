/* ==========================================================
   Engine — 比赛编排 + 主循环
   ----------------------------------------------------------
   Engine 只管三件事：按 60Hz 推进逻辑、维护比赛/回合状态、
   把渲染交给当前后端。所有"规则"都在 Mode 里，所有"表现"
   都在 Renderer 里，所以三者可以各自替换。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const B = () => FE.balance;
  const FRAME_MS = 1000 / 60;
  const Fighter = FE.Fighter;
  const CombatSystem = FE.CombatSystem;

  /* ---------------- 队伍 ---------------- */
  class Side {
    constructor(index, rosterIds, match) {
      this.index = index;
      this.match = match;
      this.fighters = rosterIds.map((cid, i) => new Fighter(index, cid, i, {}));
      this.activeIdx = 0;
      this.wins = 0;
      this.assistTimer = 0;
    }
    get simultaneous() { return !!this.match.mode.simultaneous; }
    /** 在场角色（含已被 KO 的尸体，好让倒地动画继续） */
    activeFighters() {
      if (this.simultaneous) return this.fighters.slice();
      const f = this.fighters[this.activeIdx];
      return f ? [f] : [];
    }
    active() { return this.fighters[this.activeIdx] || null; }
    reserve() {
      for (let i = 0; i < this.fighters.length; i++) {
        if (i !== this.activeIdx && this.fighters[i].active) return this.fighters[i];
      }
      return null;
    }
    alive() {
      return this.fighters.some(f => f.alive && !f.isGhost);
    }
    resetRoster() {
      this.fighters.forEach(f => f.reset(true));
      this.activeIdx = 0;
    }
    /** 换人 */
    switchTo(idx) {
      const target = this.fighters[idx];
      if (!target || !target.active) return false;
      if (idx === this.activeIdx) return false;
      const cur = this.active();
      this.activeIdx = idx;
      target.x = cur ? cur.x : 0;
      target.facing = cur ? cur.facing : 1;
      target.vel.x = 0;
      target.invulnTimer = 10;
      this.match.spawnFx('switch', target.x, 100, { owner: target });
      this.match.log(`${this.match.sideName(this.index)} 换人 → ${target.def.name}`, 'sys');
      FE.bus.emit('side:switch', { side: this, fighter: target, out: cur });
      return true;
    }
    replaceActive(charId, silent) {
      const i = this.activeIdx;
      const old = this.fighters[i];
      const nf = new Fighter(this.index, charId, i, {});
      nf.x = old.x; nf.facing = old.facing;
      this.fighters[i] = nf;
      if (!silent) this.match.log(`新对手：${nf.def.name}`, 'sys');
      return nf;
    }
  }

  /* ---------------- 比赛 ---------------- */
  class Match {
    constructor(opts) {
      this.mode = FE.modes.get(opts.mode) || FE.modes.get('duel');
      this.pick = opts.pick || ['flame', 'frost'];
      this.frame = 0;
      this.round = 1;
      this.wave = 1;
      this.fx = [];
      this.shakeAmt = 0;
      this.shakeT = 0;
      this.bigText = null;
      this.logs = [];
      this.speed = 1;
      this.winner = null;
      this.hitstop = 0;
      this.combat = new CombatSystem(this);
      this.stats = { startTime: performance.now(), hits: 0, maxCombo: 0 };

      const rosters = this.mode.buildRoster ? this.mode.buildRoster(this) :
        [[this.pick[0]], [this.pick[1]]];
      this.sides = [new Side(0, rosters[0], this), new Side(1, rosters[1], this)];

      /* 角色生成钩子：模组可以改初始血量、位置等 */
      for (const s of this.sides) {
        for (const f of s.fighters) {
          const ev = { fighter: f, match: this, blocked: false };
          FE.bus.emit('fighter:beforeSpawn', ev);
          FE.bus.emit('fighter:spawned', ev);
        }
      }

      this.placeFighters();
      this.state = 'intro';
      this.stateTime = 0;
      this.timer = this.mode.timeLimit ? this.mode.timeLimit() * 60 : 3600;
      this.log(`比赛开始 · ${this.mode.name}`, 'sys');
      FE.bus.emit('match:start', { match: this });
      this.startRound();
    }

    get fighters() { return this._fighters || []; }

    placeFighters() {
      this.sides[0].fighters.forEach((f, i) => { f.x = -150 - i * 90; f.facing = 1; });
      this.sides[1].fighters.forEach((f, i) => { f.x = 150 + i * 90; f.facing = -1; });
    }

    startRound() {
      this.timer = (this.mode.timeLimit ? this.mode.timeLimit() : 60) * 60;
      this.state = 'intro';
      this.stateTime = 0;
      this.combat.reset();
      if (this.mode.onRoundStart) this.mode.onRoundStart(this);
      // 先重置（reset 会把位置清零），再摆位，否则站位会被覆盖
      this.sides.forEach(s => s.fighters.forEach(f => f.reset(false)));
      this.placeFighters();
      this.refreshFighters();
      this.flash('ROUND ' + this.round, 1.1);
      FE.bus.emit('round:start', { match: this, round: this.round });
      this.log(`—— 第 ${this.round} 回合 ——`, 'sys');
    }

    refreshFighters() {
      this._fighters = [];
      for (const s of this.sides) {
        for (const f of s.activeFighters()) this._fighters.push(f);
      }
      for (const g of (this.ghosts || [])) this._fighters.push(g);
    }

    sideName(i) { return i === 0 ? 'P1' : 'P2'; }

    opponentOf(f) {
      let best = null, bd = 1e9;
      for (const o of this.fighters) {
        if (o.side === f.side || !o.active) continue;
        const d = Math.abs(o.x - f.x);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    /* ---------------- 钩子辅助 ---------------- */
    log(msg, type) {
      const rec = { msg, type: type || 'sys', frame: this.frame };
      this.logs.push(rec);
      if (this.logs.length > 120) this.logs.shift();
      FE.bus.emit('ui:log', rec);
    }

    spawnFx(type, x, y, opts) {
      opts = opts || {};
      this.fx.push({
        type, x, y,
        t: 0,
        life: opts.life || (type === 'hit' ? 18 : type === 'burst' ? 26 : 14),
        element: opts.element || 'neutral',
        power: opts.power || 1,
        size: opts.size || 1,
        owner: opts.owner || null,
        seed: Math.random() * 999
      });
      if (this.fx.length > 160) this.fx.shift();
    }

    shake(v) { this.shakeAmt = Math.max(this.shakeAmt, v); }

    /** 投射物生成（转发给战斗系统） */
    spawnProjectile(f, move) {
      return this.combat.spawnProjectile(f, move);
    }

    flash(text, dur) { this.bigText = { text, t: 0, life: (dur || 1) * 60 }; }

    onKO(f) {
      if (this.mode.onFighterKO) this.mode.onFighterKO(this, f);
      this.log(`${f.def.name} 被击倒`, 'hit');
      if (this.state === 'fight') {
        this.state = 'ko';
        this.stateTime = 0;
        this.flash('K.O.', 1.4);
        this.shake(18);
      }
    }

    /* ---------------- 主更新 ---------------- */
    update(dt) {
      this.frame++;
      FE.bus.emit('engine:frame', { frame: this.frame, match: this });

      this.stateTime += dt;
      if (this.shakeAmt > 0) { this.shakeAmt *= Math.pow(0.86, dt); if (this.shakeAmt < 0.4) this.shakeAmt = 0; }
      if (this.bigText) {
        this.bigText.t += dt;
        if (this.bigText.t > this.bigText.life) this.bigText = null;
      }
      this.fx.forEach(f => f.t += dt);
      this.fx = this.fx.filter(f => f.t < f.life);

      /* 幽灵（协战）清理 */
      if (this.ghosts && this.ghosts.length) {
        this.ghosts = this.ghosts.filter(g => g.ghostLife > 0 && g.active);
        this.ghosts.forEach(g => g.ghostLife -= dt);
      }

      this.refreshFighters();

      /* 回合流程 */
      if (this.state === 'intro') {
        if (this.stateTime > 70) {
          this.state = 'fight';
          this.stateTime = 0;
          this.flash('FIGHT!', 0.55);
          FE.bus.emit('round:fight', { match: this });
        }
        this.updateFighters(dt * 0.6);
        return;
      }
      if (this.state === 'ko') {
        this.updateFighters(dt);
        this.combat.update(dt);
        if (this.stateTime > 100) this.endRound(this.lastWinner());
        return;
      }
      if (this.state === 'roundend') {
        this.updateFighters(dt);
        if (this.stateTime > 80) this.nextRound();
        return;
      }
      if (this.state === 'matchend') {
        this.updateFighters(dt);
        return;
      }

      /* 战斗中 */
      FE.bus.emit('round:countdown', { match: this, timer: this.timer });
      this.timer -= dt;
      if (this.timer <= 0) {
        const a = this.sides[0].active(), b = this.sides[1].active();
        const ha = a ? a.health : 0, hb = b ? b.health : 0;
        this.lastWinnerOverride = ha === hb ? 'draw' : (ha > hb ? 0 : 1);
        this.flash('TIME UP', 1.2);
        this.state = 'ko';
        this.stateTime = 0;
        return;
      }

      this.updateFighters(dt);
      this.combat.update(dt);

      if (this.mode.onTick) this.mode.onTick(this, dt);

      /* 换人 / 协战 */
      this.handleTeamInput(dt);

      /* 胜负判定 */
      const res = this.mode.checkRoundEnd(this);
      if (res !== null && res !== undefined && this.state === 'fight') {
        if (res === 'draw') {
          this.state = 'ko'; this.stateTime = 0; this.lastWinnerOverride = 'draw';
        } else {
          this.lastWinnerOverride = res;
          this.state = 'ko';
          this.stateTime = 0;
          this.flash('K.O.', 1.2);
        }
      }
    }

    updateFighters(dt) {
      for (const f of this.fighters) {
        // KO 的角色仍要更新物理，好让倒地动画播完
        FE.bus.emit('fighter:preUpdate', { fighter: f, match: this, dt });
        f.update(dt, this);
        FE.bus.emit('fighter:postUpdate', { fighter: f, match: this, dt });
      }
      /* 跳跃意图由输入层写入 pressed.jump */
      for (const f of this.fighters) {
        if (!f.active) continue;
        const inp = f.input;
        if (inp && inp.pressed && inp.pressed.jump && !f.airborne &&
            (f.state === 'idle' || f.state === 'walk_f' || f.state === 'walk_b' || f.state === 'crouch')) {
          f.jump(inp.dir.x);
        }
        if (inp && inp.pressed && inp.pressed.jump && f.airborne) {
          FE.bus.emit('fighter:airJump', { fighter: f, input: inp });
        }
      }
    }

    handleTeamInput(dt) {
      if (this.mode.simultaneous) return;
      for (const s of this.sides) {
        const f = s.active();
        if (!f || !f.input || !f.input.pressed) continue;
        if (f.input.pressed.switch && this.mode.teamSize > 1) {
          const r = s.reserve();
          if (r) {
            const idx = s.fighters.indexOf(r);
            s.switchTo(idx);
          }
        }
        if (f.input.pressed.assist && this.mode.teamSize > 1 && s.assistTimer <= 0) {
          this.spawnAssist(s);
          s.assistTimer = this.mode.assistCooldown || 240;
        }
      }
    }

    /** 协战：临时幽灵角色出场打一招就走 */
    spawnAssist(side) {
      const partner = side.reserve();
      if (!partner) return;
      const ghost = new Fighter(side.index, partner.charId, 9, {});
      ghost.isGhost = true;
      ghost.ghostLife = 90;
      ghost.x = side.active().x - side.active().facing * 70;
      ghost.facing = side.active().facing;
      ghost.invulnTimer = 999;
      ghost.health = ghost.maxHealth;
      const mv = ghost.moves.get(partner.def.tag ? partner.def.tag.assist : 'light') ||
        [...ghost.moves.values()][0];
      ghost.startMove(mv);
      ghost.armorLeft = 1;
      this.ghosts = this.ghosts || [];
      this.ghosts.push(ghost);
      this.spawnFx('switch', ghost.x, 110, { owner: ghost });
      this.log(`协战：${partner.def.name}`, 'sys');
      FE.bus.emit('side:assist', { side, ghost });
    }

    lastWinner() {
      if (this.lastWinnerOverride !== undefined) return this.lastWinnerOverride;
      const a = this.sides[0].alive(), b = this.sides[1].alive();
      if (a && !b) return 0;
      if (b && !a) return 1;
      return 'draw';
    }

    endRound(winner) {
      this.state = 'roundend';
      this.stateTime = 0;
      if (winner === 0 || winner === 1) {
        this.sides[winner].wins++;
        this.flash(this.sideName(winner) + ' WIN', 1.2);
      } else {
        this.flash('DRAW', 1.2);
      }
      this.log(`回合结束：${winner === 'draw' ? '平局' : this.sideName(winner) + ' 胜'}`, 'sys');
      FE.bus.emit('round:end', { match: this, winner });
      this.lastWinnerOverride = undefined;
      this.refreshFighters();
    }

    nextRound() {
      const need = this.mode.roundsToWin || 2;
      const w0 = this.sides[0].wins, w1 = this.sides[1].wins;
      if (w0 >= need || w1 >= need) {
        this.winner = w0 > w1 ? 0 : 1;
        this.state = 'matchend';
        this.stateTime = 0;
        this.stats.duration = (performance.now() - this.stats.startTime) / 1000;
        this.stats.maxCombo = Math.max(this.sides[0].fighters[0].maxCombo || 0, this.sides[1].fighters[0].maxCombo || 0);
        FE.bus.emit('match:end', { match: this, winner: this.winner });
        this.log(`比赛结束：${this.sideName(this.winner)} 获胜`, 'sys');
        if (this.onMatchEnd) this.onMatchEnd(this);
      } else {
        this.round++;
        this.startRound();
      }
    }
  }

  /* ---------------- 引擎 ---------------- */
  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.match = null;
      this.renderer = null;
      this.acc = 0;
      this.lastTs = 0;
      this.running = false;
      this.fps = 60;
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.onFrame = null;
      this.slow = false;
      this.paused = false;
    }

    setRenderer(id) {
      const def = FE.renderers.get(id);
      if (!def) return false;
      if (this.renderer && this.renderer.destroy) this.renderer.destroy();
      this.renderer = def.create(this);
      FE.config.renderer = id;
      FE.bus.emit('render:backend', { id, renderer: this.renderer });
      return true;
    }

    startMatch(opts) {
      this.match = new Match(opts);
      this.match.onMatchEnd = m => { if (this.onMatchEnd) this.onMatchEnd(m); };
      FE.bus.emit('engine:matchCreated', { match: this.match });
      return this.match;
    }

    loop(ts) {
      if (!this.running) return;
      if (!this.lastTs) this.lastTs = ts;
      let ms = ts - this.lastTs;
      this.lastTs = ts;
      if (ms > 100) ms = 100;                  // 防止切后台后跳帧

      this.fpsTimer += ms;
      this.frameCount++;
      if (this.fpsTimer >= 500) {
        this.fps = Math.round(this.frameCount * 1000 / this.fpsTimer);
        this.frameCount = 0;
        this.fpsTimer = 0;
      }

      const speed = this.paused ? 0 : (this.slow ? 0.32 : 1);
      this.acc += ms * speed;

      let steps = 0;
      while (this.acc >= FRAME_MS && steps < 5) {
        FE.bus.emit('engine:beforeUpdate', { engine: this, match: this.match });
        this.step();
        FE.bus.emit('engine:afterUpdate', { engine: this, match: this.match });
        this.acc -= FRAME_MS;
        steps++;
      }
      if (steps >= 5) this.acc = 0;

      this.render();
      if (this.onFrame) this.onFrame(this);
      requestAnimationFrame(t => this.loop(t));
    }

    step() {
      if (this.paused) return;
      /* 后端可以接管仿真（例如 C 内核跑自己的定长仿真） */
      if (this.renderer && this.renderer.ownsSimulation) {
        this.renderer.step();
        return;
      }
      if (!this.match) return;
      /* 输入采样 */
      if (FE.input) FE.input.pollAll(this.match);
      this.match.update(1);
    }

    render() {
      if (!this.renderer) return;
      FE.bus.emit('engine:beforeRender', { engine: this, renderer: this.renderer });
      this.renderer.draw(this.match, 1);
      FE.bus.emit('engine:afterRender', { engine: this, renderer: this.renderer });
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTs = 0;
      requestAnimationFrame(t => this.loop(t));
    }

    stop() { this.running = false; }
  }

  FE.Side = Side;
  FE.Match = Match;
  FE.Engine = Engine;
})();
