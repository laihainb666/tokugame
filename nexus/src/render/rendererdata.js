/* ==========================================================
   RendererData — 纯内核数据视图
   ----------------------------------------------------------
   第三种"渲染后端"故意不画任何角色：它把内核的原始状态
   直接摊开（状态机、帧数据、判定盒、连段、钩子调用）。
   这证明渲染层与战斗内核完全解耦 —— 同一场比赛，可以
   用三种完全不同的方式呈现。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const MONO = '"JetBrains Mono","Cascadia Mono",Consolas,monospace';
  const C = {
    bg: '#080a0f',
    grid: '#131a26',
    line: '#1e2836',
    txt: '#c7d3e8',
    dim: '#5b6b85',
    key: '#7c8aa5',
    acc: '#ff4d5e',
    ok: '#3ddc97',
    warn: '#ffb02e',
    info: '#4d8dff',
    pu: '#a86bff'
  };

  class RendererData {
    constructor(engine) {
      this.engine = engine;
      this.time = 0;
      this.hookSnap = [];
      this.log = [];
    }
    destroy() {}

    draw(match, dt) {
      const ctx = this.engine.ctx;
      const W = 1280, H = 720;
      this.time += 1 / 60;
      if (!match) return;

      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      this.drawGrid(ctx, W, H);

      /* 顶栏 */
      this.text(ctx, 'KERNEL TELEMETRY', 24, 30, 15, C.txt, 'bold');
      this.text(ctx, `mode=${match.mode.id}  round=${match.round}  phase=${match.state}  frame=${match.frame}`, 24, 52, 11, C.dim);
      this.text(ctx, `fps=${this.engine.fps}  hooks=${FE.bus.totalCalls}  proj=${match.combat.projectiles.length}`, W - 24, 30, 11, C.dim, 'normal', 'right');
      this.text(ctx, `renderer=data (no visuals)`, W - 24, 52, 11, C.dim, 'normal', 'right');

      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(24, 68); ctx.lineTo(W - 24, 68); ctx.stroke();

      /* 两侧角色面板 */
      const p1 = match.sides[0].active();
      const p2 = match.sides[1].active();
      this.drawFighterPanel(ctx, p1, 24, 84, 500, 'P1');
      this.drawFighterPanel(ctx, p2, W - 524, 84, 500, 'P2');

      /* 中间：帧数据 + 判定 + 日志 */
      this.drawCenter(ctx, match, 548, 84, 184, 520);

      /* 底部：连段与能量 */
      this.drawBottom(ctx, match, 24, 620, W - 48, 78);
    }

    drawGrid(ctx, W, H) {
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    }

    text(ctx, s, x, y, size, color, weight, align) {
      ctx.font = `${weight || 'normal'} ${size}px ${MONO}`;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s, x, y);
      ctx.textAlign = 'left';
    }

    bar(ctx, x, y, w, h, v, color, bg) {
      ctx.fillStyle = bg || '#151d29';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * U.clamp(v, 0, 1), h);
    }

    drawFighterPanel(ctx, f, x, y, w, tag) {
      const h = 512;
      ctx.fillStyle = '#0c1119';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (!f) {
        this.text(ctx, `${tag} — 无角色`, x + 16, y + 30, 13, C.dim);
        return;
      }
      const pal = f.def.palette;
      ctx.fillStyle = pal.main;
      ctx.fillRect(x, y, 3, h);

      /* 标题 */
      this.text(ctx, `${tag}  ${f.def.name} / ${f.def.title}`, x + 16, y + 28, 15, C.txt, 'bold');
      this.text(ctx, f.def.archetype, x + 16, y + 48, 11, C.dim);
      this.text(ctx, `uid=${f.uid}`, x + w - 16, y + 28, 10, C.dim, 'normal', 'right');

      /* 血量 */
      this.text(ctx, 'HP', x + 16, y + 78, 10, C.key);
      this.bar(ctx, x + 48, y + 68, w - 130, 12, f.health / f.maxHealth, pal.main);
      this.text(ctx, `${Math.round(f.health)}/${f.maxHealth}`, x + w - 16, y + 78, 10, C.txt, 'normal', 'right');

      /* 能量 */
      this.text(ctx, 'MT', x + 16, y + 98, 10, C.key);
      this.bar(ctx, x + 48, y + 88, w - 130, 10, f.meter / FE.balance.maxMeter, C.warn);
      this.text(ctx, `${Math.round(f.meter)}`, x + w - 16, y + 98, 10, C.txt, 'normal', 'right');

      /* 状态机 */
      const sy = y + 122;
      this.text(ctx, 'STATE MACHINE', x + 16, sy, 10, C.dim);
      const states = ['idle', 'walk_f', 'walk_b', 'crouch', 'dash', 'air', 'attack', 'hitstun', 'blockstun', 'knockdown', 'wakeup', 'ko'];
      const cols = 4, cw = (w - 32) / cols;
      states.forEach((s, i) => {
        const cx = x + 16 + (i % cols) * cw;
        const cy = sy + 12 + Math.floor(i / cols) * 22;
        const on = f.state === s;
        ctx.fillStyle = on ? pal.main : '#131b26';
        ctx.fillRect(cx, cy, cw - 6, 18);
        this.text(ctx, s, cx + 6, cy + 13, 9.5, on ? '#fff' : C.dim, on ? 'bold' : 'normal');
      });

      /* 帧数据 */
      const fy = sy + 96;
      this.text(ctx, 'FRAME DATA', x + 16, fy, 10, C.dim);
      const m = f.move;
      if (m) {
        this.text(ctx, `${m.id}  ${m.name}`, x + 16, fy + 20, 12, C.txt, 'bold');
        const total = m.total;
        const bw = w - 32, bx = x + 16, by = fy + 30;
        const sW = bw * m.startup / total;
        const aW = bw * m.active / total;
        const rW = bw * m.recovery / total;
        ctx.fillStyle = '#2a3245'; ctx.fillRect(bx, by, sW, 16);
        ctx.fillStyle = C.acc; ctx.fillRect(bx + sW, by, aW, 16);
        ctx.fillStyle = C.info; ctx.fillRect(bx + sW + aW, by, rW, 16);
        // 播放头
        const px = bx + bw * U.clamp(f.moveFrame / total, 0, 1);
        ctx.fillStyle = '#fff';
        ctx.fillRect(px - 1, by - 4, 2, 24);
        this.text(ctx, `${Math.floor(f.moveFrame)}/${total}`, x + w - 16, by + 14, 10, C.txt, 'normal', 'right');
        // 详细数值
        const rows = [
          ['startup', m.startup, C.warn],
          ['active', m.active, C.acc],
          ['recovery', m.recovery, C.info],
          ['damage', m.damage, C.ok],
          ['hitstun', m.hitstun, C.txt],
          ['hitbox', `${m.hitbox.w}×${m.hitbox.h}`, C.pu]
        ];
        rows.forEach((r, i) => {
          const rx = x + 16 + (i % 3) * ((w - 32) / 3);
          const ry = by + 42 + Math.floor(i / 3) * 20;
          this.text(ctx, r[0], rx, ry, 9.5, C.dim);
          this.text(ctx, String(r[1]), rx + 62, ry, 10.5, r[2]);
        });
      } else {
        this.text(ctx, '— 无招式进行中 —', x + 16, fy + 22, 11, C.dim);
      }

      /* 运动学 */
      const ky = fy + 130;
      this.text(ctx, 'KINEMATICS', x + 16, ky, 10, C.dim);
      const krows = [
        ['pos.x', U.fmt(f.x), C.txt], ['pos.y', U.fmt(f.y), C.txt],
        ['vel.x', U.fmt(f.vel.x), C.info], ['vel.y', U.fmt(f.vel.y), C.info],
        ['facing', f.facing > 0 ? '+1 →' : '-1 ←', C.ok],
        ['airborne', String(f.airborne), f.airborne ? C.warn : C.dim],
        ['hitstop', U.fmt(f.hitstop), C.acc],
        ['invuln', U.fmt(Math.max(0, f.invulnTimer)), C.pu],
        ['armor', String(f.armorLeft), C.warn],
        ['juggle', String(f.juggleCount), C.txt]
      ];
      krows.forEach((r, i) => {
        const rx = x + 16 + (i % 2) * ((w - 32) / 2);
        const ry = ky + 18 + Math.floor(i / 2) * 19;
        this.text(ctx, r[0], rx, ry, 9.5, C.dim);
        this.text(ctx, r[1], rx + 66, ry, 10.5, r[2]);
      });

      /* 判定盒 */
      const hy = ky + 118;
      this.text(ctx, 'HITBOX (world)', x + 16, hy, 10, C.dim);
      const hb = f.hitbox();
      if (hb) {
        this.text(ctx, `x=${U.fmt(hb.x)} y=${U.fmt(hb.y)} w=${hb.w} h=${hb.h}`, x + 16, hy + 18, 10.5, C.acc);
        this.text(ctx, `height=${f.move.height}  hits=${f.moveHits}/${f.move.hits}`, x + 16, hy + 34, 10, C.dim);
      } else {
        this.text(ctx, 'null', x + 16, hy + 18, 10.5, C.dim);
      }
      const hu = f.hurtbox();
      this.text(ctx, 'HURTBOX', x + w / 2 + 10, hy, 10, C.dim);
      this.text(ctx, `w=${hu.w} h=${hu.h}`, x + w / 2 + 10, hy + 18, 10.5, C.info);

      /* 连段 */
      const cy2 = y + h - 46;
      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(x + 16, cy2 - 14); ctx.lineTo(x + w - 16, cy2 - 14); ctx.stroke();
      this.text(ctx, 'COMBO', x + 16, cy2 + 4, 10, C.dim);
      this.text(ctx, `${f.comboCount}`, x + 66, cy2 + 6, 18, f.comboCount > 0 ? C.warn : C.dim, 'bold');
      this.text(ctx, 'DMG', x + 120, cy2 + 4, 10, C.dim);
      this.text(ctx, `${Math.round(f.comboDamage)}`, x + 168, cy2 + 6, 14, C.txt, 'bold');
      this.text(ctx, 'MAX', x + 250, cy2 + 4, 10, C.dim);
      this.text(ctx, `${f.maxCombo}`, x + 292, cy2 + 6, 14, C.txt, 'bold');
      this.text(ctx, `taken=${f.hitsTaken} dealt=${Math.round(f.damageDealt)}`, x + w - 16, cy2 + 4, 10, C.dim, 'normal', 'right');
    }

    drawCenter(ctx, match, x, y, w, h) {
      ctx.fillStyle = '#0c1119';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      this.text(ctx, 'MATCH', x + 14, y + 22, 10, C.dim);
      this.text(ctx, `${match.mode.short}`, x + 14, y + 44, 18, C.txt, 'bold');
      const t = Math.ceil(match.timer / 60);
      this.text(ctx, String(t).padStart(2, '0'), x + w - 14, y + 46, 24, t <= 10 ? C.acc : C.txt, 'bold', 'right');

      // 比分
      this.text(ctx, `P1 ${match.sides[0].wins}`, x + 14, y + 68, 11, C.info);
      this.text(ctx, `${match.sides[1].wins} P2`, x + w - 14, y + 68, 11, C.acc, 'normal', 'right');

      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(x + 14, y + 80); ctx.lineTo(x + w - 14, y + 80); ctx.stroke();

      // 事件流
      this.text(ctx, 'EVENT STREAM', x + 14, y + 100, 10, C.dim);
      const logs = match.logs.slice(-22);
      logs.forEach((l, i) => {
        const ly = y + 120 + i * 15;
        if (ly > y + h - 10) return;
        const col = l.type === 'hit' ? C.warn : l.type === 'sys' ? C.info : C.dim;
        this.text(ctx, String(l.frame).padStart(5, ' '), x + 14, ly, 9, C.dim);
        this.text(ctx, l.msg, x + 56, ly, 9.5, col);
      });
    }

    drawBottom(ctx, match, x, y, w, h) {
      ctx.fillStyle = '#0c1119';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      /* 钩子调用条形图 */
      this.text(ctx, 'HOOK CALLS', x + 14, y + 18, 9.5, C.dim);
      const inv = FE.bus.inventory().slice(0, 9);
      const max = Math.max(1, ...inv.map(i => i.calls));
      inv.forEach((hk, i) => {
        const bx = x + 14 + i * 128;
        const bw = 112;
        const ratio = hk.calls / max;
        this.text(ctx, hk.name, bx, y + 36, 8.5, C.dim);
        this.bar(ctx, bx, y + 42, bw, 7, ratio, hk.handlers ? C.pu : '#2a3345');
        this.text(ctx, `${hk.calls}× / ${hk.handlers}h`, bx, y + 62, 8.5, C.key);
      });

      /* 投射物 */
      const px = x + w - 250;
      this.text(ctx, 'PROJECTILES', px, y + 18, 9.5, C.dim);
      const projs = match.combat.projectiles.slice(0, 3);
      if (!projs.length) this.text(ctx, 'none', px, y + 36, 10, C.dim);
      projs.forEach((p, i) => {
        this.text(ctx, `${p.element.padEnd(6)} x=${U.fmt(p.x).padStart(7)} vx=${U.fmt(p.vx).padStart(5)} life=${Math.round(p.life)}`,
          px, y + 36 + i * 14, 9.5, C.txt);
      });
    }
  }

  FE.renderers.register('data', {
    name: '纯内核数据', short: 'DATA',
    desc: '不渲染角色，只输出状态机 / 帧数据 / 钩子调用',
    create(engine) { return new RendererData(engine); }
  });
})();
