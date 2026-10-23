/* ==========================================================================
   C 内核的 JS 镜像 (bit-exact mirror of native/nexus.c)
   ==========================================================================
   本文件是 native/nexus.c 的逐行同构移植，不是"另写一个引擎"。

   为什么需要它：本机没有 C 编译器（无 gcc/clang/cl，WSL 被策略禁用，
   也无网络安装），所以浏览器里暂时跑这份镜像。等你有编译器时：

       cd native && gcc -O2 -std=c99 nexus.c -o nexus && ./nexus 900 12345

   它会打印 FINAL_HASH。这个值必须与浏览器 C 模式面板上显示的
   哈希**完全一致**（见 native/GOLDEN.txt）。一致 = 两个内核逐位等价。

   移植时的三条铁律：
     1. C 的 int64 >> 16 是算术右移（向下取整）→ JS 用 Math.floor(a*b/65536)
     2. C 的 int 除法向零截断 → JS 用 Math.trunc(a/b)
     3. 所有 fx 字段写回时保持 int32 → JS 用 |0
   ========================================================================== */
(function (root) {
  'use strict';

  const FX_ONE = 65536;

  /* ---- 常量（与 nexus.c 完全一致） ---- */
  const NK_MAX_FIGHTERS = 2;
  const NK_MAX_PROJ = 8;
  const NK_STAGE_HALF = 640 * FX_ONE;
  const NK_GRAVITY = 51118;
  const NK_JUMP = 930611;
  const NK_WALK = 180224;
  const NK_BACK = 140902;
  const NK_AIRCTRL = 29491;
  const NK_FRICTION = 52428;
  const NK_AIRFRIC = 63897;
  const NK_STUNFRIC = 58982;
  const NK_MAX_HP = 1000;
  const NK_MAX_METER = 100;

  const ST = {
    IDLE: 0, WALK_F: 1, WALK_B: 2, CROUCH: 3, AIR: 4,
    ATTACK: 5, HITSTUN: 6, BLOCKSTUN: 7, KO: 8
  };
  const ST_NAME = ['idle', 'walk_f', 'walk_b', 'crouch', 'air', 'attack', 'hitstun', 'blockstun', 'ko'];

  const MV = { LIGHT: 0, HEAVY: 1, SWEEP: 2, UPPER: 3, FIRE: 4, SUPER: 5 };
  const HT = { MID: 0, LOW: 1, OVERHEAD: 2, UNBLOCKABLE: 3 };
  const MK = { NORMAL: 0, PROJECTILE: 1, LAUNCHER: 2 };

  const BTN = { LIGHT: 1, HEAVY: 2, SPECIAL: 4, SUPER: 8, JUMP: 16 };

  /* name, startup, active, recovery, hbx, hby, hbw, hbh,
     dmg, hitstun, blockstun, hitstop, kbx, kby, height, cost, gain, kind */
  const MOVES = [
    { id: 'light', name: '轻击', startup: 4, active: 3, recovery: 7, hbx: 44 * FX_ONE, hby: 116 * FX_ONE, hbw: 54, hbh: 24, dmg: 36, hitstun: 15, blockstun: 9, hitstop: 5, kbx: 98304, kby: 0, height: HT.MID, cost: 0, gain: 5, kind: MK.NORMAL },
    { id: 'heavy', name: '重击', startup: 9, active: 4, recovery: 15, hbx: 50 * FX_ONE, hby: 110 * FX_ONE, hbw: 62, hbh: 32, dmg: 82, hitstun: 21, blockstun: 13, hitstop: 8, kbx: 222822, kby: 0, height: HT.MID, cost: 0, gain: 9, kind: MK.NORMAL },
    { id: 'sweep', name: '扫腿', startup: 10, active: 4, recovery: 22, hbx: 48 * FX_ONE, hby: 26 * FX_ONE, hbw: 74, hbh: 26, dmg: 68, hitstun: 26, blockstun: 13, hitstop: 9, kbx: 235929, kby: 360448, height: HT.LOW, cost: 0, gain: 9, kind: MK.NORMAL },
    { id: 'upper', name: '升击', startup: 5, active: 5, recovery: 26, hbx: 40 * FX_ONE, hby: 130 * FX_ONE, hbw: 58, hbh: 76, dmg: 96, hitstun: 28, blockstun: 14, hitstop: 10, kbx: 157286, kby: 622592, height: HT.MID, cost: 0, gain: 11, kind: MK.LAUNCHER },
    { id: 'fire', name: '气弹', startup: 12, active: 2, recovery: 24, hbx: 52 * FX_ONE, hby: 104 * FX_ONE, hbw: 0, hbh: 0, dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0, kbx: 0, kby: 0, height: HT.MID, cost: 0, gain: 12, kind: MK.PROJECTILE },
    { id: 'super', name: '超必', startup: 8, active: 10, recovery: 30, hbx: 46 * FX_ONE, hby: 90 * FX_ONE, hbw: 150, hbh: 130, dmg: 240, hitstun: 34, blockstun: 20, hitstop: 16, kbx: 524288, kby: 393216, height: HT.MID, cost: 50, gain: 0, kind: MK.NORMAL }
  ];

  /* ---- 定点运算 ---- */
  const fxmul = (a, b) => Math.floor((a * b) / 65536);      // == (int64)a*b >> 16
  const fxdiv = (a, b) => (b === 0 ? 0 : Math.trunc((a * 65536) / b));
  const fxabs = a => (a < 0 ? -a : a);
  const idiv = (a, b) => Math.trunc(a / b);
  const toF = v => v / 65536;

  /* ---- 状态 ---- */
  function mkFighter(i) {
    return {
      x: i === 0 ? -150 * FX_ONE : 150 * FX_ONE,
      y: 0, vx: 0, vy: 0,
      facing: i === 0 ? 1 : -1,
      state: ST.IDLE, stateTime: 0,
      moveId: -1, moveFrame: 0,
      health: NK_MAX_HP, meter: 0,
      hitstop: 0, stun: 0, invuln: 0, armor: 0,
      airborne: 0, combo: 0, comboDmg: 0, comboTimer: 0,
      hitReg: 0, crouching: 0
    };
  }
  function mkProj() {
    return { active: 0, owner: 0, x: 0, y: 0, vx: 0, w: 0, h: 0, life: 0, dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0, kbx: 0, kby: 0 };
  }

  class CKernel {
    constructor(seed) {
      this.f = [mkFighter(0), mkFighter(1)];
      this.p = [];
      for (let i = 0; i < NK_MAX_PROJ; i++) this.p.push(mkProj());
      this.in = [{ dx: 0, dy: 0, btn: 0 }, { dx: 0, dy: 0, btn: 0 }];
      this.rng = (seed ? seed : 1) >>> 0;
      this.frame = 0;
      this.hash = 0x811c9dc5 >>> 0;
      this.timer = 60 * 60;
      this.winner = -1;
      this.replayLen = 0;
      this.history = [];        // 供面板显示
    }

    /* --- 确定性随机 --- */
    rand() {
      let x = this.rng >>> 0;
      x = (x ^ (x << 13)) >>> 0;
      x = (x ^ (x >>> 17)) >>> 0;
      x = (x ^ (x << 5)) >>> 0;
      this.rng = x;
      return x;
    }

    /* --- 几何 --- */
    overlap(ax, ay, aw, ah, bx, by, bw, bh) {
      const aHalf = idiv(aw * FX_ONE, 2);
      const bHalf = idiv(bw * FX_ONE, 2);
      let dx = ax - bx;
      if (dx < 0) dx = -dx;
      if (dx >= aHalf + bHalf) return 0;
      if (ay + ah * FX_ONE <= by) return 0;
      if (by + bh * FX_ONE <= ay) return 0;
      return 1;
    }

    canAct(f) {
      return f.state === ST.IDLE || f.state === ST.WALK_F || f.state === ST.WALK_B ||
        f.state === ST.CROUCH || f.state === ST.AIR;
    }

    select(f, inp) {
      const crouch = (inp.dy > 0) && !f.airborne;
      const up = inp.dy < 0;
      const grounded = !f.airborne;
      if (inp.btn & BTN.SUPER) {
        if (f.meter >= MOVES[MV.SUPER].cost) return MV.SUPER;
      }
      if (inp.btn & BTN.SPECIAL) {
        if (grounded) return MV.FIRE;
      }
      if (inp.btn & BTN.HEAVY) {
        if (grounded && up) return MV.UPPER;
        if (grounded && crouch) return MV.SWEEP;
        if (grounded) return MV.HEAVY;
      }
      if (inp.btn & BTN.LIGHT) {
        if (grounded) return MV.LIGHT;
      }
      return -1;
    }

    startMove(idx, mv) {
      const f = this.f[idx];
      const m = MOVES[mv];
      if (m.cost > 0 && f.meter < m.cost) return;
      f.meter -= m.cost;
      f.moveId = mv;
      f.moveFrame = 0;
      f.hitReg = 0;
      f.armor = (mv === MV.SUPER) ? 1 : 0;
      f.invuln = (mv === MV.SUPER) ? 12 : (mv === MV.UPPER ? 6 : 0);
      f.state = ST.ATTACK;
      f.stateTime = 0;
    }

    groundMove(idx) {
      const f = this.f[idx];
      const inp = this.in[idx];
      if (inp.dy > 0) { f.state = ST.CROUCH; return; }
      if (inp.dx === 0) { f.state = ST.IDLE; return; }
      if (inp.dx === f.facing) {
        f.vx = NK_WALK;
        f.state = ST.WALK_F;
      } else {
        f.vx = -NK_BACK;
        f.state = ST.WALK_B;
      }
    }

    spawnProj(idx) {
      for (let i = 0; i < NK_MAX_PROJ; i++) {
        if (!this.p[i].active) {
          const f = this.f[idx];
          const p = this.p[i];
          p.active = 1;
          p.owner = idx;
          p.x = (f.x + f.facing * (62 * FX_ONE)) | 0;
          p.y = (f.y + 104 * FX_ONE) | 0;
          p.vx = f.facing * 622592;
          p.w = 34; p.h = 30; p.life = 110;
          p.dmg = 62; p.hitstun = 20; p.blockstun = 12; p.hitstop = 7;
          p.kbx = 209715; p.kby = 78643;
          return;
        }
      }
    }

    applyHit(ai, vi, m) {
      const a = this.f[ai];
      const v = this.f[vi];
      const vin = this.in[vi];

      let scaleQ = 65536;
      for (let i = 0; i < a.combo && i < 12; i++) scaleQ = idiv(scaleQ * 87, 100);
      if (scaleQ < 14418) scaleQ = 14418;

      let blocked = 0;
      if (!v.airborne && v.state !== ST.ATTACK && m.height !== HT.UNBLOCKABLE) {
        if (vin.dx === -v.facing) {
          blocked = 1;
          if (m.height === HT.LOW && !(vin.dy > 0)) blocked = 0;
          if (m.height === HT.OVERHEAD && (vin.dy > 0)) blocked = 0;
        }
      }

      let dmg = idiv(m.dmg * scaleQ, 65536);
      if (blocked) dmg = idiv(dmg * 14, 100);

      v.health -= dmg;
      if (v.health < 0) v.health = 0;
      a.meter += m.gain;
      if (a.meter > NK_MAX_METER) a.meter = NK_MAX_METER;
      v.meter += blocked ? 2 : 3;
      if (v.meter > NK_MAX_METER) v.meter = NK_MAX_METER;

      if (blocked) {
        v.state = ST.BLOCKSTUN;
        v.stun = m.blockstun;
        v.hitstop = idiv(m.hitstop * 6, 10);
        a.hitstop = idiv(m.hitstop * 6, 10);
        v.vx = (v.x > a.x ? 1 : -1) * idiv(m.kbx, 2);
      } else {
        v.facing = (a.x > v.x) ? 1 : -1;
        v.state = ST.HITSTUN;
        v.stun = m.hitstun;
        v.hitstop = m.hitstop;
        a.hitstop = m.hitstop;
        v.vx = (v.x > a.x ? 1 : -1) * m.kbx;
        if (m.kby > 0) {
          v.airborne = 1;
          v.vy = m.kby;
        }
        a.combo += 1;
        a.comboDmg += dmg;
        a.comboTimer = m.hitstun;
      }

      if (v.health <= 0) {
        v.state = ST.KO;
        v.vy = 7 * FX_ONE;
        v.vx = (v.x > a.x ? 1 : -1) * 5 * FX_ONE;
        v.airborne = 1;
      }
    }

    resolve() {
      for (let ai = 0; ai < NK_MAX_FIGHTERS; ai++) {
        const a = this.f[ai];
        if (a.state !== ST.ATTACK || a.moveId < 0 || a.hitReg) continue;
        const m = MOVES[a.moveId];
        if (m.kind === MK.PROJECTILE) continue;
        if (a.moveFrame < m.startup) continue;
        if (a.moveFrame >= m.startup + m.active) continue;

        const vi = 1 - ai;
        const v = this.f[vi];
        if (v.state === ST.KO || v.invuln > 0) continue;

        const hx = (a.x + a.facing * m.hbx) | 0;
        const hy = (a.y + m.hby) | 0;
        const uh = (v.state === ST.CROUCH || v.crouching) ? 112 : 176;

        if (this.overlap(hx, hy, m.hbw, m.hbh, v.x, v.y, 54, uh)) {
          if (v.armor > 0 && v.state === ST.ATTACK) {
            v.armor -= 1;
            v.health -= idiv(m.dmg * 6, 10);
            if (v.health < 0) v.health = 0;
            v.hitstop = m.hitstop;
            a.hitReg = 1;
            continue;
          }
          this.applyHit(ai, vi, m);
          a.hitReg = 1;
        }
      }
    }

    updateProj() {
      for (let i = 0; i < NK_MAX_PROJ; i++) {
        const p = this.p[i];
        if (!p.active) continue;
        p.x = (p.x + p.vx) | 0;
        p.life -= 1;
        if (p.life <= 0 || p.x < -NK_STAGE_HALF - 80 * FX_ONE || p.x > NK_STAGE_HALF + 80 * FX_ONE) {
          p.active = 0;
          continue;
        }
        const vi = 1 - p.owner;
        const v = this.f[vi];
        if (v.state === ST.KO || v.invuln > 0) continue;
        const uh = (v.state === ST.CROUCH || v.crouching) ? 112 : 176;
        if (this.overlap(p.x, p.y, p.w, p.h, v.x, v.y, 54, uh)) {
          const tmp = Object.assign({}, MOVES[MV.LIGHT], {
            dmg: p.dmg, hitstun: p.hitstun, blockstun: p.blockstun,
            hitstop: p.hitstop, kbx: p.kbx, kby: p.kby, height: HT.MID
          });
          this.applyHit(p.owner, vi, tmp);
          p.active = 0;
        }
      }
    }

    stepFighter(idx) {
      const f = this.f[idx];
      const inp = this.in[idx];

      if (f.hitstop > 0) { f.hitstop -= 1; return; }
      if (f.invuln > 0) f.invuln -= 1;
      f.stateTime += 1;
      if ((this.frame & 15) === 0 && f.meter < NK_MAX_METER) f.meter += 1;

      /* 连段计时：对手脱离硬直后清零 */
      if (f.comboTimer > 0) {
        f.comboTimer -= 1;
        if (f.comboTimer === 0) f.combo = 0;
      }

      const ox = this.f[1 - idx].x;
      if (!f.airborne &&
        (f.state === ST.IDLE || f.state === ST.WALK_F || f.state === ST.WALK_B ||
          f.state === ST.CROUCH || f.state === ST.BLOCKSTUN)) {
        if (ox > f.x + 6 * FX_ONE) f.facing = 1;
        else if (ox < f.x - 6 * FX_ONE) f.facing = -1;
      }

      f.crouching = (inp.dy > 0) && !f.airborne;

      switch (f.state) {
        case ST.HITSTUN:
        case ST.BLOCKSTUN:
          f.stun -= 1;
          if (f.stun <= 0) {
            f.state = f.airborne ? ST.AIR : ST.IDLE;
          }
          break;

        case ST.KO:
          break;

        case ST.ATTACK: {
          const m = MOVES[f.moveId];
          const prev = f.moveFrame;
          f.moveFrame += 1;
          if (m.kind === MK.PROJECTILE && prev < m.startup && f.moveFrame >= m.startup) {
            this.spawnProj(idx);
          }
          if (f.moveFrame >= m.startup + m.active + m.recovery) {
            f.moveId = -1;
            f.state = f.airborne ? ST.AIR : ST.IDLE;
          }
          break;
        }

        case ST.AIR:
          if (inp.dx !== 0) f.vx += inp.dx * NK_AIRCTRL;
          if (f.vx > 589824) f.vx = 589824;
          if (f.vx < -589824) f.vx = -589824;
          break;

        default: {
          const mv = this.select(f, inp);
          if (mv >= 0) { this.startMove(idx, mv); break; }
          this.groundMove(idx);
          break;
        }
      }

      /* 物理 */
      let fr;
      if (f.airborne) fr = NK_AIRFRIC;
      else if (f.state === ST.HITSTUN || f.state === ST.BLOCKSTUN) fr = NK_STUNFRIC;
      else fr = NK_FRICTION;

      const walking = (f.state === ST.WALK_F || f.state === ST.WALK_B);
      if (!walking) {
        f.vx = fxmul(f.vx, fr);
        if (f.vx > -1311 && f.vx < 1311) f.vx = 0;
      }

      f.x = (f.x + f.vx) | 0;
      if (f.x > NK_STAGE_HALF) f.x = NK_STAGE_HALF;
      if (f.x < -NK_STAGE_HALF) f.x = -NK_STAGE_HALF;

      if (f.airborne || f.y > 0) {
        f.vy = (f.vy - NK_GRAVITY) | 0;
        f.y = (f.y + f.vy) | 0;
        if (f.y <= 0) {
          f.y = 0;
          if (f.vy < -FX_ONE) {
            f.airborne = 0;
            f.vy = 0;
            f.vx = idiv(f.vx * 55, 100);
            if (f.state !== ST.KO) {
              f.state = ST.IDLE;
              f.moveId = -1;
              f.stun = 0;
            }
          } else {
            f.airborne = 0;
            f.vy = 0;
          }
        }
      }
    }

    separate() {
      const a = this.f[0], b = this.f[1];
      if (a.airborne || b.airborne) return;
      let d = b.x - a.x;
      const min = 74 * FX_ONE;
      if (d < 0) d = -d;
      if (d < min) {
        const push = idiv(min - d, 2);
        if (b.x > a.x) { a.x -= push; b.x += push; }
        else { a.x += push; b.x -= push; }
      }
    }

    ai(side, out) {
      const f = this.f[side];
      const o = this.f[1 - side];
      out.dx = 0; out.dy = 0; out.btn = 0;
      if (f.state === ST.KO) return;

      const dist = fxabs(o.x - f.x);
      const toward = (o.x > f.x) ? 1 : -1;
      const r = this.rand();
      const act = r % 100;

      if (o.state === ST.ATTACK && dist < 150 * FX_ONE && act < 45) {
        out.dx = -f.facing;
        if (MOVES[o.moveId < 0 ? 0 : o.moveId].height === HT.LOW) out.dy = 1;
        return;
      }

      if (dist < 105 * FX_ONE) {
        if (act < 18) out.btn = BTN.LIGHT;
        else if (act < 34) out.btn = BTN.HEAVY;
        else if (act < 42) { out.btn = BTN.HEAVY; out.dy = 1; }
        else if (act < 50) { out.btn = BTN.HEAVY; out.dy = -1; }
        else if (act < 58 && f.meter >= MOVES[MV.SUPER].cost) out.btn = BTN.SUPER;
        else out.dx = toward;
        return;
      }
      if (dist < 260 * FX_ONE) {
        if (act < 22) out.btn = BTN.HEAVY;
        else if (act < 30) out.btn = BTN.SPECIAL;
        else out.dx = toward;
        return;
      }
      if (act < 26) { out.btn = BTN.SPECIAL; return; }
      out.dx = toward;
    }

    hashState() {
      let h = 2166136261 >>> 0;
      const mix = v => { h = (h ^ (v >>> 0)) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
      mix(this.frame);
      mix(this.rng);
      mix(this.timer);
      mix(this.winner + 2);
      for (let i = 0; i < NK_MAX_FIGHTERS; i++) {
        const f = this.f[i];
        mix(f.x); mix(f.y); mix(f.vx); mix(f.vy);
        mix(f.facing + 4);
        mix(f.state); mix(f.stateTime);
        mix(f.moveId + 2); mix(f.moveFrame);
        mix(f.health); mix(f.meter);
        mix(f.hitstop); mix(f.stun); mix(f.invuln); mix(f.armor);
        mix(f.airborne); mix(f.combo); mix(f.comboDmg); mix(f.comboTimer); mix(f.hitReg);
      }
      for (let i = 0; i < NK_MAX_PROJ; i++) {
        const p = this.p[i];
        mix(p.active);
        if (p.active) { mix(p.owner); mix(p.x); mix(p.y); mix(p.life); }
      }
      return h >>> 0;
    }

    step() {
      this.frame += 1;
      for (let i = 0; i < NK_MAX_FIGHTERS; i++) {
        this.ai(i, this.in[i]);
        this.replayLen++;
      }
      for (let i = 0; i < NK_MAX_FIGHTERS; i++) this.stepFighter(i);
      this.updateProj();
      this.resolve();
      this.separate();

      if (this.timer > 0) this.timer -= 1;

      if (this.winner < 0) {
        const aKo = this.f[0].state === ST.KO;
        const bKo = this.f[1].state === ST.KO;
        if (aKo && bKo) this.winner = 2;
        else if (bKo) this.winner = 0;
        else if (aKo) this.winner = 1;
        else if (this.timer <= 0) {
          if (this.f[0].health === this.f[1].health) this.winner = 2;
          else this.winner = (this.f[0].health > this.f[1].health) ? 0 : 1;
        }
      }

      this.hash = this.hashState();
    }

    /* ---- 给渲染层用的只读快照 ---- */
    snapshot() {
      const conv = f => ({
        x: toF(f.x), y: toF(f.y), vx: toF(f.vx), vy: toF(f.vy),
        facing: f.facing,
        state: f.state, stateName: ST_NAME[f.state],
        stateTime: f.stateTime,
        moveId: f.moveId, moveFrame: f.moveFrame,
        health: f.health, meter: f.meter,
        hitstop: f.hitstop, stun: f.stun, invuln: f.invuln,
        armor: f.armor, airborne: !!f.airborne,
        combo: f.combo, comboDmg: f.comboDmg,
        crouching: !!f.crouching
      });
      return {
        frame: this.frame,
        hash: this.hash,
        timer: this.timer,
        winner: this.winner,
        fighters: this.f.map(conv),
        projectiles: this.p.filter(p => p.active).map(p => ({
          x: toF(p.x), y: toF(p.y), w: p.w, h: p.h, owner: p.owner
        })),
        replayLen: this.replayLen,
        rng: this.rng
      };
    }
  }

  CKernel.ST = ST;
  CKernel.ST_NAME = ST_NAME;
  CKernel.MOVES = MOVES;
  CKernel.MV = MV;
  CKernel.FX_ONE = FX_ONE;
  CKernel.toF = toF;

  root.CKernel = CKernel;
  if (root.FE) root.FE.CKernel = CKernel;
  if (typeof module !== 'undefined' && module.exports) module.exports = CKernel;
})(typeof window !== 'undefined' ? window : globalThis);
