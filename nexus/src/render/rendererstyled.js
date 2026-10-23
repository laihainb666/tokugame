/* ==========================================================
   四个风格化渲染引擎
   ----------------------------------------------------------
   共同点：零模型、零贴图 —— 全部由骨架 + 配色实时生成。
   不同点：绘制管线完全不一样。

     pixel  低分辨率离屏缓冲 → 最近邻放大 → 硬边像素
     ink    宣纸底 + 锥形毛笔笔触 + 飞白 + 朱印
     neon   暗场 + 加色辉光 + 拖影 + 扫描线
     toon   平涂 + 粗描边 + 赛璐璐阴影 + 冲击帧

   每个后端都会调用 FE.adapt.resolve()：
   角色没做这个后端的适配时，自动换成中性替身并在头顶标 AUTO。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const KIT = FE.kit;

  /* ---------------- 基类 ---------------- */
  class StyleBase {
    constructor(engine, id) {
      this.engine = engine;
      this.id = id;
      this.time = 0;
      this.cam = { camX: 0, S: 1.6 };
    }
    destroy() {}

    draw(match, dt) {
      const ctx = this.engine.ctx;
      this.time += 1 / 60;
      if (!match) { KIT.idle(ctx); return; }
      const fs = match.fighters.filter(f => f.active);
      const cam = KIT.camera(fs, this.cam, 1 / 60);
      this.projectPoint = (x, y) => cam.P(x, y);
      this.render(ctx, match, cam);
      if (this.hud !== false) FE.hud.draw(ctx, match, this);
    }

    /** 默认角色绘制（供子类复用）：返回 figure 上下文 */
    fighter(f, cam) {
      return KIT.figure(f, this.time, cam, this.id);
    }

    autoBadge(ctx, f, cam, fig) {
      if (fig.adapted) return;
      const p = cam.P(f.x, f.y + 196);
      KIT.autoBadge(ctx, p.x, p.y, cam.S);
    }
  }

  /* ==========================================================
     1) PIXEL — 像素
     ========================================================== */
  class PixelRenderer extends StyleBase {
    constructor(engine) {
      super(engine, 'pixel');
      this.low = null;
      this.lctx = null;
      this.paper = null;
    }

    ensure() {
      if (this.low || typeof document === 'undefined') return;
      this.low = document.createElement('canvas');
      this.low.width = 320;
      this.low.height = 180;
      this.lctx = this.low.getContext('2d');
    }

    draw(match, dt) {
      const ctx = this.engine.ctx;
      this.time += 1 / 60;
      if (!match) { KIT.idle(ctx, 'PIXEL'); return; }
      this.ensure();
      if (!this.lctx) { KIT.idle(ctx, 'PIXEL'); return; }

      const fs = match.fighters.filter(f => f.active);
      const camFull = KIT.camera(fs, this.cam, 1 / 60);
      this.projectPoint = (x, y) => camFull.P(x, y);

      const k = 0.25;
      const cam = {
        camX: camFull.camX,
        S: camFull.S * k,
        W: 320, H: 180,
        groundY: camFull.groundY * k,
        P: (x, y) => ({ x: 160 + (x - camFull.camX) * camFull.S * k, y: camFull.groundY * k - y * camFull.S * k })
      };

      const g = this.lctx;
      g.imageSmoothingEnabled = false;
      this.world(g, match, cam, camFull);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.low, 0, 0, 320, 180, 0, 0, 1280, 720);
      ctx.imageSmoothingEnabled = true;

      FE.hud.draw(ctx, match, this);
    }

    world(g, match, cam, camFull) {
      const W = 320, H = 180, G = cam.groundY;

      /* 天空：色带 + 棋盘抖动 */
      const st = FE.stageTheme();
      const bands = st ? st.sky : ['#1a1030', '#3d1f45', '#8a3b4a', '#d9704a'];
      for (let i = 0; i < bands.length; i++) {
        g.fillStyle = bands[i];
        g.fillRect(0, Math.floor(G * i / bands.length), W, Math.ceil(G / bands.length) + 1);
      }
      // 太阳
      g.fillStyle = '#ffd98a';
      g.fillRect(228, Math.floor(G * 0.28), 22, 22);
      g.fillStyle = '#ffe9b8';
      g.fillRect(232, Math.floor(G * 0.28) + 4, 14, 14);

      // 远山（阶梯状）
      g.fillStyle = '#241a38';
      for (let x = 0; x < W; x += 8) {
        const h = 14 + Math.round(Math.sin((x + cam.camX * 0.06) * 0.06) * 8);
        g.fillRect(x, G - h, 8, h);
      }
      g.fillStyle = '#151022';
      for (let x = 0; x < W; x += 8) {
        const h = 8 + Math.round(Math.sin((x + cam.camX * 0.12) * 0.09 + 2) * 5);
        g.fillRect(x, G - h, 8, h);
      }

      /* 地面 */
      g.fillStyle = st && st.ground ? st.ground[0] : '#2a1f2c';
      g.fillRect(0, G, W, H - G);
      g.fillStyle = st && st.ground ? st.ground[1] : '#3a2a38';
      for (let y = G; y < H; y += 4) {
        for (let x = (y % 8 === 0 ? 0 : 4); x < W; x += 8) {
          if ((x + y) % 16 === 0) g.fillRect(x, y, 4, 2);
        }
      }
      // 地平线
      g.fillStyle = '#ff9a5a';
      g.fillRect(0, G - 1, W, 1);

      /* 影子 */
      for (const f of match.fighters) {
        if (!f.active) continue;
        const p = cam.P(f.x, 0);
        const w = Math.max(6, Math.round(26 * cam.S / 1.6));
        g.fillStyle = 'rgba(0,0,0,.5)';
        g.fillRect(Math.round(p.x - w / 2), Math.round(p.y) - 1, w, 3);
      }

      /* 角色 */
      for (const f of match.fighters) {
        if (!f.active && f.state !== 'ko') continue;
        this.pxFighter(g, f, cam);
      }

      /* 特效（块状） */
      for (const fx of match.fx) {
        const p = cam.P(fx.x, fx.y);
        const t = fx.t / fx.life;
        if (fx.type === 'hit') {
          const r = Math.max(2, Math.round((6 + t * 16) * fx.power));
          g.fillStyle = t < 0.4 ? '#ffffff' : '#ffd23d';
          g.fillRect(Math.round(p.x - r), Math.round(p.y - 2), r * 2, 4);
          g.fillRect(Math.round(p.x - 2), Math.round(p.y - r), 4, r * 2);
          g.fillStyle = '#ff6a3d';
          g.fillRect(Math.round(p.x - r * 0.7), Math.round(p.y - r * 0.7), 3, 3);
          g.fillRect(Math.round(p.x + r * 0.4), Math.round(p.y + r * 0.5), 3, 3);
        } else if (fx.type === 'guard') {
          g.strokeStyle = '#8ecdff';
          g.lineWidth = 1;
          g.beginPath();
          g.arc(p.x, p.y, 10 + t * 8, -1.2, 1.2);
          g.stroke();
        }
      }
      // 投射物
      for (const pr of match.combat.projectiles) {
        const p = cam.P(pr.x, pr.y + pr.h / 2);
        g.fillStyle = '#fff3c4';
        g.fillRect(Math.round(p.x - 3), Math.round(p.y - 3), 6, 6);
        g.fillStyle = '#ff9a3d';
        g.fillRect(Math.round(p.x - 5), Math.round(p.y - 1), 10, 2);
      }
    }

    pxFighter(g, f, cam) {
      const fig = this.fighter(f, cam);
      const { j, P, look } = fig;
      const pal = f.def.palette;
      const q = (n) => Math.round(n);

      const bone = (a, b, col) => {
        const pa = P(j[a]), pb = P(j[b]);
        const thick = Math.max(1, Math.round((KIT.THICK[a + '|' + b] || 12) * cam.S / 1.6));
        // 像素直线：用矩形近似
        const dx = q(pb.x) - q(pa.x), dy = q(pb.y) - q(pa.y);
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        g.fillStyle = col;
        for (let i = 0; i <= steps; i++) {
          const t = steps ? i / steps : 0;
          const x = q(pa.x + dx * t), y = q(pa.y + dy * t);
          g.fillRect(x - Math.floor(thick / 2), y - Math.floor(thick / 2), thick, thick);
        }
      };

      const flash = f.flash > 0;
      const dark = flash ? '#ffffff' : pal.dark;
      const main = flash ? '#ffffff' : pal.main;
      const skin = flash ? '#ffffff' : pal.skin;

      // 后侧
      bone('hipR', 'kneeR', dark);
      bone('kneeR', 'footR', dark);
      bone('shoulderR', 'elbowR', dark);
      bone('elbowR', 'handR', skin);
      // 躯干
      bone('pelvis', 'chest', main);
      // 腰带
      const bp = P({ x: j.pelvis.x, y: j.pelvis.y + 6 });
      g.fillStyle = pal.belt;
      g.fillRect(q(bp.x) - 5, q(bp.y) - 1, 10, 3);
      // 头
      const hp = P(j.head);
      const r = Math.max(3, Math.round(17 * fig.S / 1.6));
      g.fillStyle = skin;
      g.fillRect(q(hp.x) - r, q(hp.y) - r, r * 2, r * 2);
      KIT.hair(g, hp, r, look, flash ? '#fff' : pal.hair, null);
      // 眼
      if (f.state !== 'ko') {
        g.fillStyle = '#111';
        g.fillRect(q(hp.x + f.facing * 2), q(hp.y) - 1, 2, 2);
      }
      // 前侧
      bone('hipL', 'kneeL', main);
      bone('kneeL', 'footL', flash ? '#fff' : pal.light);
      bone('shoulderL', 'elbowL', main);
      bone('elbowL', 'handL', skin);
      // 拳
      const hand = P(j.handL);
      g.fillStyle = pal.accent;
      g.fillRect(q(hand.x) - 1, q(hand.y) - 1, 3, 3);

      if (!fig.adapted) {
        const p = cam.P(f.x, f.y + 190);
        g.fillStyle = '#ffd23d';
        g.fillRect(q(p.x) - 6, q(p.y), 12, 2);
      }
    }
  }

  /* ==========================================================
     2) INK — 水墨
     ========================================================== */
  class InkRenderer extends StyleBase {
    constructor(engine) {
      super(engine, 'ink');
      this.paperCanvas = null;
    }

    ensurePaper() {
      if (this.paperCanvas || typeof document === 'undefined') return;
      const c = document.createElement('canvas');
      c.width = 1280; c.height = 720;
      const g = c.getContext('2d');
      g.fillStyle = '#efe7d6';
      g.fillRect(0, 0, 1280, 720);
      // 纤维
      let seed = 1337;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 1400; i++) {
        const x = rnd() * 1280, y = rnd() * 720;
        const len = 4 + rnd() * 26;
        const a = (rnd() - 0.5) * 0.4;
        g.strokeStyle = `rgba(180,168,146,${0.05 + rnd() * 0.1})`;
        g.lineWidth = 0.6 + rnd();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
      // 四角做旧
      const vg = g.createRadialGradient(640, 360, 240, 640, 360, 760);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(120,100,70,.22)');
      g.fillStyle = vg;
      g.fillRect(0, 0, 1280, 720);
      this.paperCanvas = c;
    }

    draw(match, dt) {
      const ctx = this.engine.ctx;
      this.time += 1 / 60;
      this.ensurePaper();
      if (!match) { KIT.idle(ctx, 'INK'); return; }

      const fs = match.fighters.filter(f => f.active);
      const cam = KIT.camera(fs, this.cam, 1 / 60);
      this.projectPoint = (x, y) => cam.P(x, y);

      if (this.paperCanvas) ctx.drawImage(this.paperCanvas, 0, 0);
      else { ctx.fillStyle = '#efe7d6'; ctx.fillRect(0, 0, 1280, 720); }

      this.landscape(ctx, cam);
      for (const f of match.fighters) {
        if (!f.active && f.state !== 'ko') continue;
        this.inkFighter(ctx, f, cam);
      }
      KIT.fx(ctx, match, cam, { ringOnly: true, ringColor: '25,25,25', spikes: false });
      this.inkHud(ctx, match);
      this.projectPoint = (x, y) => cam.P(x, y);
    }

    landscape(ctx, cam) {
      // 远山：淡墨一抹
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.moveTo(-40, cam.groundY);
      for (let x = -40; x <= 1320; x += 20) {
        const t = (x + cam.camX * 0.1) * 0.005;
        const y = cam.groundY - 90 - Math.sin(t * 1.7) * 46 - Math.sin(t * 4.1) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(1320, cam.groundY);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      ctx.moveTo(-40, cam.groundY);
      for (let x = -40; x <= 1320; x += 20) {
        const t = (x + cam.camX * 0.22) * 0.007 + 2;
        const y = cam.groundY - 42 - Math.sin(t * 2.1) * 26;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(1320, cam.groundY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 地平线：一笔枯笔
      ctx.save();
      ctx.strokeStyle = 'rgba(30,30,30,.55)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, cam.groundY);
      for (let x = 0; x <= 1280; x += 26) {
        ctx.lineTo(x, cam.groundY + Math.sin(x * 0.07) * 1.2);
      }
      ctx.stroke();
      ctx.restore();
    }

    brush(ctx, a, b, w1, w2, alpha) {
      ctx.fillStyle = `rgba(22,20,18,${alpha})`;
      KIT.taper(ctx, a, b, w1, w2);
      ctx.fill();
    }

    inkFighter(ctx, f, cam) {
      const fig = this.fighter(f, cam);
      const { j, P, look, S } = fig;
      const pal = f.def.palette;
      const k = S / 1.6;
      const widthOf = (key, w) => Math.max(1.2, w * k * 0.55);

      const drawBone = (a, b, w, alpha) => {
        const pa = P(j[a]), pb = P(j[b]);
        const w1 = widthOf(a, w), w2 = widthOf(b, w * 0.86);
        // 湿笔晕开
        this.brush(ctx, pa, pb, w1 * 1.9, w2 * 1.9, alpha * 0.14);
        // 主笔
        this.brush(ctx, pa, pb, w1, w2, alpha);
        // 飞白
        if (alpha > 0.5) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          ctx.beginPath();
          ctx.ellipse(mx, my, w1 * 0.35, w1 * 0.12, Math.atan2(pb.y - pa.y, pb.x - pa.x), 0, 7);
          ctx.fill();
          ctx.restore();
        }
      };

      const A = f.state === 'ko' ? 0.5 : 0.88;

      drawBone('hipR', 'kneeR', 15, A * 0.7);
      drawBone('kneeR', 'footR', 12, A * 0.7);
      drawBone('shoulderR', 'elbowR', 12, A * 0.7);
      drawBone('elbowR', 'handR', 10, A * 0.7);
      drawBone('pelvis', 'chest', 30, A);
      drawBone('chest', 'neck', 12, A);
      drawBone('hipL', 'kneeL', 16, A);
      drawBone('kneeL', 'footL', 13, A);
      drawBone('shoulderL', 'elbowL', 13, A);
      drawBone('elbowL', 'handL', 11, A);

      // 头
      const hp = P(j.head);
      const r = 15 * k;
      ctx.fillStyle = `rgba(22,20,18,${A})`;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, 7); ctx.fill();
      // 头发用淡一档的墨，避免与头部糊成一团
      KIT.hair(ctx, hp, r * 0.94, look, `rgba(22,20,18,${A * 0.62})`, `rgba(22,20,18,${A * 0.35})`);

      // 腰带：全画唯一彩色，朱红
      const bp = P({ x: j.pelvis.x, y: j.pelvis.y + 6 });
      ctx.fillStyle = 'rgba(178,52,40,.85)';
      ctx.fillRect(bp.x - 15 * k, bp.y - 3 * k, 30 * k, 6 * k);
      // 飘带
      ctx.strokeStyle = 'rgba(178,52,40,.7)';
      ctx.lineWidth = 4 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bp.x - f.facing * 12 * k, bp.y);
      ctx.quadraticCurveTo(
        bp.x - f.facing * 34 * k, bp.y + 20 * k + Math.sin(this.time * 4) * 6 * k,
        bp.x - f.facing * 50 * k, bp.y + 38 * k
      );
      ctx.stroke();

      if (!fig.adapted) {
        const p = cam.P(f.x, f.y + 196);
        ctx.fillStyle = 'rgba(178,52,40,.9)';
        ctx.font = '700 10px "Segoe UI",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('替身', p.x, p.y);
        ctx.textAlign = 'left';
      }
    }

    /** 水墨专用 HUD：细线 + 朱印 */
    inkHud(ctx, match) {
      const p1 = match.sides[0].active(), p2 = match.sides[1].active();
      const draw = (f, side) => {
        if (!f) return;
        const w = 420, x = side === 0 ? 48 : 1280 - 48 - w, y = 42;
        const r = U.clamp(f.health / f.maxHealth, 0, 1);
        ctx.save();
        ctx.strokeStyle = 'rgba(30,28,24,.75)';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(x, y, w, 16);
        ctx.fillStyle = 'rgba(30,28,24,.82)';
        if (side === 0) ctx.fillRect(x, y, w * r, 16);
        else ctx.fillRect(x + w * (1 - r), y, w * r, 16);
        ctx.fillStyle = 'rgba(30,28,24,.9)';
        ctx.font = '600 15px "Songti SC","SimSun",serif';
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.fillText(f.def.name, side === 0 ? x : x + w, y + 36);
        ctx.font = '500 10px "JetBrains Mono",monospace';
        ctx.fillStyle = 'rgba(30,28,24,.5)';
        ctx.fillText(f.def.title || '', side === 0 ? x : x + w, y + 50);
        ctx.restore();
        ctx.textAlign = 'left';
      };
      draw(p1, 0); draw(p2, 1);

      // 计时：朱印
      const t = Math.max(0, Math.ceil(match.timer / 60));
      ctx.save();
      ctx.fillStyle = 'rgba(178,52,40,.9)';
      ctx.beginPath();
      ctx.arc(640, 62, 26, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#f6efe2';
      ctx.font = '700 22px "JetBrains Mono",monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(t).padStart(2, '0'), 640, 70);
      ctx.restore();
      ctx.textAlign = 'left';

      // 连段
      for (const side of [0, 1]) {
        const f = side === 0 ? p1 : p2;
        if (!f || f.comboCount < 2) continue;
        const x = side === 0 ? 110 : 1170;
        ctx.save();
        ctx.fillStyle = 'rgba(178,52,40,.9)';
        ctx.font = '800 40px "Songti SC","SimSun",serif';
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.fillText(f.comboCount + ' 连', x, 190);
        ctx.restore();
      }
      ctx.textAlign = 'left';
    }
  }

  /* ==========================================================
     3) NEON — 霓虹
     ========================================================== */
  class NeonRenderer extends StyleBase {
    constructor(engine) {
      super(engine, 'neon');
      this.scan = null;
    }

    ensureScan() {
      if (this.scan || typeof document === 'undefined') return;
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(0, 0, 4, 2);
      this.scan = c;
    }

    render(ctx, match, cam) {
      this.ensureScan();
      this.bg(ctx, cam);

      for (const f of match.fighters) {
        if (!f.active && f.state !== 'ko') continue;
        this.neonFighter(ctx, f, cam);
      }

      KIT.fx(ctx, match, cam, { mid: '255,120,220', edge: '120,80,255', spike: '255,255,255', guard: '120,230,255' });

      // 扫描线
      if (this.scan) {
        const pat = ctx.createPattern(this.scan, 'repeat');
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, 1280, 720); }
      }
      // 暗角
      const vg = ctx.createRadialGradient(640, 360, 260, 640, 360, 820);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.62)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, 1280, 720);
    }

    bg(ctx, cam) {
      ctx.fillStyle = '#05030d';
      ctx.fillRect(0, 0, 1280, 720);

      const horizon = cam.groundY;

      // 天幕
      const g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, '#0a0620');
      g.addColorStop(0.6, '#160b2e');
      g.addColorStop(1, '#2a0f3a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, horizon);

      // 太阳：同心圆
      ctx.save();
      ctx.strokeStyle = 'rgba(255,80,160,.30)';
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(880 - cam.camX * 0.06, horizon - 300, 46 + i * 26, 0, 7);
        ctx.stroke();
      }
      ctx.restore();

      // 透视网格地面
      ctx.save();
      ctx.strokeStyle = 'rgba(80,240,255,.30)';
      ctx.lineWidth = 1;
      for (let i = -14; i <= 14; i++) {
        const x = 640 + i * 70 - (cam.camX % 70);
        ctx.beginPath();
        ctx.moveTo(640 + (x - 640) * 0.12, horizon);
        ctx.lineTo(x * 1.9 - 640 * 0.9, 720);
        ctx.stroke();
      }
      let z = 0;
      for (let i = 0; i < 14; i++) {
        const yy = horizon + Math.pow(i / 13, 2.1) * (720 - horizon);
        ctx.strokeStyle = `rgba(255,80,200,${0.30 - i * 0.015})`;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(1280, yy);
        ctx.stroke();
      }
      ctx.restore();

      // 地平线光带
      const hg = ctx.createLinearGradient(0, horizon - 6, 0, horizon + 6);
      hg.addColorStop(0, 'rgba(120,240,255,0)');
      hg.addColorStop(0.5, 'rgba(160,250,255,.85)');
      hg.addColorStop(1, 'rgba(120,240,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, horizon - 6, 1280, 12);
    }

    neonFighter(ctx, f, cam) {
      const fig = this.fighter(f, cam);
      const { j, P, look, S } = fig;
      const pal = f.def.palette;
      const k = S / 1.6;
      const aura = pal.aura || '#5fd8ff';

      // 拖影
      for (const t of f.trail) {
        const a = 1 - t.t / 10;
        const p = cam.P(t.x, t.y);
        ctx.save();
        ctx.globalAlpha = a * 0.10;
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 90 * k, 22 * k, 70 * k, 0, 0, 7);
        ctx.fill();
        ctx.restore();
      }

      const strokeAll = (width, color, blur, alpha) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        for (const [a, b] of KIT.BONES) {
          const pa = P(j[a]), pb = P(j[b]);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
        ctx.restore();
      };

      // 外层辉光
      strokeAll(11 * k, aura, 26, 0.30);
      strokeAll(6 * k, aura, 14, 0.75);
      // 内核
      strokeAll(1.8 * k, '#ffffff', 8, 0.95);

      // 头
      const hp = P(j.head);
      const r = 15 * k;
      ctx.save();
      ctx.strokeStyle = aura;
      ctx.lineWidth = 2 * k;
      ctx.shadowColor = aura;
      ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, 7); ctx.stroke();
      ctx.restore();
      KIT.hair(ctx, hp, r, look, 'rgba(10,6,24,.9)', aura);

      // 眼
      if (f.state !== 'ko') {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 10;
        ctx.fillRect(hp.x + f.facing * 5 * k - 1, hp.y - 2 * k, 4 * k, 2 * k);
        ctx.restore();
      }

      // 腰带
      const bp = P({ x: j.pelvis.x, y: j.pelvis.y + 6 });
      ctx.save();
      ctx.strokeStyle = pal.accent || '#ff4dd2';
      ctx.lineWidth = 4 * k;
      ctx.shadowColor = pal.accent || '#ff4dd2';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(bp.x - 15 * k, bp.y);
      ctx.lineTo(bp.x + 15 * k, bp.y);
      ctx.stroke();
      ctx.restore();

      if (!fig.adapted) {
        const p = cam.P(f.x, f.y + 196);
        ctx.save();
        ctx.fillStyle = '#ffd23d';
        ctx.shadowColor = '#ffd23d';
        ctx.shadowBlur = 10;
        ctx.font = '700 9px "JetBrains Mono",monospace';
        ctx.textAlign = 'center';
        ctx.fillText('AUTO', p.x, p.y);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }
  }

  /* ==========================================================
     4) TOON — 赛璐璐
     ========================================================== */
  class ToonRenderer extends StyleBase {
    constructor(engine) {
      super(engine, 'toon');
      this.flash = 0;
    }

    render(ctx, match, cam) {
      this.flash = Math.max(0, this.flash - 1);
      this.sky(ctx, cam);

      // 速度线
      this.speedLines(ctx, cam, match);

      for (const f of match.fighters) {
        if (!f.active && f.state !== 'ko') continue;
        this.toonFighter(ctx, f, cam);
      }

      KIT.fx(ctx, match, cam, { mid: '255,240,120', edge: '255,120,40' });

      // 冲击帧：命中瞬间整屏白闪
      if (match.shakeAmt > 9) this.flash = Math.max(this.flash, 2);
      if (this.flash > 0) {
        ctx.save();
        ctx.globalAlpha = this.flash * 0.10;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.restore();
      }
    }

    sky(ctx, cam) {
      const st = FE.stageTheme();
      const stops = st ? st.sky : ['#1b3fa8', '#4f8ede', '#a8d8f0'];
      const g = ctx.createLinearGradient(0, 0, 0, cam.groundY);
      for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, cam.groundY);

      // 太阳 + 光晕
      const sx = 980 - cam.camX * 0.05, sy = 150;
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath(); ctx.arc(sx, sy, 54, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,200,.5)';
      ctx.lineWidth = 3;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(sx, sy, 54 + i * 16, 0, 7); ctx.stroke();
      }

      // 云：硬边色块
      const clouds = [[200, 120, 90], [520, 90, 120], [820, 170, 70]];
      for (const [cx, cy, cw] of clouds) {
        const x = cx - cam.camX * 0.08;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.ellipse(x, cy, cw, cw * 0.34, 0, 0, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,220,255,.9)';
        ctx.beginPath();
        ctx.ellipse(x + cw * 0.1, cy + cw * 0.16, cw * 0.9, cw * 0.18, 0, 0, 7);
        ctx.fill();
      }

      // 地面
      const st2 = FE.stageTheme();
      ctx.fillStyle = st2 && st2.ground ? st2.ground[0] : '#3a6b3f';
      ctx.fillRect(0, cam.groundY, 1280, 720 - cam.groundY);
      ctx.fillStyle = st2 && st2.ground ? st2.ground[1] : '#2c5231';
      ctx.fillRect(0, cam.groundY, 1280, 10);
      // 草地纹理
      ctx.strokeStyle = 'rgba(20,50,25,.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 60; i++) {
        const x = (i * 137 - cam.camX * 1.2) % 1320;
        ctx.beginPath();
        ctx.moveTo(x, cam.groundY + 22 + (i % 4) * 18);
        ctx.lineTo(x + 6, cam.groundY + 8 + (i % 4) * 18);
        ctx.stroke();
      }
    }

    speedLines(ctx, cam, match) {
      // 有人冲刺/被打飞时画放射线
      let intensity = 0;
      for (const f of match.fighters) {
        if (Math.abs(f.vel.x) > 5) intensity = Math.max(intensity, 0.5);
        if (f.state === 'hitstun' && f.stateTime < 8) intensity = Math.max(intensity, 0.8);
      }
      if (intensity <= 0) return;
      const cx = 640, cy = cam.groundY - 120;
      ctx.save();
      ctx.globalAlpha = intensity * 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const a = i * Math.PI * 2 / 26 + this.time * 0.6;
        const r1 = 260, r2 = 620;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }

    toonFighter(ctx, f, cam) {
      const fig = this.fighter(f, cam);
      const { j, P, look, S } = fig;
      const pal = f.def.palette;
      const k = S / 1.6;
      const OL = '#12100f';
      const flash = f.flash > 0;

      const line = (a, b, w, color, outline) => {
        const pa = P(j[a]), pb = P(j[b]);
        ctx.lineCap = 'round';
        if (outline) {
          ctx.strokeStyle = OL;
          ctx.lineWidth = w * k + 6 * k;
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = w * k;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      };

      const dark = flash ? '#fff' : pal.dark;
      const main = flash ? '#fff' : pal.main;
      const light = flash ? '#fff' : pal.light;
      const skin = flash ? '#fff' : pal.skin;

      // 后侧（暗部）
      line('hipR', 'kneeR', 16, dark, true);
      line('kneeR', 'footR', 13, dark, true);
      line('shoulderR', 'elbowR', 13, dark, true);
      line('elbowR', 'handR', 11, skin, true);

      // 躯干
      line('pelvis', 'chest', 34, main, true);
      // 赛璐璐高光
      const pc = P(j.pelvis), cc = P(j.chest);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = light;
      ctx.lineWidth = 8 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pc.x - f.facing * 6 * k, pc.y);
      ctx.lineTo(cc.x - f.facing * 6 * k, cc.y);
      ctx.stroke();
      ctx.restore();

      // 头
      const hp = P(j.head);
      const r = 17 * k;
      ctx.fillStyle = OL;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r + 2.6 * k, 0, 7); ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, 7); ctx.fill();
      KIT.hair(ctx, hp, r, look, flash ? '#fff' : pal.hair, OL);

      // 眼（带高光）
      if (f.state !== 'ko' && f.state !== 'knockdown') {
        const ex = hp.x + f.facing * 7 * k, ey = hp.y - 1 * k;
        ctx.fillStyle = '#12100f';
        ctx.beginPath(); ctx.ellipse(ex, ey, 2.6 * k, 3.6 * k, 0, 0, 7); ctx.fill();
        ctx.fillStyle = pal.aura;
        ctx.beginPath(); ctx.arc(ex, ey, 1.4 * k, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex - 0.8 * k, ey - 1 * k, 0.7 * k, 0, 7); ctx.fill();
      }

      // 前侧
      line('hipL', 'kneeL', 17, main, true);
      line('kneeL', 'footL', 14, light, true);
      line('shoulderL', 'elbowL', 14, main, true);
      line('elbowL', 'handL', 12, skin, true);

      // 拳套
      const hand = P(j.handL);
      ctx.fillStyle = OL;
      ctx.beginPath(); ctx.arc(hand.x, hand.y, 9.5 * k, 0, 7); ctx.fill();
      ctx.fillStyle = pal.accent;
      ctx.beginPath(); ctx.arc(hand.x, hand.y, 7 * k, 0, 7); ctx.fill();

      // 腰带
      const bp = P({ x: j.pelvis.x, y: j.pelvis.y + 6 });
      ctx.strokeStyle = OL;
      ctx.lineWidth = 14 * k;
      ctx.beginPath(); ctx.moveTo(bp.x - 15 * k, bp.y); ctx.lineTo(bp.x + 15 * k, bp.y); ctx.stroke();
      ctx.strokeStyle = pal.belt;
      ctx.lineWidth = 9 * k;
      ctx.beginPath(); ctx.moveTo(bp.x - 15 * k, bp.y); ctx.lineTo(bp.x + 15 * k, bp.y); ctx.stroke();

      // 招式弧线
      if (f.state === 'attack' && f.move) {
        const m = f.move;
        if (f.moveFrame >= m.activeFrom && f.moveFrame <= m.activeTo + 1) {
          const t = U.clamp((f.moveFrame - m.activeFrom) / Math.max(1, m.active), 0, 1);
          ctx.save();
          ctx.globalAlpha = (1 - t) * 0.75;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 12 * k * (1 - t * 0.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          const c = P({ x: j.chest.x, y: j.chest.y });
          const R = (m.hitbox.w * 0.8 + 40) * k;
          ctx.arc(c.x, c.y, R, f.facing > 0 ? -1.3 : Math.PI + 0.2, f.facing > 0 ? 0.8 : Math.PI + 2.0);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (!fig.adapted) {
        const p = cam.P(f.x, f.y + 200);
        ctx.fillStyle = '#ffd23d';
        ctx.strokeStyle = '#12100f';
        ctx.lineWidth = 2;
        ctx.font = '800 10px "Segoe UI",sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText('AUTO', p.x, p.y);
        ctx.fillText('AUTO', p.x, p.y);
        ctx.textAlign = 'left';
      }
    }
  }

  /* ---------------- 注册 ---------------- */
  FE.renderers.register('pixel', {
    name: '像素风', short: 'PIXEL',
    desc: '低分辨率离屏缓冲 + 最近邻放大，零模型自动生成',
    create(engine) { return new PixelRenderer(engine); }
  });
  FE.renderers.register('ink', {
    name: '水墨风', short: 'INK',
    desc: '宣纸底 + 毛笔笔触 + 朱印，全部实时笔刷生成',
    create(engine) { return new InkRenderer(engine); }
  });
  FE.renderers.register('neon', {
    name: '霓虹风', short: 'NEON',
    desc: '暗场 + 加色辉光 + 拖影 + 扫描线',
    create(engine) { return new NeonRenderer(engine); }
  });
  FE.renderers.register('toon', {
    name: '赛璐璐', short: 'TOON',
    desc: '平涂 + 粗描边 + 冲击帧，动画片质感',
    create(engine) { return new ToonRenderer(engine); }
  });
})();
