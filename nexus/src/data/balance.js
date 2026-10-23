/* ==========================================================
   Balance — 全局内核参数（可被模组与 UI 实时改写）
   ----------------------------------------------------------
   刻意做成"扁平可枚举"的结构：模组一条 patch 就能调平衡，
   UI 也能自动生成滑块。defs 里带范围元数据。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  FE.balance = {
    /* 物理 */
    gravity: 0.78,
    jumpPower: 14.2,
    walkSpeed: 2.75,
    backSpeed: 2.15,
    dashSpeed: 8.2,
    dashFrames: 13,
    airControl: 0.62,
    friction: 0.86,
    airFriction: 0.975,
    /* 战斗 */
    damageScale: 1.0,
    hitstunScale: 1.0,
    blockstunScale: 1.0,
    hitstopScale: 1.0,
    chipScale: 0.14,
    comboScaling: 0.87,
    minScaling: 0.22,
    juggleLimit: 6,
    pushSpeed: 1.35,
    /* 能量 */
    maxMeter: 100,
    meterRegen: 0.05,
    meterOnHit: 5.5,
    meterOnBlock: 2.2,
    meterOnTake: 3.4,
    /* 回合 */
    roundTime: 60,
    roundsToWin: 2,
    maxHealth: 1000,
    /* 场地 */
    stageHalf: 640,
    groundY: 0,
    /* 手感 */
    hitstopMax: 14,
    screenShakeScale: 1.0
  };

  /* 滑块元数据：UI 自动生成 */
  FE.balanceDefs = [
    { k: 'gravity',      l: '重力',        min: 0.3, max: 1.6,  step: 0.01 },
    { k: 'jumpPower',    l: '跳跃力',      min: 8,   max: 22,   step: 0.1 },
    { k: 'walkSpeed',    l: '前进速度',    min: 1,   max: 6,    step: 0.05 },
    { k: 'dashSpeed',    l: '冲刺速度',    min: 3,   max: 14,   step: 0.1 },
    { k: 'damageScale',  l: '伤害倍率',    min: 0.2, max: 3,    step: 0.05 },
    { k: 'comboScaling', l: '连段递减',    min: 0.6, max: 1,    step: 0.01 },
    { k: 'hitstopScale', l: '顿帧强度',    min: 0,   max: 2.5,  step: 0.05 },
    { k: 'meterRegen',   l: '能量回复',    min: 0,   max: 0.6,  step: 0.01 },
    { k: 'roundTime',    l: '回合时长(s)', min: 20,  max: 120,  step: 5 },
    { k: 'maxHealth',    l: '生命上限',    min: 300, max: 3000, step: 50 }
  ];
})();
