/* ==========================================================
   AI — 作为"输入设备"存在的对手
   ----------------------------------------------------------
   关键设计：AI 不直接操作角色，它只产生输入。
   所以 AI 和人类走完全相同的规则（同样要搓招、同样会打空），
   这也意味着模组可以用同样的方式接管任何一方。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const LEVELS = {
    easy:   { react: 18, aggr: 0.35, blockChance: 0.25, combo: 0.15, special: 0.10, jump: 0.03 },
    normal: { react: 9,  aggr: 0.62, blockChance: 0.60, combo: 0.55, special: 0.28, jump: 0.05 },
    hard:   { react: 4,  aggr: 0.85, blockChance: 0.88, combo: 0.90, special: 0.45, jump: 0.06 }
  };

  function motion(st, keys) {
    for (const k of keys) {
      st.buffer.push({ k, frame: FE.input.frame });
    }
    if (st.buffer.length > 24) st.buffer.splice(0, st.buffer.length - 24);
  }

  function poll(st, f, match, level) {
    const L = LEVELS[level] || LEVELS.normal;
    st.clearPressed();
    if (!f.active) { st.setDir(0, 0); return st; }

    const ai = st._ai || (st._ai = { cd: 0, hold: 0, holdDir: 0, decideT: 0, jumpCd: 0 });
    const op = match.opponentOf(f);
    if (!op) { st.setDir(0, 0); return st; }

    ai.cd -= 1;
    ai.jumpCd -= 1;
    if (ai.hold > 0) ai.hold -= 1;

    const dx = op.x - f.x;
    const dist = Math.abs(dx);
    const toward = dx > 0 ? 1 : -1;
    const facing = f.facing;
    const back = -facing;

    /* 朝向不一致时先转身（引擎会自动转，但空中要手动） */
    let x = 0, y = 0;

    /* --- 1. 危险感知：对手在出招且距离近 → 防守 --- */
    const opAttacking = op.state === 'attack' && op.move &&
      op.moveFrame <= op.move.activeTo + 2;
    const threatened = opAttacking && dist < 150;

    if (threatened && Math.random() < L.blockChance) {
      // 蹲防低段，站防中段
      const low = op.move && op.move.height === 'low';
      x = back;
      y = low ? 1 : 0;
      st.setDir(x, y);
      st._prevDir.y = y;
      // 少量反击
      if (ai.cd <= 0 && dist < 100 && Math.random() < L.combo * 0.4) {
        ai.cd = 22;
        motion(st, ['d', 'df', 'f']);
        st.press('heavy');    // 升龙反击
      }
      return st;
    }

    /* --- 2. 对空 --- */
    if (op.airborne && op.y > 70 && dist < 140 && ai.cd <= 0) {
      ai.cd = 26;
      motion(st, ['f', 'd', 'f']);
      st.press('heavy');
      st.setDir(toward, 0);
      return st;
    }

    /* --- 3. 距离很近：进攻 --- */
    if (dist < 105) {
      if (ai.cd <= 0) {
        const r = Math.random();
        // 有能量且贴脸 → 超必杀
        if (f.meter >= 50 && r < 0.35) {
          ai.cd = 40;
          motion(st, ['d', 'df', 'f']);
          st.press('super');
        } else if (r < L.special) {
          ai.cd = 30;
          motion(st, ['d', 'db', 'b']);   // 突进
          st.press('special');
        } else if (r < L.special + 0.28) {
          ai.cd = 16;
          motion(st, ['d', 'df', 'f']);
          st.press('heavy');
        } else if (r < L.special + 0.30) {
          ai.cd = 20;
          motion(st, ['d', 'n', 'd']);    // 投技
          st.press('heavy');
        } else {
          ai.cd = U.rndi(6, 12);
          st.press(Math.random() < 0.6 ? 'light' : 'heavy');
        }
      }
      st.setDir(toward, 0);
      return st;
    }

    /* --- 4. 中距离：逼近或牵制 --- */
    if (dist < 260) {
      if (ai.cd <= 0 && Math.random() < L.aggr) {
        ai.cd = 20;
        st.press(Math.random() < 0.5 ? 'light' : 'heavy');
      }
      if (ai.cd <= 0 && Math.random() < L.special * 0.5) {
        ai.cd = 34;
        motion(st, ['d', 'db', 'b']);
        st.press('special');
      }
      x = toward;
      // 偶尔跳跃接近
      if (ai.jumpCd <= 0 && Math.random() < L.jump) {
        ai.jumpCd = 90;
        y = -1;
      }
      st.setDir(x, y);
      if (y < 0 && st._prevDir.y >= 0) st.press('jump');
      st._prevDir.y = y;
      return st;
    }

    /* --- 5. 远距离：发波 or 冲刺 --- */
    if (ai.cd <= 0) {
      const r = Math.random();
      if (r < 0.35) {
        ai.cd = 40;
        motion(st, ['d', 'df', 'f']);
        st.press('special');       // 气弹
        st.setDir(0, 0);
        return st;
      }
      ai.cd = U.rndi(8, 18);
    }
    x = toward;
    // 双击冲刺
    if (ai.cd % 2 === 0 && dist > 400) {
      st.buffer.push({ k: 'f', frame: FE.input.frame - 8 });
      st.buffer.push({ k: 'n', frame: FE.input.frame - 4 });
      st.buffer.push({ k: 'f', frame: FE.input.frame });
    }
    st.setDir(x, 0);
    return st;
  }

  FE.ai = { poll, LEVELS };
})();
