/* ==========================================================
   Anim — 程序化骨架动画
   ----------------------------------------------------------
   没有骨骼文件、没有贴图，角色的每个动作都是"状态 + 帧进度"
   算出来的一组关节坐标。好处是：
     · 3D / 2.5D / 数据视图共用同一套骨架，绝不会不同步；
     · 模组加新招式只要指定 anim 类型，动画自动生成；
     · 零美术资源，任何新角色立刻能动。

   局部坐标系：原点在双脚中心，x 朝角色正面，y 向上。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const PI = Math.PI;

  /* 身体比例 */
  const BODY = {
    pelvisY: 96, torso: 52, neck: 7, headR: 15,
    upperArm: 30, foreArm: 27,
    thigh: 47, shin: 46, foot: 14
  };

  /* 默认站架角度 */
  const GUARD = {
    torso: 0.07, head: -0.04,
    shL: -1.18, elL: 1.85,
    shR: -1.30, elR: 1.95,
    hipL: -1.52, knL: 0.12,
    hipR: -1.44, knR: 0.20
  };

  function clonePose(p) {
    return {
      torso: p.torso, head: p.head,
      shL: p.shL, elL: p.elL, shR: p.shR, elR: p.elR,
      hipL: p.hipL, knL: p.knL, hipR: p.hipR, knR: p.knR,
      crouch: p.crouch || 0, lift: 0, rot: 0,
      sx: 1, sy: 1, glow: 0
    };
  }

  /* 招式动画：根据延伸量 ext(0~1) 改写姿态 */
  const ATTACKS = {
    jab(p, e) {
      p.shR = U.lerp(-1.30, -0.05, e);
      p.elR = U.lerp(1.95, 0.02, e);
      p.shL = U.lerp(-1.18, -1.55, e);
      p.torso += 0.14 * e;
      p.hipR -= 0.10 * e;
    },
    straight(p, e) {
      p.shR = U.lerp(-1.55, 0.02, e);
      p.elR = U.lerp(2.1, 0.0, e);
      p.shL = U.lerp(-1.18, -1.9, e);
      p.elL = U.lerp(1.85, 1.5, e);
      p.torso += 0.26 * e;
      p.hipR -= 0.22 * e;
      p.hipL += 0.10 * e;
    },
    kick_mid(p, e) {
      p.hipR = U.lerp(-1.44, -0.18, e);
      p.knR = U.lerp(0.20, 0.06, e);
      p.hipL = U.lerp(-1.52, -1.62, e);
      p.torso -= 0.30 * e;
      p.shL = U.lerp(-1.18, -2.1, e);
      p.shR = U.lerp(-1.30, -1.7, e);
    },
    crouch_jab(p, e) {
      p.crouch = Math.max(p.crouch, 0.85);
      p.shR = U.lerp(-1.35, -0.12, e);
      p.elR = U.lerp(1.95, 0.05, e);
      p.torso += 0.18 * e;
    },
    sweep(p, e) {
      p.crouch = 1;
      p.hipR = U.lerp(-1.44, -0.10, e);
      p.knR = U.lerp(0.20, 0.0, e);
      p.hipL = U.lerp(-1.52, -1.75, e);
      p.knL = U.lerp(0.12, 1.25, e);
      p.torso += 0.34 * e;
      p.shL = U.lerp(-1.18, -0.9, e);
    },
    uppercut(p, e) {
      p.shR = U.lerp(-1.55, 1.15, e);
      p.elR = U.lerp(2.0, 0.06, e);
      p.shL = U.lerp(-1.18, -0.7, e);
      p.torso -= 0.22 * e;
      p.hipR = U.lerp(-1.44, -1.20, e);
      p.knR = U.lerp(0.20, 0.5, e);
      p.lift = -6 * e;
    },
    air_jab(p, e) {
      p.hipL = U.lerp(-1.0, -1.25, e); p.knL = 0.85;
      p.hipR = U.lerp(-1.2, -1.05, e); p.knR = 0.55;
      p.shR = U.lerp(-1.4, -0.35, e);
      p.elR = U.lerp(1.9, 0.1, e);
      p.torso += 0.16 * e;
    },
    air_kick(p, e) {
      p.hipR = U.lerp(-1.3, -0.55, e);
      p.knR = U.lerp(1.0, 0.05, e);
      p.hipL = U.lerp(-1.1, -1.45, e);
      p.knL = U.lerp(0.9, 1.5, e);
      p.torso -= 0.16 * e;
      p.shL = U.lerp(-1.2, -1.9, e);
      p.shR = U.lerp(-1.3, -1.75, e);
    },
    throw(p, e) {
      p.shL = U.lerp(-1.18, -0.15, e);
      p.elL = U.lerp(1.85, 0.15, e);
      p.shR = U.lerp(-1.30, -0.10, e);
      p.elR = U.lerp(1.95, 0.20, e);
      p.torso += 0.30 * e;
      p.crouch = 0.25 * e;
    },
    cast(p, e) {
      p.shL = U.lerp(-1.18, -0.28, e);
      p.elL = U.lerp(1.85, 0.22, e);
      p.shR = U.lerp(-1.30, -0.14, e);
      p.elR = U.lerp(1.95, 0.10, e);
      p.torso += 0.20 * e;
      p.crouch = 0.18 * e;
      p.glow = e;
    },
    rush(p, e) {
      p.torso += 0.52 * e;
      p.shR = U.lerp(-1.30, -0.05, e);
      p.elR = U.lerp(1.95, 0.30, e);
      p.shL = U.lerp(-1.18, -2.35, e);
      p.hipR = U.lerp(-1.44, -0.75, e);
      p.knR = U.lerp(0.20, 0.75, e);
      p.hipL = U.lerp(-1.52, -1.85, e);
      p.glow = e * 0.6;
    },
    super(p, e) {
      p.shR = U.lerp(-1.30, -0.05, e);
      p.elR = U.lerp(1.95, 0.0, e);
      p.shL = U.lerp(-1.18, -0.15, e);
      p.elL = U.lerp(1.85, 0.0, e);
      p.torso += 0.30 * e;
      p.crouch = 0.35 * e;
      p.glow = 1;
      p.lift = -4 * e;
    },
    dash(p, e) {
      p.torso += 0.42 * e;
      p.hipR = U.lerp(-1.44, -0.95, e);
      p.hipL = U.lerp(-1.52, -2.0, e);
      p.knL = U.lerp(0.12, 0.9, e);
      p.shL = U.lerp(-1.18, -2.0, e);
      p.shR = U.lerp(-1.30, -0.9, e);
    },
    taunt(p, e) {
      p.shR = U.lerp(-1.30, -2.5, e);
      p.elR = U.lerp(1.95, 0.3, e);
      p.head -= 0.2 * e;
    }
  };

  /* 招式延伸曲线：起手蓄力 → 判定伸展 → 收招回位 */
  function extension(move, frame) {
    const s = move.startup, a = move.active, r = move.recovery;
    if (frame < s) {
      // 起手：轻微后收再前送
      const t = s ? frame / s : 1;
      return U.ease.outQuad(t) * 0.32;
    }
    if (frame < s + a) {
      const t = (frame - s) / Math.max(1, a);
      return U.lerp(0.32, 1, U.ease.outCubic(Math.min(1, t * 2.2)));
    }
    const t = (frame - s - a) / Math.max(1, r);
    return U.lerp(1, 0, U.ease.inOutQuad(t));
  }

  /* ---------------- 主解算 ---------------- */
  function solve(f, time) {
    const st = f.state;
    const p = clonePose(GUARD);
    let animName = 'idle';

    /* --- 状态层 --- */
    if (st === 'ko' || st === 'knockdown' || st === 'wakeup') {
      const t = f.stateTime;
      if (st === 'ko') { p.rot = -PI / 2; p.torso = 0.2; p.lift = 8; }
      else if (st === 'knockdown') {
        p.rot = -PI / 2 * Math.min(1, t / 8);
        p.lift = 6;
      } else {
        p.rot = -PI / 2 * Math.max(0, 1 - t / 14);
        p.crouch = 0.4;
      }
      p.hipL = -1.4; p.knL = 0.6; p.hipR = -1.6; p.knR = 0.3;
      p.shL = -2.2; p.elL = 1.0; p.shR = -2.0; p.elR = 1.2;
      animName = st;
    } else if (st === 'hitstun' || st === 'blockstun') {
      const k = Math.min(1, f.stateTime / 6);
      if (st === 'hitstun') {
        p.torso = U.lerp(0.07, -0.42, k);
        p.head = U.lerp(-0.04, -0.3, k);
        p.shL = U.lerp(-1.18, -2.1, k);
        p.shR = U.lerp(-1.30, -2.3, k);
        p.hipL = U.lerp(-1.52, -1.3, k);
        p.hipR = U.lerp(-1.44, -1.6, k);
      } else {
        // 格挡：双臂交叉护住
        p.torso = U.lerp(0.07, -0.16, k);
        p.shL = U.lerp(-1.18, -0.55, k); p.elL = U.lerp(1.85, 1.55, k);
        p.shR = U.lerp(-1.30, -0.72, k); p.elR = U.lerp(1.95, 1.45, k);
        p.crouch = f.input && f.input.dir.y > 0 ? 0.7 : 0.12;
      }
      animName = st;
    } else if (st === 'attack') {
      const m = f.move;
      const e = extension(m, f.moveFrame);
      const fn = ATTACKS[m.anim] || ATTACKS.jab;
      fn(p, e);
      animName = m.anim;
    } else if (st === 'air') {
      const t = f.stateTime;
      const rising = f.vel.y > 0;
      p.hipL = -1.15; p.knL = 1.05; p.hipR = -1.35; p.knR = 0.75;
      p.shL = rising ? -2.0 : -1.5;
      p.shR = rising ? -2.15 : -1.75;
      p.elL = 1.2; p.elR = 1.3;
      p.torso = rising ? -0.12 : 0.12;
      animName = 'air';
    } else if (st === 'dash') {
      const e = Math.min(1, f.stateTime / 4);
      ATTACKS.dash(p, e);
      animName = 'dash';
    } else if (st === 'crouch') {
      p.crouch = 1;
      p.shL = -1.05; p.elL = 2.0;
      p.shR = -1.15; p.elR = 2.05;
      p.torso = 0.20;
      animName = 'crouch';
    } else if (st === 'walk_f' || st === 'walk_b') {
      const ph = time * (st === 'walk_f' ? 7.5 : 6.2);
      const sw = Math.sin(ph) * 0.42;
      const back = st === 'walk_b' ? -1 : 1;
      p.hipL = -1.52 + sw * back;
      p.knL = 0.12 + Math.max(0, -sw) * 1.1;
      p.hipR = -1.44 - sw * back;
      p.knR = 0.20 + Math.max(0, sw) * 1.1;
      p.torso = 0.07 + (st === 'walk_f' ? 0.10 : -0.06);
      p.lift = Math.abs(Math.sin(ph)) * 2.2;
      animName = 'walk';
    } else {
      // idle：呼吸 + 轻微重心晃动
      const b = Math.sin(time * 2.4);
      const b2 = Math.sin(time * 2.4 + 1.1);
      p.torso = 0.07 + b * 0.025;
      p.head = -0.04 + b2 * 0.03;
      p.shL = -1.18 + b * 0.05;
      p.shR = -1.30 + b2 * 0.05;
      p.crouch = 0.06 + b * 0.02;
      p.lift = b * 1.4;
      animName = 'idle';
    }

    /* --- 击退 / 冲刺的额外倾斜 --- */
    if (f.vel.x * f.facing < -1.2 && st !== 'knockdown') p.torso -= 0.06;

    /* --- 组装关节 --- */
    const j = build(p, f, animName);
    return { p, j, animName };
  }

  function build(p, f, animName) {
    const crouch = U.clamp(p.crouch, 0, 1);
    const pelvisY = BODY.pelvisY - crouch * 33 + p.lift;
    const pelvis = { x: 0, y: pelvisY };

    const tAng = p.torso;
    const chest = {
      x: pelvis.x + Math.sin(tAng) * BODY.torso,
      y: pelvis.y + Math.cos(tAng) * BODY.torso
    };
    const neck = { x: chest.x + Math.sin(tAng + p.head) * BODY.neck, y: chest.y + Math.cos(tAng + p.head) * BODY.neck };
    const head = { x: neck.x + Math.sin(tAng + p.head) * (BODY.headR * 0.85), y: neck.y + Math.cos(tAng + p.head) * (BODY.headR * 0.85) };

    const limb = (ox, oy, a, len) => ({ x: ox + Math.cos(a) * len, y: oy + Math.sin(a) * len });

    const shoulderL = { x: chest.x - 4, y: chest.y - 6 };
    const shoulderR = { x: chest.x + 4, y: chest.y - 6 };
    const elbowL = limb(shoulderL.x, shoulderL.y, p.shL, BODY.upperArm);
    const handL = limb(elbowL.x, elbowL.y, p.shL + p.elL, BODY.foreArm);
    const elbowR = limb(shoulderR.x, shoulderR.y, p.shR, BODY.upperArm);
    const handR = limb(elbowR.x, elbowR.y, p.shR + p.elR, BODY.foreArm);

    const hipL = { x: pelvis.x - 6, y: pelvis.y - 4 };
    const hipR = { x: pelvis.x + 6, y: pelvis.y - 4 };
    const kneeL = limb(hipL.x, hipL.y, p.hipL, BODY.thigh);
    const footL = limb(kneeL.x, kneeL.y, p.hipL + p.knL, BODY.shin);
    const kneeR = limb(hipR.x, hipR.y, p.hipR, BODY.thigh);
    const footR = limb(kneeR.x, kneeR.y, p.hipR + p.knR, BODY.shin);

    const joints = { pelvis, chest, neck, head, shoulderL, shoulderR, elbowL, handL, elbowR, handR, hipL, hipR, kneeL, footL, kneeR, footR };

    /* 整体旋转（倒地） */
    if (p.rot) {
      const px = 0, py = 6;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      for (const k in joints) {
        const q = joints[k];
        const dx = q.x - px, dy = q.y - py;
        q.x = px + dx * c - dy * s;
        q.y = py + dx * s + dy * c;
      }
    }

    /* 落地贴地：把最低点压到 y=0（空中/倒地除外） */
    if (!f.airborne && p.rot === 0) {
      const lowest = Math.min(joints.footL.y, joints.footR.y) - BODY.foot * 0.2;
      const shift = -lowest;
      if (Math.abs(shift) < 30) for (const k in joints) joints[k].y += shift;
    }

    /* 朝向镜像 */
    if (f.facing < 0) for (const k in joints) joints[k].x *= -1;

    return joints;
  }

  FE.anim = { solve, BODY, GUARD, ATTACKS, extension };
})();
