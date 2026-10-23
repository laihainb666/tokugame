/* ==========================================================
   Fighter — 角色实例 / 状态机 / 物理
   ----------------------------------------------------------
   一个 Fighter = 一份角色预制体 + 一套运行时状态。
   状态机是硬编码的（这是格斗游戏手感的地基，不该被模组乱改），
   但"能做什么"完全由数据决定：招式表、取消规则、判定盒。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const B = () => FE.balance;

  const STATES = ['idle', 'walk_f', 'walk_b', 'crouch', 'dash', 'air', 'attack',
    'hitstun', 'blockstun', 'knockdown', 'wakeup', 'ko', 'taunt'];

  /* 状态 → 是否可被玩家操作 */
  const FREE = { idle: 1, walk_f: 1, walk_b: 1, crouch: 1, air: 1 };

  class Fighter {
    constructor(side, charId, index, opts) {
      opts = opts || {};
      this.uid = U.uid('f');
      this.side = side;                 // 0 = P1, 1 = P2
      this.index = index || 0;          // 队内序号（换人用）
      this.charId = charId;
      this.def = FE.characters.get(charId);
      if (!this.def) throw new Error('未知角色: ' + charId);
      this.moves = FE.moves.resolveList(this.def.moves);
      this.stats = Object.assign(
        { health: 1, walk: 1, dash: 1, jump: 1, weight: 1, gravity: 1, meterGain: 1 },
        this.def.stats || {}
      );
      this.isPlayer = !!opts.isPlayer;
      this.ai = opts.ai || null;
      this.reset(true);
    }

    /* ---------------- 生命周期 ---------------- */
    reset(full) {
      const b = B();
      this.maxHealth = Math.round(b.maxHealth * this.stats.health);
      this.health = this.maxHealth;
      this.meter = full ? 0 : this.meter;
      this.x = 0; this.y = 0;
      this.vel = { x: 0, y: 0 };
      this.facing = this.side === 0 ? 1 : -1;
      this.state = 'idle';
      this.stateTime = 0;
      this.move = null;
      this.moveFrame = 0;
      this.moveHits = 0;
      this.hitstop = 0;
      this.stunTimer = 0;
      this.invulnTimer = 0;
      this.armorLeft = 0;
      this.airborne = false;
      this.airDashes = 1;
      this.juggleCount = 0;
      this.comboCount = 0;
      this.comboDamage = 0;
      this.flash = 0;
      this.slow = null;
      this.blocking = false;
      this.crouching = false;
      this.trail = [];
      this.input = this.input && this.input.dir
        ? this.input
        : { dir: { x: 0, y: 0 }, pressed: {}, buffer: [] };
      this.lastHitBy = null;
      this.hitsTaken = 0;
      this.damageDealt = 0;
      this.maxCombo = 0;
      this.dead = false;
    }

    get alive() { return this.health > 0 && this.state !== 'ko'; }
    get active() { return this.state !== 'ko' && !this.dead; }

    /* ---------------- 几何 ---------------- */
    /** 受击盒：{x:中心, y:底, w, h} */
    hurtbox() {
      const crouch = this.state === 'crouch' || this.crouching ||
        (this.state === 'attack' && this.move && this.move.stance === 'crouch');
      if (this.state === 'knockdown' || this.state === 'ko') {
        return { x: this.x, y: this.y, w: 120, h: 56 };
      }
      const h = this.airborne ? 168 : (crouch ? 112 : 176);
      return { x: this.x, y: this.y, w: 54, h };
    }

    /** 当前招式判定盒（世界坐标），无判定时返回 null */
    hitbox() {
      if (this.state !== 'attack' || !this.move) return null;
      const m = this.move;
      if (m.projectile) return null;
      const f = this.moveFrame;
      if (f < m.activeFrom || f > m.activeTo) return null;
      if (this.moveHits >= m.hits) return null;
      const hb = m.hitbox;
      return {
        x: this.x + this.facing * hb.x,
        y: this.y + hb.y,
        w: hb.w, h: hb.h,
        move: m,
        owner: this
      };
    }

    /** 受击盒与判定盒的 AABB 相交 */
    static overlap(hb, hu) {
      if (!hb || !hu) return false;
      const dx = Math.abs(hb.x - hu.x);
      if (dx * 2 > hb.w + hu.w) return false;
      const a1 = hb.y, a2 = hb.y + hb.h;
      const b1 = hu.y, b2 = hu.y + hu.h;
      return a1 < b2 && b1 < a2;
    }

    /* ---------------- 输入 → 招式 ---------------- */
    /**
     * 从当前输入里挑一个招式。完全数据驱动：
     * 按优先级遍历招式表，第一个满足条件的就执行。
     */
    selectMove(inp) {
      const b = B();
      const grounded = !this.airborne;
      const crouching = grounded && inp.dir.y > 0;
      const canAct = FREE[this.state] === 1;
      const attacking = this.state === 'attack';

      // 取消窗口：正在出招时只能进 cancel 列表里的招
      let cancelAllowed = null;
      if (attacking) {
        const m = this.move;
        const f = this.moveFrame;
        const [from, to] = m.cancelFrom || [0, 999];
        if (f >= from && f <= to) cancelAllowed = m.cancel;
        else return null;
      }

      const list = [...this.moves.values()].sort((a, c) => {
        const pa = (a.priority || 0) + rankOf(a);
        const pc = (c.priority || 0) + rankOf(c);
        return pc - pa;
      });

      for (const m of list) {
        // 按钮
        if (!m.input) continue;
        if (!inp.pressed[m.input]) continue;
        // 能量
        if (m.meterCost > 0 && this.meter < m.meterCost) continue;
        // 姿态
        const st = m.stance;
        if (st === 'stand' && (!grounded || crouching)) continue;
        if (st === 'crouch' && (!grounded || !crouching)) continue;
        if (st === 'air' && grounded) continue;
        // 指令
        if (m.cmd && !FE.input.matchMotion(inp, m.cmd)) continue;
        // 取消规则
        if (cancelAllowed) {
          const ok = cancelAllowed.some(tag =>
            tag === m.id || m.tags.includes(tag) || tag === 'any');
          if (!ok) continue;
        } else if (!canAct) continue;
        // 空中招式需要未落地
        if (this.airborne && st !== 'air' && st !== 'any') continue;
        // 让模组有机会否决或替换
        const ev = { fighter: this, move: m, input: inp, blocked: false };
        FE.bus.emit('move:select', ev);
        if (ev.blocked) continue;
        return ev.move;
      }
      return null;
    }

    /* ---------------- 状态切换 ---------------- */
    setState(s, opts) {
      if (this.state === s && !(opts && opts.force)) return;
      const from = this.state;
      this.state = s;
      this.stateTime = 0;
      this.blocking = false;
      this.crouching = false;
      FE.bus.emit('fighter:stateChange', { fighter: this, from, to: s });
    }

    startMove(m) {
      const ev = { fighter: this, move: m, armor: m.armor || 0, blocked: false };
      FE.bus.emit('move:beforeExecute', ev);
      if (ev.blocked) return false;
      m = ev.move;
      this.move = m;
      this.moveFrame = 0;
      this.moveHits = 0;
      this.armorLeft = ev.armor !== undefined ? ev.armor : (m.armor || 0);
      if (m.invuln) this.invulnTimer = m.invuln[1] - m.invuln[0];
      if (m.meterCost) this.addMeter(-m.meterCost, true);
      if (m.self && m.self.x) this.vel.x = this.facing * m.self.x;
      if (m.self && m.self.y) { this.vel.y = m.self.y; this.airborne = true; }
      this.setState('attack');
      FE.bus.emit('move:afterExecute', { fighter: this, move: m });
      return true;
    }

    addMeter(v, silent) {
      const b = B();
      const before = this.meter;
      this.meter = U.clamp(this.meter + v, 0, b.maxMeter);
      if (!silent && this.meter !== before) {
        FE.bus.emit('fighter:meterChange', { fighter: this, delta: this.meter - before, meter: this.meter });
      }
    }

    heal(v) {
      this.health = Math.min(this.maxHealth, this.health + v);
    }

    /* ---------------- 主更新 ---------------- */
    update(dt, world) {
      const b = B();
      this.flash = Math.max(0, this.flash - dt);
      if (this.hitstop > 0) { this.hitstop -= dt; return; }
      if (this.slow && this.slow.frames > 0) {
        this.slow.frames -= dt;
        if (this.slow.frames <= 0) this.slow = null;
      }
      const spd = this.slow ? this.slow.mul : 1;
      const sdt = dt * spd;

      this.stateTime += sdt;
      if (this.invulnTimer > 0) this.invulnTimer -= sdt;

      const inp = (this.input && this.input.dir)
        ? this.input
        : { dir: { x: 0, y: 0 }, pressed: {}, buffer: [] };

      /* --- 朝向 --- */
      if (!this.airborne && world.opponentOf) {
        const op = world.opponentOf(this);
        if (op && (this.state === 'idle' || this.state === 'walk_f' || this.state === 'walk_b' ||
                   this.state === 'crouch' || this.state === 'blockstun')) {
          const want = op.x > this.x ? 1 : -1;
          if (Math.abs(op.x - this.x) > 6) this.facing = want;
        }
      }

      /* --- 自动回能 --- */
      this.addMeter(b.meterRegen * sdt, true);

      /* --- 状态分支 --- */
      switch (this.state) {
        case 'hitstun':
        case 'blockstun':
          this.stunTimer -= sdt;
          this.vel.x *= Math.pow(0.9, sdt);
          if (this.stunTimer <= 0) {
            this.juggleCount = this.airborne ? this.juggleCount : 0;
            if (this.airborne) this.setState('air');
            else this.setState('idle');
          }
          break;

        case 'knockdown':
          this.vel.x *= Math.pow(0.82, sdt);
          if (this.stateTime > 26) {
            this.setState('wakeup');
            this.invulnTimer = 6;
          }
          break;

        case 'wakeup':
          if (this.stateTime > 16) {
            this.juggleCount = 0;
            this.setState('idle');
          }
          break;

        case 'ko':
          this.vel.x *= Math.pow(0.88, sdt);
          break;

        case 'attack': {
          const m = this.move;
          const prev = Math.floor(this.moveFrame);
          this.moveFrame += sdt;
          const cur = Math.floor(this.moveFrame);
          // 每帧钩子
          const phase = cur < m.startup ? 'startup' : cur <= m.activeTo ? 'active' : 'recovery';
          FE.bus.emit('move:frame', { fighter: this, move: m, frame: cur, phase });
          // 投射物生成
          if (m.projectile && prev < m.startup && cur >= m.startup) {
            world.spawnProjectile(this, m);
          }
          this.vel.x *= Math.pow(0.9, sdt);
          if (this.moveFrame >= m.total) {
            this.move = null;
            this.setState(this.airborne ? 'air' : 'idle');
          } else {
            // 取消窗口内可以接下一招
            const next = this.selectMove(inp);
            if (next && next !== m) { this.startMove(next); break; }
          }
          break;
        }

        case 'dash':
          this.vel.x = this.facing * b.dashSpeed * this.stats.dash * (this.dashDir || 1);
          if (this.stateTime > b.dashFrames) {
            this.setState('idle');
          }
          break;

        case 'air': {
          // 空中控制
          const ax = inp.dir.x;
          if (ax) this.vel.x += ax * b.airControl * sdt * this.stats.walk;
          this.vel.x = U.clamp(this.vel.x, -b.dashSpeed * 1.4, b.dashSpeed * 1.4);
          // 空中出招
          const m = this.selectMove(inp);
          if (m) { this.startMove(m); break; }
          break;
        }

        default: {
          // 地面自由状态
          const m = this.selectMove(inp);
          if (m) { this.startMove(m); break; }
          this.groundMove(sdt, inp, b);
        }
      }

      /* --- 物理 --- */
      if (this.state !== 'dash') {
        const fr = this.airborne ? b.airFriction : b.friction;
        this.vel.x *= Math.pow(fr, sdt);
        if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0;
      }
      this.x += this.vel.x * sdt;
      this.x = U.clamp(this.x, -b.stageHalf, b.stageHalf);

      if (this.airborne || this.y > 0) {
        this.vel.y -= b.gravity * this.stats.gravity * sdt;
        this.y += this.vel.y * sdt;
        if (this.y <= 0) {
          this.y = 0;
          if (this.vel.y < -1) {
            // 落地
            const wasAttack = this.state === 'attack';
            this.airborne = false;
            this.vel.y = 0;
            this.vel.x *= 0.55;
            this.airDashes = 1;
            if (this.state === 'hitstun' && this.stunTimer > 4) {
              this.setState('knockdown');
            } else if (this.state !== 'knockdown' && this.state !== 'ko') {
              this.juggleCount = 0;
              this.setState(wasAttack ? 'idle' : (this.state === 'hitstun' ? 'idle' : this.state));
              this.move = null;
            }
            FE.bus.emit('fighter:land', { fighter: this, hard: true });
          } else {
            this.airborne = false;
            this.vel.y = 0;
          }
        }
      }

      /* --- 拖影 --- */
      if (Math.abs(this.vel.x) > 4 || this.state === 'dash') {
        this.trail.push({ x: this.x, y: this.y, t: 0, facing: this.facing, state: this.state });
        if (this.trail.length > 6) this.trail.shift();
      }
      for (const t of this.trail) t.t += dt;
      this.trail = this.trail.filter(t => t.t < 10);
    }

    /* 地面移动（含冲刺检测） */
    groundMove(dt, inp, b) {
      const x = inp.dir.x, y = inp.dir.y;
      const back = -this.facing;
      this.crouching = y > 0;
      this.blocking = x === back && !this.crouching ? true : (x === back && this.crouching);

      if (y > 0) {
        this.setState('crouch');
        this.vel.x *= Math.pow(0.7, dt);
        return;
      }

      // 双击冲刺
      if (inp.dashDir && !this.airborne) {
        this.dashDir = inp.dashDir;   // 1 前, -1 后
        this.setState('dash');
        this.vel.x = this.facing * b.dashSpeed * this.stats.dash * this.dashDir;
        return;
      }

      if (x === 0) {
        this.setState('idle');
        this.vel.x *= Math.pow(0.62, dt);
        return;
      }
      const forward = x === this.facing;
      this.vel.x = x * (forward ? b.walkSpeed * this.stats.walk : b.backSpeed * this.stats.walk);
      this.setState(forward ? 'walk_f' : 'walk_b');
    }

    /* 跳跃（由输入层直接调用，便于模组改跳跃） */
    jump(dirX) {
      const b = B();
      if (this.airborne) return false;
      const ev = { fighter: this, power: b.jumpPower * this.stats.jump, dirX: dirX || 0, blocked: false };
      FE.bus.emit('fighter:jump', ev);
      if (ev.blocked) return false;
      this.airborne = true;
      this.vel.y = ev.power;
      this.vel.x += ev.dirX * b.walkSpeed * 0.9;
      this.setState('air');
      return true;
    }

    /** 空中冲刺 / 二段跳由模组通过 fighter:jump 或自定义状态实现 */
    airDash(dirX) {
      if (!this.airborne || this.airDashes <= 0) return false;
      this.airDashes--;
      this.vel.x = dirX * B().dashSpeed * 0.85;
      this.vel.y = Math.max(this.vel.y, 1.5);
      return true;
    }
  }

  function rankOf(m) {
    if (m.tags.includes('super')) return 100;
    if (m.tags.includes('special')) return 80;
    if (m.tags.includes('throw')) return 70;
    if (m.input === 'heavy') return 60;
    if (m.input === 'light') return 40;
    return 10;
  }

  FE.Fighter = Fighter;
  FE.STATES = STATES;
})();
