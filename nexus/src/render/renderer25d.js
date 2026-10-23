/* ==========================================================
   Renderer25D — 2.5D 侧视后端
   ----------------------------------------------------------
   同一套骨架数据，换成矢量画法：粗描边肢体、视差背景、
   招式挥砍残影。性能最好，也最容易看出动作细节。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  class Renderer25D {
    constructor(engine) {
      this.engine = engine;
      this.time = 0;
      this.camX = 0;
      this.scale = 1.6;
    }
    destroy() {}

    worldToScreen(x, y, camX, scale, W, H) {
      return {
        x: W / 2 + (x - camX) * scale,
        y: H * 0.80 - y * scale
      };
    }

    draw(match, dt) {
      const ctx = this.engine.ctx;
      const W = 1280, H = 720;
      this.time += 1 / 60;
      if (!match) return;

      /* 相机 */
      const fs = match.fighters.filter(f => f.active && !f.isGhost);
      let midX = 0, maxD = 180, maxY = 0;
      if (fs.length) {
        let mn = 1e9, mx = -1e9;
        for (const f of fs) { mn = Math.min(mn, f.x); mx = Math.max(mx, f.x); maxY = Math.max(maxY, f.y); }
        midX = (mn + mx) / 2; maxD = mx - mn;
      }
      this.camX = U.damp(this.camX, midX, 5, 1 / 60);
      const wantS = U.clamp(2.05 - maxD / 1500, 1.25, 1.98);
      this.scale = U.damp(this.scale, wantS, 3, 1 / 60);
      const shake = match.shakeAmt || 0;
      const shX = (Math.random() - 0.5) * shake;
      const shY = (Math.random() - 0.5) * shake;
      const camX = this.camX, S = this.scale;
      const W2S = (x, y) => this.worldToScreen(x, y, camX, S, W, H);
      const gy = H * 0.80;
      this.projectPoint = (x, y) => this.worldToScreen(x, y, camX, S, W, H);

      ctx.save();
      ctx.translate(shX, shY + maxY * S * 0.25);

      /* ---------- 背景 ---------- */
      this.drawSky(ctx, W, H, camX, gy);
      this.drawFar(ctx, W, H, camX, gy);
      this.drawGround(ctx, W, H, camX, S, gy);

      /* ---------- 影子 ---------- */
      for (const f of fs) {
        const p = W2S(f.x, 0);
        const sc = U.clamp(1 - f.y / 380, 0.4, 1);
        const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 58 * sc);
        g.addColorStop(0, 'rgba(0,0,0,.72)');
        g.addColorStop(0.55, 'rgba(0,0,0,.34)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 58 * sc, 15 * sc, 0, 0, 7); ctx.fill();
      }

      /* ---------- 角色 ---------- */
      const sorted = [...fs].sort((a, b) => (a.side === 0 ? 1 : -1));
      for (const f of sorted) this.drawFighter(ctx, f, W2S, S);

      /* ---------- 特效 ---------- */
      this.drawFx(ctx, match, W2S, S);

      /* ---------- 前景 ---------- */
      this.drawFore(ctx, W, H, camX, gy);

      ctx.restore();

      /* ---------- HUD ---------- */
      if (FE.hud) FE.hud.draw(ctx, match, this);
    }

    drawSky(ctx, W, H, camX, gy) {
      const st = FE.stageTheme();
      const stops = st ? st.sky : ['#0a0d1c', '#1d2140', '#5b3a55', '#c26a45'];
      const g = ctx.createLinearGradient(0, 0, 0, gy);
      const n = stops.length;
      for (let i = 0; i < n; i++) g.addColorStop(n === 1 ? 0 : i / (n - 1), stops[i]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy + 2);

      // 月亮
      const mx = W * 0.72 - camX * 0.04, my = H * 0.2;
      const rg = ctx.createRadialGradient(mx, my, 10, mx, my, 150);
      rg.addColorStop(0, 'rgba(255,240,210,.35)');
      rg.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(mx, my, 150, 0, 7); ctx.fill();
      ctx.fillStyle = '#fdf3d8';
      ctx.beginPath(); ctx.arc(mx, my, 38, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(29,33,64,.9)';
      ctx.beginPath(); ctx.arc(mx + 14, my - 8, 34, 0, 7); ctx.fill();

      // 星
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 137.5 + 40) % W) - camX * 0.02;
        const sy = (i * 71.3) % (H * 0.45);
        const a = 0.25 + 0.55 * Math.abs(Math.sin(this.time * 0.8 + i));
        ctx.globalAlpha = a;
        ctx.fillRect(((sx % W) + W) % W, sy, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    drawFar(ctx, W, H, camX, gy) {
      const st = FE.stageTheme();
      // 远山（两层）
      const layers = [
        { off: 0.10, y: gy - 40, amp: 70, col: st ? st.far : '#241f33', seed: 0.9 },
        { off: 0.22, y: gy - 10, amp: 46, col: st ? st.near : '#191527', seed: 2.4 }
      ];
      for (const L of layers) {
        ctx.beginPath();
        ctx.moveTo(-20, gy + 10);
        const off = -camX * L.off;
        for (let x = -20; x <= W + 20; x += 16) {
          const t = (x + off) * 0.005;
          const y = L.y - Math.sin(t * 1.9 + L.seed) * L.amp - Math.sin(t * 5.1 + L.seed) * L.amp * 0.3;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W + 20, gy + 10); ctx.closePath();
        ctx.fillStyle = L.col; ctx.fill();
      }
      // 塔的剪影（基座落在地平线上）
      const tx = 240 - camX * 0.18;
      ctx.fillStyle = '#1b1728';
      for (let i = 0; i < 4; i++) {
        const w = 54 - i * 10, y = gy - 24 - i * 44;
        ctx.fillRect(tx - w / 2, y, w, 20);
        ctx.beginPath();
        ctx.moveTo(tx - w / 2 - 12, y);
        ctx.lineTo(tx, y - 16);
        ctx.lineTo(tx + w / 2 + 12, y);
        ctx.closePath(); ctx.fill();
      }
    }

    drawGround(ctx, W, H, camX, S, gy) {
      const st = FE.stageTheme();
      const g = ctx.createLinearGradient(0, gy - 6, 0, H);
      if (st && st.ground) {
        const gs = st.ground;
        for (let i = 0; i < gs.length; i++) g.addColorStop(i / (gs.length - 1), gs[i]);
      } else {
        g.addColorStop(0, '#3b2c33');
        g.addColorStop(0.25, '#241b23');
        g.addColorStop(1, '#0e0a10');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, gy, W, H - gy);

      // 地面透视纹
      ctx.strokeStyle = 'rgba(255,170,110,.10)';
      ctx.lineWidth = 1;
      for (let i = -14; i <= 14; i++) {
        const wx = camX + i * 90;
        const sx = W / 2 + (wx - camX) * S;
        ctx.beginPath();
        ctx.moveTo(sx, gy);
        ctx.lineTo(W / 2 + (wx - camX) * S * 2.1, H);
        ctx.stroke();
      }
      // 地平线亮线
      ctx.strokeStyle = 'rgba(255,190,130,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    drawFore(ctx, W, H, camX, gy) {
      // 前景草叶
      ctx.strokeStyle = 'rgba(10,8,14,.85)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const bx = ((i * 137 + 60 - camX * 1.35) % (W + 200)) - 100;
        const h = 20 + (i % 5) * 9;
        ctx.beginPath();
        ctx.moveTo(bx, H);
        ctx.quadraticCurveTo(bx + 6, H - h * 0.6, bx + (i % 2 ? 12 : -12), H - h);
        ctx.stroke();
      }
      // 底部渐隐
      const g = ctx.createLinearGradient(0, H - 90, 0, H);
      g.addColorStop(0, 'rgba(6,5,9,0)');
      g.addColorStop(1, 'rgba(6,5,9,.85)');
      ctx.fillStyle = g; ctx.fillRect(0, H - 90, W, 90);
    }

    /* ---------------- 角色绘制 ---------------- */
    drawFighter(ctx, f, W2S, S) {
      const pal = f.def.palette;
      const { j, animName } = FE.anim.solve(f, this.time);
      const P = (pt) => W2S(f.x + pt.x, f.y + pt.y);
      const flash = f.flash > 0;
      const k = S / 1.6;   // 线宽缩放

      const stroke = (a, b, w, col, outline) => {
        const pa = P(a), pb = P(b);
        ctx.lineCap = 'round';
        if (outline) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = w * k + 4 * k;
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = w * k;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      };

      const OL = '#0b0910';
      const tint = (c) => flash ? '#fff' : c;

      // 后腿 / 后臂（暗一档）
      stroke(j.hipR, j.kneeR, 16, tint(pal.dark), OL);
      stroke(j.kneeR, j.footR, 13, tint(pal.dark), OL);
      stroke(j.shoulderR, j.elbowR, 13, tint(pal.dark), OL);
      stroke(j.elbowR, j.handR, 11, tint(pal.skin), OL);

      // 躯干
      const pelvis = P(j.pelvis), chest = P(j.chest);
      ctx.lineCap = 'round';
      ctx.strokeStyle = OL; ctx.lineWidth = 42 * k;
      ctx.beginPath(); ctx.moveTo(pelvis.x, pelvis.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();
      const tg = ctx.createLinearGradient(pelvis.x - 20, pelvis.y, chest.x + 20, chest.y);
      tg.addColorStop(0, tint(pal.dark)); tg.addColorStop(0.5, tint(pal.gi)); tg.addColorStop(1, tint(pal.main));
      ctx.strokeStyle = tg; ctx.lineWidth = 36 * k;
      ctx.beginPath(); ctx.moveTo(pelvis.x, pelvis.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();

      // 腰带
      const beltP = P({ x: j.pelvis.x, y: j.pelvis.y + 6 });
      ctx.strokeStyle = OL; ctx.lineWidth = 14 * k;
      ctx.beginPath(); ctx.moveTo(beltP.x - 16 * k, beltP.y); ctx.lineTo(beltP.x + 16 * k, beltP.y); ctx.stroke();
      ctx.strokeStyle = pal.belt; ctx.lineWidth = 9 * k;
      ctx.beginPath(); ctx.moveTo(beltP.x - 16 * k, beltP.y); ctx.lineTo(beltP.x + 16 * k, beltP.y); ctx.stroke();
      // 飘带
      const sway = Math.sin(this.time * 5 + f.x * 0.01) * 8;
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 5 * k;
      ctx.beginPath();
      ctx.moveTo(beltP.x - f.facing * 12 * k, beltP.y);
      ctx.quadraticCurveTo(beltP.x - f.facing * 30 * k, beltP.y + 16 * k + sway, beltP.x - f.facing * 42 * k, beltP.y + 34 * k - sway);
      ctx.stroke();

      // 头
      const hp = P(j.head);
      const hr = 17 * k;
      ctx.fillStyle = OL;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, hr + 2.5 * k, 0, 7); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : pal.skin;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, hr, 0, 7); ctx.fill();
      this.drawHair(ctx, f, hp, hr, pal, flash);

      // 前腿
      stroke(j.hipL, j.kneeL, 17, tint(pal.main), OL);
      stroke(j.kneeL, j.footL, 14, tint(pal.light), OL);
      // 脚
      const fp = P(j.footL);
      ctx.fillStyle = OL;
      ctx.beginPath(); ctx.ellipse(fp.x + f.facing * 4 * k, fp.y + 2 * k, 12 * k, 7 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = pal.dark;
      ctx.beginPath(); ctx.ellipse(fp.x + f.facing * 4 * k, fp.y + 1 * k, 9.5 * k, 5 * k, 0, 0, 7); ctx.fill();

      // 前臂
      stroke(j.shoulderL, j.elbowL, 14, tint(pal.main), OL);
      stroke(j.elbowL, j.handL, 12, tint(pal.skin), OL);
      // 拳套
      const handP = P(j.handL);
      ctx.fillStyle = OL;
      ctx.beginPath(); ctx.arc(handP.x, handP.y, 9 * k, 0, 7); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : pal.accent;
      ctx.beginPath(); ctx.arc(handP.x, handP.y, 6.5 * k, 0, 7); ctx.fill();

      // 眼
      if (f.state !== 'ko' && f.state !== 'knockdown') {
        const ex = hp.x + f.facing * 7 * k, ey = hp.y - 1 * k;
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(ex, ey, 2.4 * k, 3.2 * k, 0, 0, 7); ctx.fill();
        ctx.fillStyle = pal.aura;
        ctx.beginPath(); ctx.arc(ex, ey, 1.2 * k, 0, 7); ctx.fill();
      }

      /* 攻击残影 */
      if (f.state === 'attack' && f.move) {
        const m = f.move;
        if (f.moveFrame >= m.activeFrom && f.moveFrame <= m.activeTo + 2) {
          this.drawSlash(ctx, f, j, P, S, m);
        }
      }

      /* 蓄力光环 */
      if (f.meter >= FE.balance.maxMeter * 0.995 && f.state !== 'ko') {
        const p = P({ x: 0, y: 96 });
        const rg = ctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, 100 * k);
        rg.addColorStop(0, 'rgba(255,210,120,.16)');
        rg.addColorStop(1, 'rgba(255,210,120,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(p.x, p.y, 100 * k, 0, 7); ctx.fill();
      }
    }

    drawHair(ctx, f, hp, hr, pal, flash) {
      const id = f.def.id;
      ctx.fillStyle = flash ? '#fff' : pal.hair;
      ctx.strokeStyle = '#0b0910';
      ctx.lineWidth = 2;
      if (id === 'frost') {
        // 长发
        ctx.beginPath();
        ctx.moveTo(hp.x - hr * 0.8, hp.y - hr * 0.3);
        ctx.quadraticCurveTo(hp.x - hr * 2.2, hp.y + hr * 2.4, hp.x - hr * 1.2, hp.y + hr * 3.2);
        ctx.quadraticCurveTo(hp.x - hr * 0.2, hp.y + hr * 1.6, hp.x + hr * 0.4, hp.y + hr * 0.9);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y - hr * 0.35, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      } else if (id === 'rock') {
        // 光头 + 头巾
        ctx.fillStyle = flash ? '#fff' : pal.accent;
        ctx.beginPath(); ctx.arc(hp.x, hp.y - hr * 0.2, hr * 1.0, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
        ctx.stroke();
      } else {
        // 刺发
        ctx.beginPath();
        ctx.moveTo(hp.x - hr * 1.0, hp.y - hr * 0.2);
        for (let i = 0; i <= 5; i++) {
          const a = Math.PI * (1.0 + i * 0.2);
          const r = i % 2 ? hr * 1.55 : hr * 1.05;
          ctx.lineTo(hp.x + Math.cos(a) * r, hp.y + Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    drawSlash(ctx, f, j, P, S, m) {
      const t = U.clamp((f.moveFrame - m.activeFrom) / Math.max(1, m.active), 0, 1);
      const hand = P(j.handL);
      const col = f.def.palette.aura;
      const R = (m.hitbox.w * 0.9 + 30) * (S / 1.6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = col;
      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.lineWidth = 10 * (S / 1.6) * (1 - t * 0.5);
      ctx.lineCap = 'round';
      const dir = f.facing;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, R * 0.7, dir > 0 ? -1.1 : Math.PI + 0.1, dir > 0 ? 0.9 : Math.PI + 2.1);
      ctx.stroke();
      ctx.restore();
    }

    /* ---------------- 特效 ---------------- */
    drawFx(ctx, match, W2S, S) {
      const k = S / 1.6;
      for (const fx of match.fx) {
        const p = W2S(fx.x, fx.y);
        const t = fx.t / fx.life;
        const a = 1 - t;
        if (fx.type === 'hit') {
          const R = (18 + t * 52) * fx.power * k;
          const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, R);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(0.3, `rgba(255,230,150,${a * 0.9})`);
          g.addColorStop(1, 'rgba(255,110,50,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.lineWidth = 3 * a * k;
          for (let i = 0; i < 8; i++) {
            const ang = fx.seed + i * Math.PI / 4;
            const r1 = R * 0.45, r2 = R * (1.25 + Math.sin(t * 5) * 0.25);
            ctx.beginPath();
            ctx.moveTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1);
            ctx.lineTo(p.x + Math.cos(ang) * r2, p.y + Math.sin(ang) * r2);
            ctx.stroke();
          }
        } else if (fx.type === 'guard') {
          ctx.strokeStyle = `rgba(130,205,255,${a})`;
          ctx.lineWidth = 5 * a * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, (34 + t * 26) * k, -1.25, 1.25); ctx.stroke();
        } else if (fx.type === 'burst') {
          ctx.strokeStyle = `rgba(255,180,90,${a * 0.85})`;
          ctx.lineWidth = 4 * a * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, (fx.size || 22) * (1 + t * 2) * k, 0, 7); ctx.stroke();
        } else if (fx.type === 'cast') {
          ctx.strokeStyle = `rgba(255,225,160,${a * 0.8})`;
          ctx.lineWidth = 2.5 * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, (12 + t * 44) * k, 0, 7); ctx.stroke();
        } else if (fx.type === 'armor') {
          ctx.strokeStyle = `rgba(255,210,90,${a})`;
          ctx.lineWidth = 3.5 * k;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3 - Math.PI / 2;
            const r = 50 * k * (1 + t * 0.25);
            const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath(); ctx.stroke();
        } else if (fx.type === 'switch') {
          ctx.strokeStyle = `rgba(170,205,255,${a * 0.9})`;
          ctx.lineWidth = 3 * k;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(p.x + i * 14 * k, p.y + 110 * k);
            ctx.lineTo(p.x + i * 14 * k, p.y - (110 + t * 70) * k);
            ctx.stroke();
          }
        } else if (fx.type === 'trail') {
          ctx.fillStyle = `rgba(255,200,140,${a * 0.45})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, (fx.size || 8) * a * k, 0, 7); ctx.fill();
        }
      }
      // 投射物
      for (const pr of match.combat.projectiles) {
        const p = W2S(pr.x, pr.y + pr.h / 2);
        const col = pr.element === 'fire' ? [255, 140, 60]
          : pr.element === 'ice' ? [120, 210, 255]
            : pr.element === 'earth' ? [210, 160, 80] : [200, 200, 255];
        const R = pr.w * 0.75 * k;
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, R * 1.6);
        g.addColorStop(0, 'rgba(255,255,255,.95)');
        g.addColorStop(0.4, `rgba(${col[0]},${col[1]},${col[2]},.85)`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.6, 0, 7); ctx.fill();
        // 拖尾
        ctx.globalAlpha = 0.3;
        for (let i = 1; i <= 5; i++) {
          const tp = W2S(pr.x - Math.sign(pr.vx) * i * 16, pr.y + pr.h / 2);
          ctx.beginPath(); ctx.arc(tp.x, tp.y, R * (1 - i / 7), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  FE.renderers.register('25d', {
    name: '2.5D 侧视', short: '2.5D',
    desc: '矢量角色 + 多层视差，性能最佳',
    create(engine) { return new Renderer25D(engine); }
  });
})();
