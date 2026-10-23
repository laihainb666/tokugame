/* ==========================================================
   Renderer3D — 自研轻量 3D 后端
   ----------------------------------------------------------
   不依赖任何 3D 库：自己算相机基向量、透视投影、面法线、
   深度排序、平面着色。角色是"骨骼盒体"拼的，所以零美术资源
   也能有体积感和 3/4 视角。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const YAW = 0.30;                  // 角色绕 Y 轴偏转，产生 3/4 视角
  const COS = Math.cos(YAW), SIN = Math.sin(YAW);
  const LIGHT = norm({ x: 0.45, y: 0.82, z: -0.36 });

  /* ---------------- 向量工具 ---------------- */
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function mul(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function len(a) { return Math.hypot(a.x, a.y, a.z) || 1; }
  function norm(a) { const l = len(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; }
  function scaleColor(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.min(255, r * k) | 0; g = Math.min(255, g * k) | 0; b = Math.min(255, b * k) | 0;
    return `rgb(${r},${g},${b})`;
  }

  /* ---------------- 相机 ---------------- */
  function makeCamera(eye, target, fov, W, H) {
    const fwd = norm(sub(target, eye));
    // 相机朝 +z 看时，屏幕右方 = +x，所以 right 用 cross(up, fwd)
    let right = cross({ x: 0, y: 1, z: 0 }, fwd);
    if (len(right) < 0.001) right = { x: 1, y: 0, z: 0 };
    right = norm(right);
    const up = cross(fwd, right);
    return { eye, fwd, right, up, f: (H / 2) / Math.tan(fov / 2), W, H };
  }
  function project(p, cam) {
    const d = sub(p, cam.eye);
    const z = dot(d, cam.fwd);
    if (z < 6) return null;
    const x = dot(d, cam.right);
    const y = dot(d, cam.up);
    const s = cam.f / z;
    return { x: cam.W / 2 + x * s, y: cam.H / 2 - y * s, z };
  }

  class Renderer3D {
    constructor(engine) {
      this.engine = engine;
      this.time = 0;
      this.camX = 0;
      this.camZoom = 1;
      this.faces = [];
      this.uid = 'r3d';
    }

    destroy() { this.faces.length = 0; }

    draw(match, dt) {
      const ctx = this.engine.ctx;
      const W = 1280, H = 720;
      this.time += 1 / 60;
      if (!match) { this.drawEmpty(ctx, W, H); return; }

      /* --- 相机跟随 --- */
      const fs = match.fighters.filter(f => f.active && !f.isGhost);
      let midX = 0, maxD = 200;
      if (fs.length) {
        let mn = 1e9, mx = -1e9;
        for (const f of fs) { mn = Math.min(mn, f.x); mx = Math.max(mx, f.x); }
        midX = (mn + mx) / 2;
        maxD = mx - mn;
      }
      this.camX = U.damp(this.camX, midX * 0.55, 4, 1 / 60);
      const wantZoom = U.clamp(1.28 - maxD / 1500, 0.82, 1.25);
      this.camZoom = U.damp(this.camZoom, wantZoom, 3, 1 / 60);

      const shake = match.shakeAmt || 0;
      const sx = (Math.random() - 0.5) * shake * 1.6;
      const sy = (Math.random() - 0.5) * shake * 1.2;

      const eye = {
        x: this.camX + sx,
        y: 148 * this.camZoom + 34 + sy,
        z: -452 / this.camZoom
      };
      const target = { x: this.camX * 1.12, y: 92, z: 30 };
      const cam = makeCamera(eye, target, 0.86, W, H);
      this._cam = cam;
      this.projectPoint = (x, y, z) => project({ x, y, z: z || 0 }, cam);

      /* --- 背景 --- */
      this.drawSky(ctx, W, H, cam);
      this.drawFloor(ctx, W, H, cam);
      this.drawArena(ctx, W, H, cam);

      /* --- 收集所有面 --- */
      this.faces.length = 0;
      for (const f of match.fighters) {
        if (!f.active && f.state !== 'ko') continue;
        this.buildFighter(f, cam);
      }
      /* --- 按深度绘制 --- */
      this.faces.sort((a, b) => b.z - a.z);
      for (const face of this.faces) {
        ctx.beginPath();
        ctx.moveTo(face.pts[0].x, face.pts[0].y);
        for (let i = 1; i < face.pts.length; i++) ctx.lineTo(face.pts[i].x, face.pts[i].y);
        ctx.closePath();
        ctx.fillStyle = face.color;
        ctx.fill();
        if (face.stroke) {
          ctx.strokeStyle = face.stroke;
          ctx.lineWidth = face.lw || 1.2;
          ctx.stroke();
        }
      }

      /* --- 特效层 --- */
      this.drawFx(ctx, match, cam);
      this.drawProjectiles(ctx, match, cam);

      /* --- HUD --- */
      if (FE.hud) FE.hud.draw(ctx, match, this);
    }

    drawEmpty(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0b1020'); g.addColorStop(1, '#05070d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2a3350';
      ctx.font = '600 16px "Segoe UI"'; ctx.textAlign = 'center';
      ctx.fillText('NEXUS FIGHT', W / 2, H / 2);
    }

    /* ---------------- 天空 ---------------- */
    drawSky(ctx, W, H, cam) {
      const st = FE.stageTheme();
      const stops = st ? st.sky : ['#1b1f3a', '#4a3560', '#c05a45', '#f0a24a'];
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
      const n = stops.length;
      for (let i = 0; i < n; i++) g.addColorStop(n === 1 ? 0 : i / (n - 1), stops[i]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H * 0.72);

      // 太阳
      const sunX = W / 2 - this.camX * 0.12;
      const sunY = H * 0.55;
      const rg = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 190);
      rg.addColorStop(0, 'rgba(255,236,180,.95)');
      rg.addColorStop(0.22, 'rgba(255,190,90,.55)');
      rg.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(sunX, sunY, 190, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,244,214,.9)';
      ctx.beginPath(); ctx.arc(sunX, sunY, 46, 0, 7); ctx.fill();

      // 远山
      const layers = [
        { y: H * 0.58, amp: 60, c: '#2a2438', p: 0.06, seed: 1.2 },
        { y: H * 0.63, amp: 44, c: '#1d1a2b', p: 0.12, seed: 3.7 }
      ];
      for (const L of layers) {
        ctx.beginPath();
        ctx.moveTo(-50, H);
        const off = -this.camX * L.p;
        for (let x = -50; x <= W + 50; x += 18) {
          const t = (x + off) * 0.006;
          const y = L.y - Math.sin(t * 1.7 + L.seed) * L.amp - Math.sin(t * 4.3 + L.seed * 2) * L.amp * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W + 50, H); ctx.closePath();
        ctx.fillStyle = L.c; ctx.fill();
      }
    }

    /* ---------------- 地面 ---------------- */
    drawFloor(ctx, W, H, cam) {
      const zNear = -420, zFar = 620, half = 1000;
      const corners = [
        project({ x: -half, y: 0, z: zNear }, cam),
        project({ x: half, y: 0, z: zNear }, cam),
        project({ x: half, y: 0, z: zFar }, cam),
        project({ x: -half, y: 0, z: zFar }, cam)
      ];
      if (corners.some(c => !c)) return;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      const st = FE.stageTheme();
      const g = ctx.createLinearGradient(0, H * 0.42, 0, H);
      if (st && st.ground) {
        for (let i = 0; i < st.ground.length; i++) {
          g.addColorStop(i / (st.ground.length - 1), st.ground[i]);
        }
      } else {
        g.addColorStop(0, '#5a4048');
        g.addColorStop(0.3, '#3b2b34');
        g.addColorStop(0.7, '#2a1e26');
        g.addColorStop(1, '#1a1219');
      }
      ctx.fillStyle = g; ctx.fill();

      // 透视网格
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath(); ctx.clip();

      ctx.strokeStyle = 'rgba(255,180,120,.10)';
      ctx.lineWidth = 1;
      for (let x = -900; x <= 900; x += 90) {
        const a = project({ x, y: 0, z: zNear }, cam);
        const b = project({ x, y: 0, z: zFar }, cam);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let z = zNear; z <= zFar; z += 90) {
        const a = project({ x: -half, y: 0, z }, cam);
        const b = project({ x: half, y: 0, z }, cam);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      // 中央擂台圆环
      ctx.strokeStyle = 'rgba(255,140,90,.22)';
      ctx.lineWidth = 2;
      for (const r of [140, 260]) {
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) {
          const a = i / 48 * Math.PI * 2;
          const p = project({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r * 0.5 + 100 }, cam);
          if (!p) continue;
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // 场地中央打光，让角色从暗地面里跳出来
      const c = project({ x: 0, y: 0, z: 90 }, cam);
      if (c) {
        const rg = ctx.createRadialGradient(c.x, c.y, 8, c.x, c.y, 360);
        rg.addColorStop(0, 'rgba(255,196,130,.30)');
        rg.addColorStop(0.5, 'rgba(255,150,90,.12)');
        rg.addColorStop(1, 'rgba(255,150,90,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 470, 145, 0, 0, 7); ctx.fill();
      }
    }

    /* ---------------- 场景装饰 ---------------- */
    drawArena(ctx, W, H, cam) {
      // 后方立柱
      for (let i = -3; i <= 3; i++) {
        const x = i * 300;
        const base = project({ x, y: 0, z: 340 }, cam);
        const top = project({ x, y: 300, z: 340 }, cam);
        if (!base || !top) continue;
        const w = (base.y - top.y) * 0.055;
        const g = ctx.createLinearGradient(base.x - w, 0, base.x + w, 0);
        g.addColorStop(0, '#1a1420'); g.addColorStop(0.5, '#2c2230'); g.addColorStop(1, '#150f19');
        ctx.fillStyle = g;
        ctx.fillRect(base.x - w, top.y, w * 2, base.y - top.y);
        // 柱头灯
        ctx.fillStyle = 'rgba(255,170,90,.85)';
        ctx.beginPath(); ctx.arc(base.x, top.y + 6, w * 0.7, 0, 7); ctx.fill();
        const rg = ctx.createRadialGradient(base.x, top.y + 6, 2, base.x, top.y + 6, w * 4);
        rg.addColorStop(0, 'rgba(255,160,80,.35)'); rg.addColorStop(1, 'rgba(255,160,80,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(base.x, top.y + 6, w * 4, 0, 7); ctx.fill();
      }
      // 远景飘浮灯笼
      for (let i = 0; i < 7; i++) {
        const bx = ((i * 197 + this.time * 8 * (i % 2 ? 1 : -1)) % 1600) - 400;
        const by = 120 + Math.sin(this.time * 0.7 + i) * 18 + i * 22;
        const p = project({ x: bx, y: by, z: 520 }, cam);
        if (!p) continue;
        const r = U.clamp(2200 / p.z, 2, 9);
        const rg = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r * 3);
        rg.addColorStop(0, 'rgba(255,200,120,.9)');
        rg.addColorStop(0.3, 'rgba(255,150,70,.5)');
        rg.addColorStop(1, 'rgba(255,120,50,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, 7); ctx.fill();
      }
    }

    /* ---------------- 角色构建 ---------------- */
    buildFighter(f, cam) {
      const pal = f.def.palette;
      const { j } = FE.anim.solve(f, this.time);
      const z0 = f.side === 0 ? -14 : 14;

      const W3 = (lx, ly) => ({
        x: f.x + lx * COS,
        y: f.y + ly,
        z: z0 - f.facing * lx * SIN
      });

      // 影子
      const shadowP = project({ x: f.x, y: 0.5, z: z0 }, cam);
      if (shadowP) {
        const sc = U.clamp(1 - f.y / 400, 0.35, 1);
        const c2 = this.engine.ctx;
        const rg = c2.createRadialGradient(shadowP.x, shadowP.y, 2, shadowP.x, shadowP.y, 52 * sc);
        rg.addColorStop(0, 'rgba(0,0,0,.62)');
        rg.addColorStop(0.6, 'rgba(0,0,0,.30)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        c2.fillStyle = rg;
        c2.beginPath();
        c2.ellipse(shadowP.x, shadowP.y, 54 * sc, 17 * sc, 0, 0, 7);
        c2.fill();
      }

      const hitFlash = f.flash > 0;
      const boost = hitFlash ? 1.9 : 1;

      const limb = (a, b, w, d, col, lw) => {
        const A = W3(a.x, a.y), B = W3(b.x, b.y);
        this.pushBone(A, B, w, d, col, cam, boost, lw);
      };

      /* 腿（后） */
      limb(j.hipR, j.kneeR, 17, 17, pal.dark);
      limb(j.kneeR, j.footR, 14, 14, pal.dark);
      /* 后臂 */
      limb(j.shoulderR, j.elbowR, 14, 14, pal.dark);
      limb(j.elbowR, j.handR, 12, 12, pal.skin);

      /* 躯干：腰 → 胸 → 肩，三段做出体块感 */
      const midX = U.lerp(j.pelvis.x, j.chest.x, 0.45);
      const midY = U.lerp(j.pelvis.y, j.chest.y, 0.45);
      this.pushBone(
        W3(j.pelvis.x, j.pelvis.y - 2), W3(midX, midY),
        32, 26, pal.dark, cam, boost
      );
      this.pushBone(
        W3(midX, midY), W3(j.chest.x, j.chest.y + 5),
        45, 31, pal.gi, cam, boost
      );
      // 肩
      this.pushBone(
        W3(j.shoulderL.x, j.shoulderL.y), W3(j.shoulderR.x, j.shoulderR.y),
        17, 29, pal.main, cam, boost
      );
      // 腰带
      this.pushBone(
        W3(j.pelvis.x, j.pelvis.y + 1), W3(j.pelvis.x, j.pelvis.y + 11),
        35, 29, pal.belt, cam, boost
      );

      /* 脖子 + 头 */
      this.pushBone(
        W3(j.chest.x, j.chest.y + 3), W3(j.head.x, j.head.y - 10),
        13, 13, pal.skin, cam, boost
      );
      const hc = W3(j.head.x, j.head.y);
      this.pushBone(
        { x: hc.x, y: hc.y - 11, z: hc.z },
        { x: hc.x, y: hc.y + 11, z: hc.z },
        22, 24, pal.skin, cam, boost
      );
      // 头发（只盖住头顶后半部分，别糊住脸）
      const hp = W3(j.head.x - f.facing * 3, j.head.y + 7);
      this.pushBone(
        { x: hp.x, y: hp.y - 2, z: hp.z },
        { x: hp.x, y: hp.y + 8, z: hp.z },
        24, 26, pal.hair, cam, boost
      );
      // 面部：朝向对方的一条窄色带，一眼能看出正反
      const fc = W3(j.head.x + f.facing * 9, j.head.y + 1);
      this.pushBone(
        { x: fc.x, y: fc.y - 3, z: fc.z },
        { x: fc.x, y: fc.y + 3, z: fc.z },
        6, 15, pal.accent, cam, boost
      );

      /* 前臂 */
      limb(j.shoulderL, j.elbowL, 15, 15, pal.main);
      limb(j.elbowL, j.handL, 13, 13, pal.skin);
      /* 前腿 */
      limb(j.hipL, j.kneeL, 18, 18, pal.main);
      limb(j.kneeL, j.footL, 15, 15, pal.light);

      /* 脚 */
      for (const ft of [j.footL, j.footR]) {
        const fw = W3(ft.x + f.facing * 5, ft.y - 2);
        this.pushBone(
          { x: fw.x, y: fw.y - 4, z: fw.z },
          { x: fw.x + f.facing * 15 * COS, y: fw.y - 4, z: fw.z - f.facing * 15 * SIN },
          14, 14, pal.dark, cam, boost
        );
      }

      /* 能量光晕 */
      if (f.meter >= FE.balance.maxMeter * 0.99) {
        const p = project({ x: f.x, y: f.y + 90, z: z0 }, cam);
        if (p) {
          const rg = this.engine.ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 130);
          rg.addColorStop(0, 'rgba(255,210,120,.18)');
          rg.addColorStop(1, 'rgba(255,210,120,0)');
          this.engine.ctx.fillStyle = rg;
          this.engine.ctx.beginPath(); this.engine.ctx.arc(p.x, p.y, 130, 0, 7); this.engine.ctx.fill();
        }
      }
      /* 拖影 */
      for (const t of f.trail) {
        const a = 1 - t.t / 10;
        const p = project({ x: t.x, y: t.y + 90, z: z0 }, cam);
        if (!p) continue;
        this.engine.ctx.fillStyle = `rgba(${hexRgb(pal.aura)},${a * 0.12})`;
        this.engine.ctx.beginPath();
        this.engine.ctx.ellipse(p.x, p.y, 26, 74, 0, 0, 7);
        this.engine.ctx.fill();
      }
    }

    /** 把一个骨节压成 6 个面推进排序队列 */
    pushBone(A, B, w, d, color, cam, boost, lw) {
      const dir = norm(sub(B, A));
      let u = cross(dir, { x: 0, y: 0, z: 1 });
      if (len(u) < 0.01) u = { x: 1, y: 0, z: 0 };
      u = norm(u);
      const v = norm(cross(dir, u));
      const hw = w / 2, hd = d / 2;

      const corner = (P, su, sv) => add(P, add(mul(u, su * hw), mul(v, sv * hd)));
      const pts3 = [
        corner(A, 1, 1), corner(A, 1, -1), corner(A, -1, -1), corner(A, -1, 1),
        corner(B, 1, 1), corner(B, 1, -1), corner(B, -1, -1), corner(B, -1, 1)
      ];
      const proj = pts3.map(p => project(p, cam));
      if (proj.some(p => !p)) return;

      const F = [
        [0, 1, 2, 3], [7, 6, 5, 4],
        [0, 4, 5, 1], [1, 5, 6, 2],
        [2, 6, 7, 3], [3, 7, 4, 0]
      ];
      const stroke = scaleColor(color, 0.42);
      for (const idx of F) {
        const p0 = pts3[idx[0]], p1 = pts3[idx[1]], p2 = pts3[idx[2]];
        const n = norm(cross(sub(p1, p0), sub(p2, p0)));
        const c = mul(p0, 1 / 3);
        const center3 = {
          x: (pts3[idx[0]].x + pts3[idx[1]].x + pts3[idx[2]].x + pts3[idx[3]].x) / 4,
          y: (pts3[idx[0]].y + pts3[idx[1]].y + pts3[idx[2]].y + pts3[idx[3]].y) / 4,
          z: (pts3[idx[0]].z + pts3[idx[1]].z + pts3[idx[2]].z + pts3[idx[3]].z) / 4
        };
        const viewDir = norm(sub(center3, cam.eye));
        if (dot(n, viewDir) > 0.02) continue;      // 背面剔除
        let lam = Math.max(0, -dot(n, LIGHT));
        lam = Math.round(lam * 4) / 4;             // 卡通分层
        let k = (0.64 + lam * 0.60) * boost;
        const rim = 1 - Math.abs(dot(n, viewDir));
        k += rim * 0.16;
        const zAvg = (proj[idx[0]].z + proj[idx[1]].z + proj[idx[2]].z + proj[idx[3]].z) / 4;
        this.faces.push({
          z: zAvg,
          pts: idx.map(i => proj[i]),
          color: scaleColor(color, Math.min(2.4, k)),
          stroke, lw: lw || 1.1
        });
      }
    }

    /* ---------------- 特效 ---------------- */
    drawFx(ctx, match, cam) {
      for (const fx of match.fx) {
        const t = fx.t / fx.life;
        const p = project({ x: fx.x, y: fx.y, z: 0 }, cam);
        if (!p) continue;
        const a = 1 - t;
        switch (fx.type) {
          case 'hit': {
            const R = (14 + t * 46) * fx.power;
            const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, R);
            g.addColorStop(0, `rgba(255,255,255,${a})`);
            g.addColorStop(0.35, `rgba(255,214,120,${a * 0.85})`);
            g.addColorStop(1, 'rgba(255,120,60,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
            // 星芒
            ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
            ctx.lineWidth = 2.5 * a;
            for (let i = 0; i < 6; i++) {
              const ang = fx.seed + i * Math.PI / 3 + t;
              const r1 = R * 0.5, r2 = R * (1.15 + Math.sin(t * 6) * 0.2);
              ctx.beginPath();
              ctx.moveTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1);
              ctx.lineTo(p.x + Math.cos(ang) * r2, p.y + Math.sin(ang) * r2);
              ctx.stroke();
            }
            break;
          }
          case 'guard': {
            ctx.strokeStyle = `rgba(120,200,255,${a})`;
            ctx.lineWidth = 4 * a;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 30 + t * 24, -1.2, 1.2);
            ctx.stroke();
            break;
          }
          case 'burst': {
            ctx.strokeStyle = `rgba(255,180,90,${a * 0.9})`;
            ctx.lineWidth = 3 * a;
            ctx.beginPath(); ctx.arc(p.x, p.y, (fx.size || 20) * (1 + t * 2.2), 0, 7); ctx.stroke();
            break;
          }
          case 'cast': {
            ctx.strokeStyle = `rgba(255,220,150,${a * 0.8})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 10 + t * 40, 0, 7); ctx.stroke();
            break;
          }
          case 'trail': {
            ctx.fillStyle = `rgba(255,190,120,${a * 0.5})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, (fx.size || 8) * a, 0, 7); ctx.fill();
            break;
          }
          case 'armor': {
            ctx.strokeStyle = `rgba(255,210,90,${a})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const ang = i * Math.PI / 3 - Math.PI / 2;
              const r = 46 * (1 + t * 0.3);
              const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath(); ctx.stroke();
            break;
          }
          case 'switch': {
            ctx.strokeStyle = `rgba(160,200,255,${a * 0.9})`;
            ctx.lineWidth = 3;
            for (let i = -2; i <= 2; i++) {
              ctx.beginPath();
              ctx.moveTo(p.x + i * 12, p.y + 100);
              ctx.lineTo(p.x + i * 12, p.y - 100 - t * 60);
              ctx.stroke();
            }
            break;
          }
          default: {
            ctx.fillStyle = `rgba(255,200,120,${a * 0.5})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, 12 * (1 - t), 0, 7); ctx.fill();
          }
        }
      }
    }

    drawProjectiles(ctx, match, cam) {
      for (const p of match.combat.projectiles) {
        const c = project({ x: p.x, y: p.y + p.h / 2, z: 0 }, cam);
        if (!c) continue;
        const col = p.element === 'fire' ? [255, 140, 60]
          : p.element === 'ice' ? [120, 210, 255]
            : p.element === 'earth' ? [210, 160, 80] : [200, 200, 255];
        const R = p.w * 0.85;
        const g = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, R);
        g.addColorStop(0, 'rgba(255,255,255,.95)');
        g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},.9)`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 7); ctx.fill();
        // 拖尾
        ctx.globalAlpha = 0.35;
        for (let i = 1; i <= 4; i++) {
          const tp = project({ x: p.x - Math.sign(p.vx) * i * 14, y: p.y + p.h / 2, z: 0 }, cam);
          if (!tp) continue;
          ctx.beginPath(); ctx.arc(tp.x, tp.y, R * (1 - i / 5), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function ctxEllipse(ctx, x, y, rx, ry, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  FE.renderers.register('3d', {
    name: '3D 实时', short: '3D',
    desc: '自研透视投影 + 面排序着色，3/4 视角',
    create(engine) { return new Renderer3D(engine); }
  });
})();
