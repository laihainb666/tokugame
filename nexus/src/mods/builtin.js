/* ==========================================================
   Builtin Mods — 内置示例模组
   ----------------------------------------------------------
   每个模组只演示一种扩展方式，全部可在面板里热插拔：
     1. combo-fx      钩子：命中表现增强
     2. shadow-fighter 预制体：新增一个完整角色
     3. super-armor    钩子：给重击加霸体
     4. air-dash       钩子：二段跳 / 空中冲刺
     5. balance-lab    参数：改写全局平衡
     6. chaos-mode     模式：四人同场
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const D = FE.moves.derive;

  /* ---------------------------------------------------------
     1) 连段表现增强
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'combo-fx',
    name: '连段强化特效',
    version: '1.2',
    author: '内置',
    builtin: true,
    auto: true,
    desc: '连段越长，顿帧越重、火花越多、镜头越晃。纯钩子实现，不改内核。',
    setup(api) {
      api.state.match = null;
      api.on('match:start', e => { api.state.match = e.match; });

      api.on('combat:hit', e => {
        const combo = e.attacker.comboCount;
        if (combo >= 2) {
          e.hitstop = Math.min(FE.balance.hitstopMax, e.hitstop + Math.min(4, combo));
          const m = api.state.match;
          if (m) {
            m.shake(Math.min(10, combo * 1.4));
            for (let i = 0; i < Math.min(4, combo); i++) {
              m.spawnFx('hit', e.victim.x + (Math.random() - 0.5) * 60,
                e.victim.y + 60 + Math.random() * 90, {
                power: 0.5 + Math.random() * 0.4,
                element: e.move.element || 'neutral'
              });
            }
          }
        }
      });

      // 连段到 10 以上给个全屏提示
      api.on('combat:hit', e => {
        const c = e.attacker.comboCount;
        if (c === 10 || c === 15 || c === 20) {
          const m = api.state.match;
          if (m) m.flash(c + ' HIT COMBO!', 0.9);
        }
      });
    },
    teardown(api) { api.state.match = null; }
  });

  /* ---------------------------------------------------------
     2) 新角色：影 SHADOW（演示"加角色只写数据"）
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'shadow-fighter',
    name: '角色包：影',
    version: '1.0',
    author: '内置',
    builtin: true,
    auto: true,
    desc: '通过 api.addCharacter 注入的第四个角色，零引擎代码改动。',
    setup(api) {
      api.addCharacter('shadow', {
        name: '影', title: 'SHADOW', archetype: '速攻 / 位移',
        avatar: '影',
        desc: '血量最低但机动性最强，靠瞬步与多段连击压制。',
        /* 故意只做两个后端，用来演示"未适配 → 自动替身" */
        adapters: ['25d', 'pixel'],
        palette: {
          main: '#8b5cf6', dark: '#3b2470', light: '#c4b5fd',
          accent: '#e879f9', skin: '#d9c7b8', hair: '#0f0a1e',
          gi: '#2a1a4a', belt: '#0a0714', aura: '#c084fc'
        },
        stats: {
          health: 0.86, walk: 1.26, dash: 1.34, jump: 1.14,
          weight: 0.78, gravity: 0.96, meterGain: 1.2
        },
        moves: [
          D('light', { id: 'light', name: '影刺', startup: 3, recovery: 6, damage: 30, meterGain: 5 }),
          D('heavy', { id: 'heavy', name: '断影斩', startup: 8, recovery: 14, damage: 74 }),
          D('kick', { id: 'kick', name: '回旋踢', startup: 9, damage: 68 }),
          D('crouch_light', { id: 'crouch_light', name: '低刺', startup: 3, damage: 26 }),
          D('sweep', { id: 'sweep', name: '影扫', damage: 62 }),
          D('uppercut', { id: 'uppercut', name: '影昇', damage: 88 }),
          D('air_light', { id: 'air_light', name: '空刺', damage: 30 }),
          D('air_heavy', { id: 'air_heavy', name: '空斩', damage: 64 }),
          D('throw', { id: 'throw', name: '影缚', damage: 96 }),
          D('fireball', {
            id: 'shadow_orb', name: '影弹', startup: 11, recovery: 20,
            anim: 'cast', fx: 'shadow', meterGain: 10,
            projectile: {
              speed: 8.4, damage: 48, hitstun: 18, blockstun: 11, hitstop: 6,
              w: 30, h: 28, life: 120, kb: { x: 2.6, y: 1 }, fx: 'shadow', element: 'shadow'
            }
          }),
          D('rush', {
            id: 'teleport', name: '瞬步', damage: 66, startup: 6, recovery: 12,
            self: { x: 14, y: 0 }, anim: 'rush', fx: 'shadow', element: 'shadow',
            desc: '超长位移，可穿过对手'
          }),
          D('super', {
            id: 'super', name: '影分身乱舞', damage: 208, hits: 8, hitInterval: 3,
            startup: 6, anim: 'super', fx: 'super', element: 'shadow'
          })
        ],
        tag: { assist: 'teleport', switchIn: 'teleport', call: '瞬步' },
        quote: '你连影子都抓不住。'
      });
    }
  });

  /* ---------------------------------------------------------
     3) 重击霸体
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'super-armor',
    name: '重击霸体',
    version: '1.0',
    author: '内置',
    builtin: true,
    desc: '所有带 heavy 标签的招式获得 1 次霸体，可硬吃一下反击。',
    setup(api) {
      api.on('move:beforeExecute', e => {
        if (e.move.tags && e.move.tags.includes('heavy')) {
          e.armor = 1;
        }
      });
      api.log('重击已获得霸体');
    }
  });

  /* ---------------------------------------------------------
     4) 二段跳 + 空中冲刺
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'air-dash',
    name: '二段跳 / 空中冲刺',
    version: '1.1',
    author: '内置',
    builtin: true,
    desc: '空中可再跳一次；按住前/后双击可空中冲刺。全靠钩子实现。',
    setup(api) {
      api.on('fighter:spawned', e => { e.fighter.airJumps = 1; });
      api.on('fighter:land', e => { e.fighter.airJumps = 1; });

      api.on('fighter:airJump', e => {
        const f = e.fighter;
        if (!f.airJumps || f.airJumps <= 0) return;
        if (f.state === 'attack' || f.state === 'hitstun') return;
        f.airJumps--;
        f.vel.y = FE.balance.jumpPower * 0.86;
        f.juggleCount = Math.max(0, f.juggleCount - 1);
        api.log('二段跳', f.def.name);
      });

      api.on('engine:frame', e => {
        const m = e.match;
        if (!m) return;
        for (const f of m.fighters) {
          if (!f.active || !f.airborne || !f.input) continue;
          if (f.airDashes > 0 && f.input.dashDir) {
            f.airDashes--;
            f.vel.x = f.input.dashDir * f.facing * FE.balance.dashSpeed * 0.9;
            f.vel.y = Math.max(f.vel.y, 1.2);
            m.spawnFx('switch', f.x, f.y + 80, { owner: f });
            api.log('空中冲刺', f.def.name);
          }
        }
      });
    }
  });

  /* ---------------------------------------------------------
     5) 平衡实验台
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'balance-lab',
    name: '低重力实验室',
    version: '0.9',
    author: '内置',
    builtin: true,
    desc: '重力 0.45、跳跃力 +40%、伤害 x1.4 —— 演示参数级改写。',
    setup(api) {
      api.state.saved = {
        gravity: FE.balance.gravity,
        jumpPower: FE.balance.jumpPower,
        damageScale: FE.balance.damageScale
      };
      api.patchBalance({ gravity: 0.45, jumpPower: 19.5, damageScale: 1.4 });
    },
    teardown(api) {
      if (api.state.saved) api.patchBalance(api.state.saved);
    }
  });

  /* ---------------------------------------------------------
     6) 新战斗模式：乱斗 2v2
     --------------------------------------------------------- */
  FE.registerMod({
    id: 'chaos-mode',
    name: '模式包：乱斗 2v2',
    version: '1.0',
    author: '内置',
    builtin: true,
    desc: '双方各两人同时在场，单回合定胜负。演示模式插件。',
    setup(api) {
      api.addMode('chaos', {
        name: '乱斗 2v2',
        short: 'CHAOS',
        desc: '四人同时在场，单回合',
        teamSize: 2,
        simultaneous: true,
        roundsToWin: 1,
        hudStyle: 'duel',
        timeLimit: () => 60,

        buildRoster(match) {
          const pool = FE.characters.listEnabled().map(c => c.id);
          const pickTwo = (first) => {
            const other = pool.find(id => id !== first) || first;
            return [first, other];
          };
          return [pickTwo(match.pick[0]), pickTwo(match.pick[1])];
        },

        onRoundStart(match) {
          match.sides.forEach(s => s.resetRoster());
          // 同队两人错开站位
          match.sides.forEach(s => {
            s.fighters.forEach((f, i) => {
              f.x = s.index === 0 ? -170 - i * 110 : 170 + i * 110;
              f.facing = s.index === 0 ? 1 : -1;
            });
          });
        },

        checkRoundEnd(match) {
          const a = match.sides[0].alive(), b = match.sides[1].alive();
          if (a && b) return null;
          if (!a && !b) return 'draw';
          return a ? 0 : 1;
        }
      });
    }
  });
})();
