/* ==========================================================
   Adapt — 角色适配检测
   ----------------------------------------------------------
   一个角色不必为每个渲染后端都做美术适配。角色定义里写：

     adapters: ['3d', '25d', 'toon']     // 只做了这三个

   引擎在切换后端时会检测当前角色是否被支持：
     · 支持 → 用角色自己的 look（发型/体型/配件/光效）
     · 不支持 → 自动生成一个中性替身（auto look），并在 HUD 上标注

   这样"没做适配的角色"不会消失，也不会报错，而是自动降级成
   一个能动的、配色正确的通用形象 —— 这就是"自动识别成角色"。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});

  /* 角色专属外观（只有"做过适配"的角色才用得到） */
  const LOOKS = {
    flame: { hair: 'spiky', build: 1.00, height: 1.00, scarf: true,  weapon: 'none',  glow: 0.55 },
    frost: { hair: 'long',  build: 0.96, height: 1.02, scarf: true,  weapon: 'none',  glow: 0.40 },
    rock:  { hair: 'bald',  build: 1.24, height: 0.93, scarf: false, weapon: 'fist',  glow: 0.30 },
    shadow:{ hair: 'hood',  build: 0.92, height: 1.04, scarf: true,  weapon: 'blade', glow: 0.70 }
  };

  /* 自动替身：中性体型，无配件 */
  function autoLook(def) {
    const pal = def.palette || {};
    return {
      hair: 'short',
      build: 1.0,
      height: 1.0,
      scarf: false,
      weapon: 'none',
      glow: 0.35,
      auto: true,
      accent: pal.accent || '#ffffff'
    };
  }

  const adapt = {
    /** 角色是否声明支持某个后端 */
    supports(def, backendId) {
      if (!def) return false;
      if (!def.adapters) return true;                 // 未声明 = 视为全适配
      return def.adapters.indexOf(backendId) >= 0;
    },

    /**
     * 解析当前角色在某后端下的呈现方式
     * @returns {{adapted:boolean, look:object, reason:string}}
     */
    resolve(def, backendId) {
      const ok = adapt.supports(def, backendId);
      if (ok) {
        return {
          adapted: true,
          look: LOOKS[def.id] || autoLook(def),
          reason: '原生适配'
        };
      }
      return {
        adapted: false,
        look: autoLook(def),
        reason: `该角色未适配 ${backendId}，已自动生成替身`
      };
    },

    /** 给 UI 用的摘要 */
    summary(def) {
      const list = def.adapters || null;
      return {
        total: FE.renderers.list().length,
        adapted: list ? list.length : FE.renderers.list().length,
        list: list || FE.renderers.list().map(r => r.id),
        universal: !list
      };
    },

    LOOKS,
    autoLook
  };

  FE.adapt = adapt;
})();
