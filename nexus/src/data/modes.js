/* ==========================================================
   Modes — 战斗模式插件
   ----------------------------------------------------------
   模式决定：几打几、回合怎么算、谁算赢、HUD 长什么样。
   引擎主体只认 match/side/fighter 三层结构，模式通过
   一组回调介入，所以新增模式同样是"注册一个对象"。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const B = () => FE.balance;

  /* ---------------- 1v1 决斗 ---------------- */
  FE.modes.register('duel', {
    name: '1v1 决斗',
    short: 'DUEL',
    desc: '三局两胜，标准格斗规则',
    teamSize: 1,
    roundsToWin: 2,
    simultaneous: false,
    hudStyle: 'duel',
    timeLimit: () => B().roundTime,

    buildRoster(match) {
      return [[match.pick[0]], [match.pick[1]]];
    },

    checkRoundEnd(match) {
      const a = match.sides[0].alive(), b = match.sides[1].alive();
      if (a && b) return null;
      if (!a && !b) return 'draw';
      return a ? 0 : 1;
    },

    onRoundStart(match) {
      match.sides.forEach(s => s.resetRoster());
    }
  });

  /* ---------------- 2v2 换人战 ---------------- */
  FE.modes.register('tag', {
    name: '2v2 换人',
    short: 'TAG',
    desc: '双人组队，可换人、可呼叫协战（I 换人 / O 协战）',
    teamSize: 2,
    roundsToWin: 2,
    simultaneous: false,
    hudStyle: 'tag',
    timeLimit: () => B().roundTime,
    assistCooldown: 240,

    buildRoster(match) {
      // 第二人自动从角色池里补一个不同的
      const pool = FE.characters.listEnabled().map(c => c.id);
      const pick2 = (c1) => pool.find(id => id !== c1) || c1;
      return [
        [match.pick[0], pick2(match.pick[0])],
        [match.pick[1], pick2(match.pick[1])]
      ];
    },

    onRoundStart(match) {
      match.sides.forEach(s => {
        s.resetRoster();
        s.assistTimer = 0;
      });
    },

    onTick(match, dt) {
      match.sides.forEach(s => { if (s.assistTimer > 0) s.assistTimer -= dt; });
    },

    checkRoundEnd(match) {
      const a = match.sides[0].alive(), b = match.sides[1].alive();
      if (a && b) return null;
      if (!a && !b) return 'draw';
      return a ? 0 : 1;
    }
  });

  /* ---------------- 生存模式 ---------------- */
  FE.modes.register('survival', {
    name: '生存模式',
    short: 'SURV',
    desc: '无限连战，血量继承，每波小幅回复',
    teamSize: 1,
    roundsToWin: 99,
    simultaneous: false,
    hudStyle: 'survival',
    endless: true,
    timeLimit: () => 99,

    buildRoster(match) {
      const pool = FE.characters.listEnabled().map(c => c.id);
      const first = pool[Math.floor(Math.random() * pool.length)];
      return [[match.pick[0]], [first]];
    },

    /** 对手倒下立刻换下一个，玩家不回血（只回一点） */
    onFighterKO(match, f) {
      if (f.side !== 1) return;
      const pool = FE.characters.listEnabled().map(c => c.id);
      match.wave = (match.wave || 1) + 1;
      const next = pool[Math.floor(Math.random() * pool.length)];
      const side = match.sides[1];
      const p1 = match.sides[0].active();
      if (p1) p1.heal(B().maxHealth * 0.18);
      setTimeout(() => {
        side.replaceActive(next, true);
        match.flash('WAVE ' + match.wave, 0.8);
      }, 700);
    },

    checkRoundEnd(match) {
      const a = match.sides[0].alive();
      if (!a) return 1;
      return null;
    }
  });
})();
