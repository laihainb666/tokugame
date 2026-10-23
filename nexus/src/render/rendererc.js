/* ==========================================================
   RendererC — C 内核后端
   ----------------------------------------------------------
   这是第四种"架构"，不是第四种画风：

     · 仿真来自 Q16.16 定点、零分配的定长内核
     · 每帧产出 FNV-1a 状态哈希，可逐位复现
     · 渲染层只吃一份只读快照（snapshot），不碰内核内部

   画面刻意做成工程蓝图风：线框骨架 + 判定盒 + 十六进制面板，
   因为它要展示的是"确定性"，不是"好看"。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const W = 1280, H = 720;
  const GROUND = 528;
  const PANEL_X = 884, PANEL_W = 372;

  /* C 状态 → 动画状态名 */
  const STATE_MAP = ['idle', 'walk_f', 'walk_b', 'crouch', 'air', 'attack', 'hitstun', 'blockstun', 'ko'];
  const ANIM_MAP = { light: 'jab', heavy: 'straight', sweep: 'sweep', upper: 'uppercut', fire: 'cast', super: 'super' };

  const BONES = [
    ['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'],
    ['shoulderL', 'elbowL'], ['elbowL', 'handL'],
    ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
    ['hipL', 'kneeL'], ['kneeL', 'footL'],
    ['hipR', 'kneeR'], ['kneeR', 'footR'],
    ['chest', 'shoulderL'], ['chest', 'shoulderR'],
    ['pelvis', 'hipL'], ['pelvis', 'hipR']
  ];

  const COL = [
    { line: '#4de1ff', dim: '#1c6d85', glow: 'rgba(77,225,255,.55)' },
    { line: '#ffb02e', dim: '#8a5a12', glow: 'rgba(255,176,46,.55)' }
  ];

  function hex8(n) {
    return (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  function hex16(n) {
    const h = hex8(n);
    return h.slice(0, 4) + '_' + h.slice(4);
  }

  class RendererC {
    constructor(engine) {
      this.engine = engine;
      this.ownsSimulation = true;
      this.CK = FE.CKernel || window.CKernel;
      this.seed = 12345;
      this.kernel = null;
      this.time = 0;
      this.camX = 0;
      this.scale = 1.5;
      this.endTimer = 0;
      this.hashHistory = [];
      this.err = null;
    }

    destroy() { this.kernel = null; }

    ensure() {
      if (!this.CK) { this.err = 'c-kernel.js 未加载'; return false; }
      if (!this.kernel) {
        this.kernel = new this.CK(this.seed);
        this.hashHistory = [];
        this.endTimer = 0;
      }
      return true;
    }

    /* --- 由引擎每帧调用（接管仿真） --- */
    step() {
      if (!this.ensure()) return;
      const k = this.kernel;
      if (k.winner >= 0) {
        this.endTimer++;
        if (this.endTimer > 150) { this.kernel = null; this.ensure(); }
        return;
      }
      k.step();
      if (k.frame % 60 === 0) {
        this.hashHistory.push({ f: k.frame, h: k.hash });
        if (this.hashHistory.length > 6) this.hashHistory.shift();
      }
    }

    /* --- 把 C 快照适配成骨架解算器认识的形状 --- */
    adapt(f) {
      const CK = this.CK;
      const mv = f.moveId >= 0 ? CK.MOVES[f.moveId] : null;
      return {
        state: STATE_MAP[f.state] || 'idle',
        stateTime: f.stateTime,
        move: mv ? {
          id: mv.id, name: mv.name,
          startup: mv.startup, active: mv.active, recovery: mv.recovery,
          total: mv.startup + mv.active + mv.recovery,
          anim: ANIM_MAP[mv.id] || 'jab',
          hitbox: { x: mv.hbx / 65536, y: mv.hby / 65536, w: mv.hbw, h: mv.hbh },
          activeFrom: mv.startup,
          activeTo: mv.startup + mv.active - 1,
          hits: 1, cancelFrom: [0, 0]
        } : null,
        moveFrame: f.moveFrame,
        facing: f.facing,
        airborne: f.airborne,
        x: f.x, y: f.y,
        vel: { x: f.vx, y: f.vy },
        input: { dir: { x: 0, y: f.crouching ? 1 : 0 } }
      };
    }

    draw() {
      const ctx = this.engine.ctx;
      this.time += 1 / 60;

      if (!this.ensure()) {
        ctx.fillStyle = '#05080d'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ff6b7a';
        ctx.font = '600 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.err || 'C 内核未就绪', W / 2, H / 2);
        ctx.textAlign = 'left';
        return;
      }

      const k = this.kernel;
      const snap = k.snapshot();

      /* --- 相机 --- */
      const fs = snap.fighters;
      const mid = (fs[0].x + fs[1].x) / 2;
      const spread = Math.abs(fs[0].x - fs[1].x);
      this.camX = U.damp(this.camX, mid * 0.6, 4, 1 / 60);
      const wantS = U.clamp(1.72 - spread / 1600, 1.1, 1.68);
      this.scale = U.damp(this.scale, wantS, 3, 1 / 60);
      const S = this.scale;
      const P = (wx, wy) => ({ x: W / 2 + (wx - this.camX) * S, y: GROUND - wy * S });

      this.drawBackground(ctx, S);
      this.drawArena(ctx, P, S);

      /* --- 角色 --- */
      for (let i = 0; i < 2; i++) {
        this.drawFighter(ctx, snap.fighters[i], i, P, S);
      }

      /* --- 投射物 --- */
      for (const p of snap.projectiles) {
        const c = P(p.x, p.y + p.h / 2);
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(this.time * 3);
        ctx.strokeStyle = '#8ef0ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#8ef0ff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        const r = (p.w / 2) * S;
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
        ctx.closePath(); ctx.stroke();
        ctx.restore();
      }

      /* --- 面板 --- */
      this.drawPanel(ctx, snap);

      /* --- 底部十六进制条 --- */
      this.drawHexStrip(ctx, snap);

      /* --- 结束 --- */
      if (snap.winner >= 0) {
        const a = Math.min(1, this.endTimer / 20);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.font = '900 64px "Segoe UI",sans-serif';
        ctx.fillStyle = '#ffd23d';
        ctx.shadowColor = 'rgba(255,180,60,.8)';
        ctx.shadowBlur = 26;
        ctx.fillText(snap.winner === 2 ? 'DRAW' : 'P' + (snap.winner + 1) + ' WINS', W / 2 - 120, 300);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.shadowBlur = 0;
      }
    }

    /* ---------------- 背景 ---------------- */
    drawBackground(ctx, S) {
      ctx.fillStyle = '#050910';
      ctx.fillRect(0, 0, W, H);

      // 蓝图网格
      const step = 40;
      ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += step) {
        ctx.strokeStyle = (x % 200 === 0) ? 'rgba(60,130,160,.16)' : 'rgba(40,90,115,.09)';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y <= H; y += step) {
        ctx.strokeStyle = (y % 200 === 0) ? 'rgba(60,130,160,.16)' : 'rgba(40,90,115,.09)';
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // 地面
      const g = ctx.createLinearGradient(0, GROUND - 10, 0, H);
      g.addColorStop(0, 'rgba(20,50,70,.55)');
      g.addColorStop(1, 'rgba(4,8,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, GROUND, W, H - GROUND);

      // 地平线
      ctx.strokeStyle = 'rgba(90,200,230,.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke();

      // 刻度
      ctx.strokeStyle = 'rgba(90,200,230,.28)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        const big = (x % 200 === 0);
        ctx.beginPath();
        ctx.moveTo(x, GROUND);
        ctx.lineTo(x, GROUND + (big ? 14 : 7));
        ctx.stroke();
      }
    }

    drawArena(ctx, P, S) {
      // 场地中线
      const c = P(0, 0);
      ctx.strokeStyle = 'rgba(90,200,230,.14)';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(c.x, GROUND - 240);
      ctx.lineTo(c.x, GROUND);
      ctx.stroke();
      ctx.setLineDash([]);

      // 边界
      const half = 640;
      for (const wx of [-half, half]) {
        const p = P(wx, 0);
        ctx.strokeStyle = 'rgba(255,90,110,.30)';
        ctx.beginPath();
        ctx.moveTo(p.x, GROUND - 260);
        ctx.lineTo(p.x, GROUND);
        ctx.stroke();
      }
    }

    /* ---------------- 角色线框 ---------------- */
    drawFighter(ctx, f, side, P, S) {
      const col = COL[side];
      const view = this.adapt(f);
      const { j } = FE.anim.solve(view, this.time);
      const k = S / 1.6;

      const W2 = (pt) => P(f.x + pt.x, f.y + pt.y);

      /* 影子 */
      const sp = P(f.x, 0);
      const sc = U.clamp(1 - f.y / 400, 0.4, 1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, 46 * sc * k, 12 * sc * k, 0, 0, 7);
      ctx.fill();

      /* 判定盒（C 内核原始数据） */
      const mv = f.moveId >= 0 ? this.CK.MOVES[f.moveId] : null;
      if (mv && f.state === 5) {
        const active = f.moveFrame >= mv.startup && f.moveFrame < mv.startup + mv.active;
        if (active && mv.kind !== 1) {
          const hx = f.x + f.facing * (mv.hbx / 65536);
          const hy = f.y + mv.hby / 65536;
          this.rect(ctx, P(hx, hy), mv.hbw * S, mv.hbh * S, active ? 'rgba(255,77,94,.85)' : 'rgba(255,77,94,.3)', 'rgba(255,77,94,.12)');
        }
      }
      // 受击盒
      const uh = (f.state === 3 || f.crouching) ? 112 : 176;
      this.rect(ctx, P(f.x, f.y), 54 * S, uh * S, 'rgba(77,141,255,.45)', 'rgba(77,141,255,.07)');

      /* 骨骼 */
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = col.glow;
      ctx.shadowBlur = 10;

      // 外发光
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 5 * k;
      ctx.globalAlpha = 0.22;
      for (const [a, b] of BONES) {
        const pa = W2(j[a]), pb = W2(j[b]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }

      // 主线
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 2 * k;
      for (const [a, b] of BONES) {
        const pa = W2(j[a]), pb = W2(j[b]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }

      // 关节
      ctx.fillStyle = '#eaffff';
      for (const key of ['chest', 'pelvis', 'handL', 'handR', 'footL', 'footR', 'elbowL', 'elbowR', 'kneeL', 'kneeR']) {
        const p = W2(j[key]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * k, 0, 7); ctx.fill();
      }

      // 头
      const hp = W2(j.head);
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, 15 * k, 0, 7); ctx.stroke();
      // 朝向标记
      ctx.fillStyle = col.line;
      ctx.beginPath();
      ctx.moveTo(hp.x + f.facing * 22 * k, hp.y);
      ctx.lineTo(hp.x + f.facing * 13 * k, hp.y - 5 * k);
      ctx.lineTo(hp.x + f.facing * 13 * k, hp.y + 5 * k);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      /* 状态标签 */
      const lp = P(f.x, f.y + 200);
      ctx.font = '600 10px "JetBrains Mono",monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = col.line;
      const label = f.stateName + (mv ? ' · ' + mv.name + ' f' + f.moveFrame + '/' + (mv.startup + mv.active + mv.recovery) : '');
      ctx.fillText(label, lp.x, lp.y);
      ctx.textAlign = 'left';
    }

    rect(ctx, p, w, h, stroke, fill) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.rect(p.x - w / 2, p.y - h, w, h);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
    }

    /* ---------------- 遥测面板 ---------------- */
    drawPanel(ctx, snap) {
      const x = PANEL_X, y = 24, w = PANEL_W, h = 672;
      ctx.fillStyle = 'rgba(7,13,20,.90)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(50,120,150,.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // 顶部装饰条
      ctx.fillStyle = 'rgba(77,225,255,.85)';
      ctx.fillRect(x, y, 3, h);

      let cy = y + 26;
      const L = x + 16, R = x + w - 16;

      ctx.font = '800 13px "JetBrains Mono",monospace';
      ctx.fillStyle = '#7fe3ff';
      ctx.fillText('C KERNEL', L, cy);
      ctx.font = '600 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f7d96';
      ctx.textAlign = 'right';
      ctx.fillText('native/nexus.c', R, cy);
      ctx.textAlign = 'left';

      cy += 15;
      ctx.font = '500 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f6b80';
      ctx.fillText('Q16.16 FIXED-POINT · ZERO-ALLOC · DETERMINISTIC', L, cy);

      cy += 14;
      this.sep(ctx, L, R, cy);

      cy += 20;
      this.row(ctx, L, R, cy, 'FRAME', String(snap.frame).padStart(6, '0'), '#c8e6f5');
      cy += 20;
      ctx.font = '600 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f6b80';
      ctx.fillText('STATE HASH', L, cy);
      cy += 17;
      ctx.font = '800 19px "JetBrains Mono",monospace';
      ctx.fillStyle = '#ffd23d';
      ctx.shadowColor = 'rgba(255,210,61,.5)';
      ctx.shadowBlur = 10;
      ctx.fillText(hex8(snap.hash), L, cy);
      ctx.shadowBlur = 0;

      cy += 20;
      this.row(ctx, L, R, cy, 'TIMER', (snap.timer / 60).toFixed(2) + 's', '#8fb8cc');
      cy += 17;
      this.row(ctx, L, R, cy, 'RNG', hex8(snap.rng), '#8fb8cc');

      cy += 16;
      this.sep(ctx, L, R, cy);

      for (let i = 0; i < 2; i++) {
        const f = snap.fighters[i];
        cy += 22;
        ctx.font = '800 11px "JetBrains Mono",monospace';
        ctx.fillStyle = COL[i].line;
        ctx.fillText('P' + (i + 1), L, cy);
        ctx.font = '500 10px "JetBrains Mono",monospace';
        ctx.fillStyle = '#5f8ba0';
        ctx.textAlign = 'right';
        ctx.fillText(f.stateName.toUpperCase(), R, cy);
        ctx.textAlign = 'left';

        // HP
        cy += 10;
        const barW = w - 32, barH = 7;
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(L, cy, barW, barH);
        ctx.fillStyle = COL[i].line;
        ctx.fillRect(L, cy, barW * U.clamp(f.health / 1000, 0, 1), barH);
        cy += 9;
        ctx.font = '500 9px "JetBrains Mono",monospace';
        ctx.fillStyle = '#5f8ba0';
        ctx.fillText('HP ' + String(f.health).padStart(4, ' '), L, cy);
        ctx.textAlign = 'right';
        ctx.fillText('METER ' + String(f.meter).padStart(3, ' '), R, cy);
        ctx.textAlign = 'left';

        // 定点原始值
        cy += 15;
        ctx.font = '500 9.5px "JetBrains Mono",monospace';
        ctx.fillStyle = '#4d7f96';
        ctx.fillText('x  ' + hex16(Math.round(f.x * 65536)), L, cy);
        ctx.textAlign = 'right';
        ctx.fillText('vx ' + hex16(Math.round(f.vx * 65536)), R, cy);
        ctx.textAlign = 'left';

        if (f.combo > 0) {
          cy += 14;
          ctx.fillStyle = '#ffd23d';
          ctx.fillText('COMBO ' + f.combo + '  ' + f.comboDmg + ' dmg', L, cy);
        }
      }

      cy += 20;
      this.sep(ctx, L, R, cy);

      cy += 20;
      ctx.font = '600 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f6b80';
      ctx.fillText('HASH @ EVERY 60F', L, cy);
      cy += 16;
      ctx.font = '500 9.5px "JetBrains Mono",monospace';
      const hist = this.hashHistory.slice(-5);
      if (!hist.length) {
        ctx.fillStyle = '#2d566a';
        ctx.fillText('— 采集第 60 帧后开始记录 —', L, cy);
      }
      for (const hh of hist) {
        ctx.fillStyle = '#6fa8c0';
        ctx.fillText('f' + String(hh.f).padStart(4, '0') + '  ' + hex8(hh.h), L, cy);
        cy += 13;
      }

      // 底部说明
      const by = y + h - 46;
      this.sep(ctx, L, R, by - 12);
      ctx.font = '500 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f6b80';
      ctx.fillText('REPLAY ' + snap.replayLen + ' entries', L, by + 4);
      ctx.fillStyle = '#2f5568';
      ctx.fillText('gcc -O2 nexus.c && ./nexus 900 12345', L, by + 18);
      ctx.fillText('期望 FINAL_HASH = 280F7260', L, by + 30);
    }

    row(ctx, L, R, y, label, value, color) {
      ctx.font = '600 9px "JetBrains Mono",monospace';
      ctx.fillStyle = '#3f6b80';
      ctx.fillText(label, L, y);
      ctx.font = '600 11px "JetBrains Mono",monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(value, R, y);
      ctx.textAlign = 'left';
    }

    sep(ctx, L, R, y) {
      ctx.strokeStyle = 'rgba(50,110,140,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, y + 0.5);
      ctx.lineTo(R, y + 0.5);
      ctx.stroke();
    }

    /* ---------------- 十六进制条 ---------------- */
    drawHexStrip(ctx, snap) {
      const y = H - 26;
      ctx.font = '500 9.5px "JetBrains Mono",monospace';
      ctx.fillStyle = '#2f5568';
      ctx.fillText('STATE', 24, y - 12);
      const f0 = snap.fighters[0], f1 = snap.fighters[1];
      const words = [
        Math.round(f0.x * 65536), Math.round(f0.y * 65536),
        Math.round(f0.vx * 65536), Math.round(f0.vy * 65536),
        f0.health, f0.meter, f0.state, f0.moveFrame,
        Math.round(f1.x * 65536), Math.round(f1.y * 65536),
        Math.round(f1.vx * 65536), Math.round(f1.vy * 65536),
        f1.health, f1.meter, f1.state, f1.moveFrame
      ];
      for (let i = 0; i < words.length; i++) {
        ctx.fillStyle = i < 8 ? 'rgba(77,225,255,.55)' : 'rgba(255,176,46,.55)';
        ctx.fillText(hex8(words[i]), 24 + i * 62, y);
      }
    }
  }

  FE.renderers.register('c', {
    name: 'C 内核',
    short: 'C99',
    desc: 'Q16.16 定点 · 零分配 · 逐帧哈希可复现（对应 native/nexus.c）',
    create(engine) { return new RendererC(engine); }
  });
})();
