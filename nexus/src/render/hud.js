/* ==========================================================
   HUD — 共用界面层（3D / 2.5D 后端使用）
   ----------------------------------------------------------
   血条 / 能量 / 计时 / 回合 / 连段 / 调试盒。数据后端不使用它，
   因为它自己就是一份"数据 HUD"。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const ghost = Object.create(null);   // 掉血残影动画

  function skewRect(ctx, x, y, w, h, sk) {
    ctx.beginPath();
    ctx.moveTo(x + sk, y);
    ctx.lineTo(x + w + sk, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  function drawHealthBar(ctx, f, side, W) {
    const isLeft = side === 0;
    const barW = 470, barH = 24;
    const x = isLeft ? 40 : W - 40 - barW;
    const y = 34;
    const sk = isLeft ? -12 : 12;
    const pal = f ? f.def.palette : { main: '#888' };
    const ratio = f ? U.clamp(f.health / f.maxHealth, 0, 1) : 0;

    // 残影
    const key = f ? f.uid : 'x' + side;
    let gh = ghost[key];
    if (gh === undefined) gh = ratio;
    if (ratio < gh) gh = U.lerp(gh, ratio, 0.08);
    else gh = ratio;
    ghost[key] = gh;

    // 底槽
    ctx.save();
    skewRect(ctx, x, y, barW, barH, sk);
    ctx.fillStyle = 'rgba(8,10,16,.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 残影层
    ctx.save();
    skewRect(ctx, x, y, barW, barH, sk);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    const gw = barW * gh;
    if (isLeft) ctx.fillRect(x, y, gw, barH);
    else ctx.fillRect(x + barW - gw, y, gw, barH);

    // 血量
    const g = ctx.createLinearGradient(x, y, x + barW, y);
    if (isLeft) {
      g.addColorStop(0, pal.main); g.addColorStop(1, pal.accent || pal.main);
    } else {
      g.addColorStop(0, pal.accent || pal.main); g.addColorStop(1, pal.main);
    }
    ctx.fillStyle = g;
    const hw = barW * ratio;
    if (isLeft) ctx.fillRect(x, y, hw, barH);
    else ctx.fillRect(x + barW - hw, y, hw, barH);

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    if (isLeft) ctx.fillRect(x, y, hw, barH * 0.35);
    else ctx.fillRect(x + barW - hw, y, hw, barH * 0.35);

    // 刻度
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const px = x + barW * i / 8;
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + barH); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // 名字
    if (f) {
      ctx.font = '700 15px "Segoe UI","PingFang SC",sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = isLeft ? 'left' : 'right';
      ctx.shadowColor = 'rgba(0,0,0,.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(f.def.name + '  ' + f.def.title, isLeft ? x + 6 : x + barW - 6, y + barH + 20);
      ctx.shadowBlur = 0;
      ctx.font = '600 10px "JetBrains Mono",monospace';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText(Math.round(f.health) + '', isLeft ? x + 6 : x + barW - 6, y + barH + 36);
      ctx.textAlign = 'left';
    }
  }

  function drawRounds(ctx, match, side, W) {
    const wins = match.sides[side].wins;
    const need = match.mode.roundsToWin || 2;
    const n = Math.min(need, 5);
    const isLeft = side === 0;
    for (let i = 0; i < n; i++) {
      const x = isLeft ? 40 + i * 20 : W - 40 - i * 20;
      const y = 76;
      const on = i < wins;
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fillStyle = on ? '#ffd23d' : 'rgba(255,255,255,.16)';
      ctx.fill();
      if (on) {
        ctx.shadowColor = '#ffd23d'; ctx.shadowBlur = 10; ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawMeter(ctx, f, side, W) {
    if (!f) return;
    const barW = 300, barH = 13;
    const x = side === 0 ? 40 : W - 40 - barW;
    const y = 668;
    const ratio = U.clamp(f.meter / FE.balance.maxMeter, 0, 1);
    const full = ratio >= 0.999;

    ctx.fillStyle = 'rgba(8,10,16,.8)';
    skewRect(ctx, x, y, barW, barH, side === 0 ? -8 : 8);
    ctx.fill();
    ctx.strokeStyle = full ? 'rgba(255,210,90,.9)' : 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.save();
    skewRect(ctx, x, y, barW, barH, side === 0 ? -8 : 8);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + barW, y);
    if (full) {
      g.addColorStop(0, '#ffd23d'); g.addColorStop(0.5, '#fff3b0'); g.addColorStop(1, '#ffd23d');
    } else {
      g.addColorStop(0, '#ff8a3d'); g.addColorStop(1, '#ff4d5e');
    }
    ctx.fillStyle = g;
    const w = barW * ratio;
    if (side === 0) ctx.fillRect(x, y, w, barH);
    else ctx.fillRect(x + barW - w, y, w, barH);

    // 50 能量刻度线
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2;
    const mx = x + barW * 0.5;
    ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, y + barH); ctx.stroke();
    ctx.restore();

    ctx.font = '700 10px "JetBrains Mono",monospace';
    ctx.fillStyle = full ? '#ffd23d' : 'rgba(255,255,255,.4)';
    ctx.textAlign = side === 0 ? 'left' : 'right';
    ctx.fillText(full ? 'SUPER READY' : 'METER ' + Math.floor(f.meter),
      side === 0 ? x + 2 : x + barW - 2, y - 6);
    ctx.textAlign = 'left';
  }

  function drawTimer(ctx, match, W) {
    const t = Math.max(0, Math.ceil(match.timer / 60));
    const cx = W / 2, cy = 62;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy - 30);
    ctx.lineTo(cx + 44, cy - 30);
    ctx.lineTo(cx + 34, cy + 30);
    ctx.lineTo(cx - 34, cy + 30);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,10,16,.85)';
    ctx.fill();
    ctx.strokeStyle = t <= 10 ? 'rgba(255,77,94,.9)' : 'rgba(255,255,255,.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '800 34px "JetBrains Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = t <= 10 ? '#ff4d5e' : '#fff';
    ctx.shadowColor = t <= 10 ? '#ff4d5e' : 'rgba(0,0,0,.9)';
    ctx.shadowBlur = t <= 10 ? 16 : 8;
    ctx.fillText(String(t).padStart(2, '0'), cx, cy + 12);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
  }

  function drawCombo(ctx, f, side, W) {
    if (!f || f.comboCount < 2) return;
    const x = side === 0 ? 110 : W - 110;
    const y = 210;
    ctx.save();
    ctx.textAlign = side === 0 ? 'left' : 'right';
    const pop = Math.min(1, (f.comboCount) / 8);
    const scale = 1 + 0.25 * Math.sin(Math.min(1, (f.comboResetTimer || 0) / 12) * Math.PI);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.font = '900 46px "Segoe UI",sans-serif';
    ctx.fillStyle = '#ffd23d';
    ctx.shadowColor = 'rgba(255,140,40,.9)';
    ctx.shadowBlur = 18;
    ctx.fillText(String(f.comboCount), 0, 0);
    ctx.font = '800 15px "JetBrains Mono",monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('HITS', side === 0 ? 40 : -40, -4);
    ctx.font = '700 12px "JetBrains Mono",monospace';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(Math.round(f.comboDamage) + ' DMG', 0, 20);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
  }

  function drawBigText(ctx, match, W, H) {
    const bt = match.bigText;
    if (!bt) return;
    const t = bt.t / bt.life;
    const inA = Math.min(1, bt.t / 8);
    const scale = U.lerp(1.6, 1, U.ease.outCubic(inA));
    const alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = U.clamp(alpha, 0, 1);
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = '900 76px "Segoe UI","PingFang SC",sans-serif';
    const g = ctx.createLinearGradient(0, -50, 0, 30);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.55, '#ffd23d');
    g.addColorStop(1, '#ff6a3d');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(255,90,40,.85)';
    ctx.shadowBlur = 26;
    ctx.fillText(bt.text, 0, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText(bt.text, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
  }

  function drawTagBar(ctx, match, W) {
    if (match.mode.teamSize <= 1) return;
    for (const side of [0, 1]) {
      const s = match.sides[side];
      const partner = s.reserve();
      if (!partner) continue;
      const isLeft = side === 0;
      const x = isLeft ? 40 : W - 40 - 130;
      const y = 112;
      ctx.fillStyle = 'rgba(8,10,16,.7)';
      ctx.fillRect(x, y, 130, 34);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.strokeRect(x + 0.5, y + 0.5, 129, 33);
      ctx.fillStyle = partner.def.palette.main;
      ctx.fillRect(x, y, 3, 34);
      ctx.font = '700 11px "Segoe UI",sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(partner.def.name, x + 10, y + 15);
      ctx.font = '600 9px "JetBrains Mono",monospace';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('TAG / ASSIST', x + 10, y + 27);
      // 血量条
      const r = U.clamp(partner.health / partner.maxHealth, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(x + 78, y + 10, 44, 6);
      ctx.fillStyle = partner.def.palette.main;
      ctx.fillRect(x + 78, y + 10, 44 * r, 6);
      // 协战冷却
      const cd = s.assistTimer > 0 ? 1 - s.assistTimer / (match.mode.assistCooldown || 240) : 1;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(x + 78, y + 20, 44, 4);
      ctx.fillStyle = cd >= 1 ? '#3ddc97' : '#ffb02e';
      ctx.fillRect(x + 78, y + 20, 44 * cd, 4);
    }
    ctx.textAlign = 'left';
  }

  function drawWave(ctx, match, W) {
    if (!match.mode.endless) return;
    ctx.font = '800 13px "JetBrains Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText('WAVE ' + (match.wave || 1), W / 2, 108);
    ctx.textAlign = 'left';
  }

  /* ---------------- 调试层 ---------------- */
  function drawDebug(ctx, match, renderer, cfg) {
    if (!renderer.projectPoint) return;
    const pp = (x, y) => renderer.projectPoint(x, y, 0);

    const box = (b, color, label) => {
      const p1 = pp(b.x - b.w / 2, b.y), p2 = pp(b.x + b.w / 2, b.y);
      const p3 = pp(b.x + b.w / 2, b.y + b.h), p4 = pp(b.x - b.w / 2, b.y + b.h);
      if (!p1 || !p2 || !p3 || !p4) return;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = color.replace('1)', '0.13)');
      ctx.fill();
      if (label) {
        ctx.font = '600 9px "JetBrains Mono",monospace';
        ctx.fillStyle = color;
        ctx.fillText(label, p1.x, p1.y - 4);
      }
    };

    for (const f of match.fighters) {
      if (!f.active) continue;
      if (cfg.hurtbox) box(f.hurtbox(), 'rgba(77,141,255,1)', 'HU');
      if (cfg.hitbox) {
        const hb = f.hitbox();
        if (hb) box(hb, 'rgba(255,77,94,1)', hb.move.id);
      }
      if (cfg.framedata) {
        const p = pp(f.x, f.y + 210);
        if (p) {
          ctx.font = '600 10px "JetBrains Mono",monospace';
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          const txt = f.state === 'attack'
            ? `${f.move.id} f${Math.floor(f.moveFrame)}/${f.move.total} [${f.moveFrame < f.move.startup ? 'S' : f.moveFrame <= f.move.activeTo ? 'A' : 'R'}]`
            : `${f.state} +${Math.floor(f.stateTime)}`;
          ctx.textAlign = 'center';
          ctx.fillText(txt, p.x, p.y);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  function draw(ctx, match, renderer) {
    const W = 1280, H = 720;
    const cfg = FE.config.debug;
    const p1 = match.sides[0].active();
    const p2 = match.sides[1].active();

    drawHealthBar(ctx, p1, 0, W);
    drawHealthBar(ctx, p2, 1, W);
    drawRounds(ctx, match, 0, W);
    drawRounds(ctx, match, 1, W);
    drawTimer(ctx, match, W);
    drawMeter(ctx, p1, 0, W);
    drawMeter(ctx, p2, 1, W);
    drawTagBar(ctx, match, W);
    drawWave(ctx, match, W);
    drawCombo(ctx, p1, 0, W);
    drawCombo(ctx, p2, 1, W);
    drawDebug(ctx, match, renderer, cfg);
    drawBigText(ctx, match, W, H);
  }

  FE.hud = { draw, ghost };
})();
