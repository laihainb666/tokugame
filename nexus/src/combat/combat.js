/* ==========================================================
   Combat — 命中解算 / 连段 / 投射物 / 推挤
   ----------------------------------------------------------
   这一层是"规则"，不是"表现"。所有关键节点都会 emit 钩子，
   模组可以：改伤害、改击退、加霸体、拦截命中、插入特效。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const B = () => FE.balance;

  class CombatSystem {
    constructor(match) {
      this.match = match;
      this.projectiles = [];
      this.lastHits = [];       // 用于表现层画命中特效
    }

    reset() {
      this.projectiles.length = 0;
      this.lastHits.length = 0;
    }

    update(dt) {
      this.updateProjectiles(dt);
      this.resolveHits(dt);
      this.separate(dt);
      this.tickCombo(dt);
      this.lastHits = this.lastHits.filter(h => (h.t += dt) < 22);
    }

    /* ---------------- 投射物 ---------------- */
    spawnProjectile(f, move) {
      const pd = move.projectile;
      const ev = {
        fighter: f, move, def: U.clone(pd),
        x: f.x + f.facing * (move.hitbox.x + 10),
        y: f.y + move.hitbox.y,
        dir: f.facing, blocked: false
      };
      FE.bus.emit('combat:projectile', ev);
      if (ev.blocked) return null;
      const p = {
        uid: U.uid('p'),
        owner: f,
        move,
        x: ev.x, y: ev.y,
        vx: ev.dir * ev.def.speed,
        w: ev.def.w, h: ev.def.h,
        life: ev.def.life,
        def: ev.def,
        age: 0,
        element: ev.def.element || 'neutral'
      };
      this.projectiles.push(p);
      this.match.spawnFx('cast', p.x, p.y + p.h / 2, { element: p.element, owner: f });
      return p;
    }

    updateProjectiles(dt) {
      const b = B();
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.x += p.vx * dt;
        p.life -= dt;
        p.age += dt;
        // 拖尾
        if (Math.random() < 0.5) {
          this.match.spawnFx('trail', p.x, p.y + p.h / 2, { element: p.element, life: 12, size: 8 });
        }
        let gone = p.life <= 0 || Math.abs(p.x) > b.stageHalf + 80;
        // 命中检测
        if (!gone) {
          for (const v of this.match.fighters) {
            if (v.side === p.owner.side || !v.active) continue;
            const hu = v.hurtbox();
            const box = { x: p.x, y: p.y, w: p.w, h: p.h };
            if (FE.Fighter.overlap(box, hu)) {
              const res = this.applyHit(p.owner, v, box, p.move, p.def, true);
              gone = true;
              break;
            }
          }
        }
        if (gone) {
          this.match.spawnFx('burst', p.x, p.y + p.h / 2, { element: p.element, size: 26 });
          this.projectiles.splice(i, 1);
        }
      }
    }

    /* ---------------- 近战命中 ---------------- */
    resolveHits(dt) {
      for (const a of this.match.fighters) {
        if (!a.active || a.state !== 'attack' || !a.move) continue;
        const hb = a.hitbox();
        if (!hb) continue;
        // 多段间隔
        if (!a.hitLog) a.hitLog = new Map();
        for (const v of this.match.fighters) {
          if (v.side === a.side || !v.active) continue;
          if (v.invulnTimer > 0) continue;
          if (v.state === 'ko') continue;
          const last = a.hitLog.get(v.uid);
          const interval = a.move.hits > 1 ? a.move.hitInterval : 9999;
          if (last !== undefined && a.moveFrame - last < interval) continue;
          const hu = v.hurtbox();
          if (!FE.Fighter.overlap(hb, hu)) continue;
          this.applyHit(a, v, hb, a.move, a.move, false);
          a.hitLog.set(v.uid, a.moveFrame);
          a.moveHits++;
        }
      }
      // 招式结束清理
      for (const f of this.match.fighters) {
        if (f.state !== 'attack' && f.hitLog) f.hitLog.clear();
      }
    }

    /**
     * 命中解算核心
     * @param {Fighter} a 攻击方
     * @param {Fighter} v 受击方
     * @param {object} box 判定盒
     * @param {object} move 招式
     * @param {object} dmgSrc 伤害来源（投射物用 def）
     * @param {boolean} isProj 是否投射物
     */
    applyHit(a, v, box, move, dmgSrc, isProj) {
      const b = B();

      /* --- 钩子 1：命中前，可取消 --- */
      const pre = {
        attacker: a, victim: v, move, box,
        damage: (dmgSrc.damage || move.damage || 0),
        blocked: false, cancel: false, isProjectile: !!isProj
      };
      FE.bus.emit('combat:beforeHit', pre);
      if (pre.cancel) return null;

      /* --- 格挡判定 --- */
      const canBlock = this.canBlock(v, move);
      const blocked = canBlock && pre.forceBlock !== false;

      /* --- 伤害与硬直 --- */
      let dmg = pre.damage;
      let hitstun = dmgSrc.hitstun || move.hitstun || 14;
      let blockstun = dmgSrc.blockstun || move.blockstun || 10;
      let kb = U.clone(dmgSrc.kb || move.kb || { x: 2, y: 0 });
      let hitstop = dmgSrc.hitstop !== undefined ? dmgSrc.hitstop : (move.hitstop || 6);

      // 连段递减
      const scale = FE.bus.chain('combat:comboScale', this.comboScale(a, v), { attacker: a, victim: v, move });
      dmg *= scale;
      dmg *= b.damageScale;
      if (blocked) dmg *= b.chipScale;
      // 重量修正：重的角色被击退更少
      kb.x *= 1 / Math.max(0.6, v.stats.weight);
      kb.y *= 1 / Math.max(0.7, v.stats.weight);
      // 空中追打：击飞递减
      if (v.airborne) {
        kb.y *= Math.max(0.25, 1 - v.juggleCount * 0.14);
        kb.x *= 0.85;
      }

      const ev = {
        attacker: a, victim: v, move, damage: dmg,
        hitstun, blockstun, kb, hitstop, blocked,
        scale, isProjectile: !!isProj, cancel: false
      };
      FE.bus.emit(blocked ? 'combat:block' : 'combat:hit', ev);
      if (ev.cancel) return null;

      dmg = ev.damage; hitstun = ev.hitstun; blockstun = ev.blockstun;
      kb = ev.kb; hitstop = ev.hitstop;

      /* --- 霸体 --- */
      if (!blocked && v.armorLeft > 0 && v.state === 'attack') {
        v.armorLeft--;
        dmg *= 0.6;
        v.hitstop = hitstop * b.hitstopScale;
        v.health = Math.max(1, v.health - dmg);
        this.match.spawnFx('armor', v.x, v.y + 110, { owner: v });
        this.match.log('霸体吃招', 'hit');
        return { blocked: false, armored: true, damage: dmg };
      }

      /* --- 应用 --- */
      v.health = Math.max(0, v.health - dmg);
      v.hitsTaken++;
      v.flash = 6;
      a.damageDealt += dmg;

      if (blocked) {
        v.stunTimer = blockstun * b.blockstunScale;
        v.setState('blockstun');
        v.vel.x = U.sign(v.x - a.x) * Math.abs(kb.x) * 0.55;
        v.addMeter(b.meterOnBlock * a.stats.meterGain, true);
        a.addMeter(b.meterOnBlock * 0.5, true);
        v.hitstop = hitstop * 0.6 * b.hitstopScale;
        a.hitstop = hitstop * 0.6 * b.hitstopScale;
        this.match.spawnFx('guard', (box.x + v.x) / 2, box.y + box.h / 2, { owner: v });
        this.match.log(`格挡 ${Math.round(dmg)}`, 'hit');
      } else {
        // 受击方朝向攻击方
        v.facing = a.x > v.x ? 1 : -1;
        v.stunTimer = hitstun * b.hitstunScale;
        v.setState('hitstun');
        v.vel.x = U.sign(v.x - a.x) * Math.abs(kb.x);
        if (kb.y > 0.5 || v.airborne) {
          v.airborne = true;
          v.vel.y = Math.max(v.vel.y, kb.y);
          v.juggleCount++;
        }
        if (move.onHit === 'knockdown' || (kb.y > 7)) v.juggleCount = Math.max(v.juggleCount, 2);
        v.hitstop = hitstop * b.hitstopScale;
        a.hitstop = hitstop * b.hitstopScale;
        v.addMeter(b.meterOnTake * v.stats.meterGain, true);
        a.addMeter(b.meterOnHit * a.stats.meterGain, true);
        if (dmgSrc.slow) v.slow = { mul: dmgSrc.slow.mul, frames: dmgSrc.slow.frames };

        // 连段统计
        a.comboCount++;
        a.comboDamage += dmg;
        a.maxCombo = Math.max(a.maxCombo, a.comboCount);
        a.comboResetTimer = 0;

        this.match.spawnFx('hit', (box.x + v.x) / 2, box.y + box.h / 2, {
          element: (move.element || 'neutral'),
          power: Math.min(1.6, dmg / 90),
          owner: a
        });
        this.match.shake(Math.min(14, 3 + dmg * 0.09) * b.screenShakeScale);
        this.match.log(`${a.def.name} → ${move.name} ${Math.round(dmg)}`, 'hit');
      }

      FE.bus.emit('fighter:damaged', { fighter: v, attacker: a, damage: dmg, move, blocked });

      /* --- KO --- */
      if (v.health <= 0) {
        v.setState('ko');
        v.vel.y = 7; v.vel.x = U.sign(v.x - a.x) * 5;
        v.airborne = true;
        FE.bus.emit('fighter:ko', { fighter: v, killer: a });
        this.match.onKO(v);
      }
      return { blocked, damage: dmg };
    }

    canBlock(v, move) {
      if (v.airborne) return false;
      if (move.height === 'unblockable') return false;
      if (v.state === 'attack' || v.state === 'hitstun') return false;
      const inp = v.input || {};
      const holdingBack = inp.dir && inp.dir.x === -v.facing;
      if (!holdingBack) return false;
      if (move.height === 'low' && !(inp.dir.y > 0)) return false;
      if (move.height === 'overhead' && inp.dir.y > 0) return false;
      return true;
    }

    comboScale(a, v) {
      const b = B();
      const n = a.comboCount || 0;
      return Math.max(b.minScaling, Math.pow(b.comboScaling, n));
    }

    tickCombo(dt) {
      for (const f of this.match.fighters) {
        if (f.comboCount > 0) {
          const anyVictimStunned = this.match.fighters.some(o =>
            o.side !== f.side && (o.state === 'hitstun' || o.state === 'blockstun'));
          if (!anyVictimStunned) {
            f.comboResetTimer = (f.comboResetTimer || 0) + dt;
            if (f.comboResetTimer > 12) {
              f.comboCount = 0;
              f.comboDamage = 0;
            }
          } else f.comboResetTimer = 0;
        }
      }
    }

    /** 角色互相推开，避免重叠 */
    separate(dt) {
      const fs = this.match.fighters.filter(f => f.active && !f.airborne && !f.isGhost);
      for (let i = 0; i < fs.length; i++) {
        for (let j = i + 1; j < fs.length; j++) {
          const a = fs[i], b2 = fs[j];
          if (a.side === b2.side) continue;
          const dx = b2.x - a.x;
          const min = 74;
          if (Math.abs(dx) < min) {
            const push = (min - Math.abs(dx)) * 0.5;
            const s = U.sign(dx) || 1;
            a.x -= s * push;
            b2.x += s * push;
          }
        }
      }
    }
  }

  FE.CombatSystem = CombatSystem;
})();
