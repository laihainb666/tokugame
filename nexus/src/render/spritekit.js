/* ==========================================================
   SpriteKit — 2D 风格化渲染的共用底座
   ----------------------------------------------------------
   四个新后端（像素 / 水墨 / 霓虹 / 赛璐璐）共用同一套东西：
     · 相机跟随与缩放
     · 骨架解算（复用 anim.solve，保证动作与 3D/2.5D 完全一致）
     · 角色外观适配（look.build / height / hair / scarf）
     · 锥形笔触、多边形、贴图缓存

   各后端只负责"怎么把骨架画成自己的样子"。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const KIT = {
    W: 1280,
    H: 720,
    GROUND: 548,

    /** 相机：跟随两人中点，按距离缩放 */
    camera(fighters, prev, dt) {
      let mn = 1e9, mx = -1e9, maxY = 0;
      for (const f of fighters) {
        mn = Math.min(mn, f.x); mx = Math.max(mx, f.x);
        maxY = Math.max(maxY, f.y);
      }
      if (!isFinite(mn)) { mn = -100; mx = 100; }
      const mid = (mn + mx) / 2;
      const spread = mx - mn;
      const camX = U.damp(prev.camX, mid, 5, dt);
      const wantS = U.clamp(2.0 - spread / 1500, 1.15, 1.92);
      const S = U.damp(prev.S, wantS, 3.5, dt);
      prev.camX = camX;
      prev.S = S;
      return {
        camX, S,
        W: KIT.W, H: KIT.H,
        groundY: KIT.GROUND + maxY * S * 0.22,
        P: (wx, wy) => ({
          x: KIT.W / 2 + (wx - camX) * S,
          y: KIT.GROUND + maxY * S * 0.22 - wy * S
        })
      };
    },

    /** 骨架 + 屏幕映射 */
    figure(f, time, cam, backendId) {
      const ad = FE.adapt.resolve(f.def, backendId);
      const look = ad.look;
      const { j, animName } = FE.anim.solve(f, time);
      const S = cam.S * (look.height || 1);
      const bw = look.build || 1;
      const P = (p) => ({
        x: cam.P(f.x, f.y).x + p.x * S,
        y: cam.P(f.x, f.y).y - p.y * S
      });
      return { j, animName, S, bw, look, adapted: ad.adapted, P, ad };
    },

    /** 锥形笔触：a→b，两端宽度 w1/w2 的四边形 */
    taper(ctx, a, b, w1, w2) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * w1, a.y + ny * w1);
      ctx.lineTo(b.x + nx * w2, b.y + ny * w2);
      ctx.lineTo(b.x - nx * w2, b.y - ny * w2);
      ctx.lineTo(a.x - nx * w1, a.y - ny * w1);
      ctx.closePath();
      ctx.fill();
    },

    /** 粗线（圆头），用于霓虹/赛璐璐 */
    bone(ctx, a, b, w) {
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    },

    /** 骨架连线表（与 anim.js 的关节名对应） */
    BONES: [
      ['pelvis', 'chest'], ['chest', 'neck'],
      ['shoulderL', 'elbowL'], ['elbowL', 'handL'],
      ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
      ['hipL', 'kneeL'], ['kneeL', 'footL'],
      ['hipR', 'kneeR'], ['kneeR', 'footR']
    ],

    /** 骨骼粗细（按部位） */
    THICK: {
      'pelvis|chest': 30, 'chest|neck': 13,
      'shoulderL|elbowL': 13, 'elbowL|handL': 11,
      'shoulderR|elbowR': 12, 'elbowR|handR': 10,
      'hipL|kneeL': 16, 'kneeL|footL': 13,
      'hipR|kneeR': 15, 'kneeR|footR': 12
    },

    /** 画头发（四种风格共用的形状，靠参数区分质感） */
    hair(ctx, hp, r, look, color, outline) {
      ctx.save();
      ctx.fillStyle = color;
      if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 2.5; }
      if (look.hair === 'long') {
        ctx.beginPath();
        ctx.moveTo(hp.x - r * 0.9, hp.y - r * 0.3);
        ctx.quadraticCurveTo(hp.x - r * 2.1, hp.y + r * 2.6, hp.x - r * 1.1, hp.y + r * 3.4);
        ctx.quadraticCurveTo(hp.x - r * 0.1, hp.y + r * 1.8, hp.x + r * 0.5, hp.y + r * 0.8);
        ctx.closePath();
        ctx.fill(); if (outline) ctx.stroke();
        ctx.beginPath();
        ctx.arc(hp.x, hp.y - r * 0.35, r * 1.02, Math.PI * 1.05, Math.PI * 1.95);
        ctx.fill(); if (outline) ctx.stroke();
      } else if (look.hair === 'bald') {
        ctx.beginPath();
        ctx.arc(hp.x, hp.y - r * 0.15, r * 1.0, Math.PI * 1.08, Math.PI * 1.92);
        ctx.fill(); if (outline) ctx.stroke();
      } else if (look.hair === 'hood') {
        ctx.beginPath();
        ctx.arc(hp.x, hp.y - r * 0.1, r * 1.28, Math.PI * 0.95, Math.PI * 2.05);
        ctx.fill(); if (outline) ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hp.x - r * 1.2, hp.y + r * 0.2);
        ctx.quadraticCurveTo(hp.x, hp.y + r * 2.0, hp.x + r * 1.2, hp.y + r * 0.2);
        ctx.closePath();
        ctx.fill(); if (outline) ctx.stroke();
      } else if (look.hair === 'spiky') {
        ctx.beginPath();
        ctx.moveTo(hp.x - r * 1.0, hp.y - r * 0.2);
        for (let i = 0; i <= 5; i++) {
          const a = Math.PI * (1.0 + i * 0.2);
          const rr = i % 2 ? r * 1.6 : r * 1.05;
          ctx.lineTo(hp.x + Math.cos(a) * rr, hp.y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill(); if (outline) ctx.stroke();
      } else {
        // short
        ctx.beginPath();
        ctx.arc(hp.x, hp.y - r * 0.2, r * 1.05, Math.PI * 1.02, Math.PI * 1.98);
        ctx.fill(); if (outline) ctx.stroke();
      }
      ctx.restore();
    },

    /** 未适配标记 */
    autoBadge(ctx, x, y, S) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(x - 22, y - 11, 44, 14);
      ctx.fillStyle = '#ffd23d';
      ctx.font = '700 8px "JetBrains Mono",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('AUTO', x, y);
      ctx.textAlign = 'left';
      ctx.restore();
    },

    /** 通用特效层 */
    fx(ctx, match, cam, opt) {
      opt = opt || {};
      const k = cam.S / 1.6;
      for (const fx of match.fx) {
        const p = cam.P(fx.x, fx.y);
        const t = fx.t / fx.life;
        const a = 1 - t;
        if (fx.type === 'hit') {
          const R = (16 + t * 54) * fx.power * k;
          if (opt.ringOnly) {
            ctx.strokeStyle = `rgba(${opt.ringColor || '255,255,255'},${a})`;
            ctx.lineWidth = 3 * a * k;
            ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.stroke();
          } else {
            const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, R);
            g.addColorStop(0, `rgba(255,255,255,${a})`);
            g.addColorStop(0.35, `rgba(${opt.mid || '255,220,140'},${a * 0.85})`);
            g.addColorStop(1, `rgba(${opt.edge || '255,110,50'},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
          }
          if (opt.spikes !== false) {
            ctx.strokeStyle = `rgba(${opt.spike || '255,255,255'},${a * 0.9})`;
            ctx.lineWidth = 2 * a * k;
            for (let i = 0; i < 6; i++) {
              const ang = fx.seed + i * Math.PI / 3;
              ctx.beginPath();
              ctx.moveTo(p.x + Math.cos(ang) * R * 0.5, p.y + Math.sin(ang) * R * 0.5);
              ctx.lineTo(p.x + Math.cos(ang) * R * 1.25, p.y + Math.sin(ang) * R * 1.25);
              ctx.stroke();
            }
          }
        } else if (fx.type === 'guard') {
          ctx.strokeStyle = `rgba(${opt.guard || '130,205,255'},${a})`;
          ctx.lineWidth = 4 * a * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, (30 + t * 26) * k, -1.25, 1.25); ctx.stroke();
        } else if (fx.type === 'burst') {
          ctx.strokeStyle = `rgba(${opt.edge || '255,180,90'},${a * 0.8})`;
          ctx.lineWidth = 3 * a * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, (fx.size || 22) * (1 + t * 2) * k, 0, 7); ctx.stroke();
        } else if (fx.type === 'switch') {
          ctx.strokeStyle = `rgba(${opt.guard || '170,205,255'},${a * 0.8})`;
          ctx.lineWidth = 2 * k;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(p.x + i * 13 * k, p.y + 100 * k);
            ctx.lineTo(p.x + i * 13 * k, p.y - (110 + t * 60) * k);
            ctx.stroke();
          }
        }
      }
      // 投射物
      for (const pr of match.combat.projectiles) {
        const p = cam.P(pr.x, pr.y + pr.h / 2);
        const R = pr.w * 0.7 * k;
        const col = pr.element === 'fire' ? '255,140,60'
          : pr.element === 'ice' ? '120,210,255'
            : pr.element === 'earth' ? '210,160,80'
              : pr.element === 'shadow' ? '190,130,255' : '200,200,255';
        if (opt.flat) {
          ctx.fillStyle = `rgb(${col})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
        } else {
          const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, R * 1.5);
          g.addColorStop(0, 'rgba(255,255,255,.95)');
          g.addColorStop(0.4, `rgba(${col},.85)`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.5, 0, 7); ctx.fill();
        }
      }
    },

    /** 按任意数量的色标建渐变（战场主题用） */
    skyGradient(ctx, stops, y0, y1) {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      const n = stops.length;
      for (let i = 0; i < n; i++) g.addColorStop(n === 1 ? 0 : i / (n - 1), stops[i]);
      return g;
    },

    /** 当前战场主题（没有就返回 null，调用方用自己的默认配色） */
    stage() { return FE.activeStage; },

    /** 通用背景兜底（无比赛时） */
    idle(ctx, label) {      const g = ctx.createLinearGradient(0, 0, 0, KIT.H);
      g.addColorStop(0, '#0a0e16');
      g.addColorStop(1, '#05070c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, KIT.W, KIT.H);
      ctx.fillStyle = '#2a3350';
      ctx.font = '600 14px "Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label || 'NEXUS FIGHT', KIT.W / 2, KIT.H / 2);
      ctx.textAlign = 'left';
    }
  };

  FE.kit = KIT;
})();
