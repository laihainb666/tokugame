/* ==========================================================
   Hyper — 渲染管线引擎
   ----------------------------------------------------------
   这不是"又一个画风"，而是**能改写渲染方式**的一层：

       任意基础后端  →  [可编排通道链]  →  自定义脚本  →  屏幕

   通道可以任意增删、排序、开关、调参：
     grade 调色 · bloom 辉光 · chroma 色散 · pixelate 像素化
     scanline 扫描线 · grain 颗粒 · vignette 暗角

   最后还能塞一段自己的 JS，直接操作画布 —— 也就是说，
   你不需要改引擎源码，就能定义一种全新的渲染方式。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;
  const W = 1280, H = 720;

  /* ---------------- 通道定义 ---------------- */
  const PASS_DEFS = {
    grade: {
      name: '调色', desc: '饱和度 / 对比 / 亮度 / 色相',
      params: [
        { k: 'sat', l: '饱和', min: 0, max: 2.5, step: 0.05, v: 1.15 },
        { k: 'con', l: '对比', min: 0.5, max: 2, step: 0.05, v: 1.05 },
        { k: 'bri', l: '亮度', min: 0.4, max: 1.8, step: 0.05, v: 1.0 },
        { k: 'hue', l: '色相', min: -180, max: 180, step: 5, v: 0 }
      ]
    },
    bloom: {
      name: '辉光', desc: '高光溢出，暗部发光',
      params: [
        { k: 'amount', l: '强度', min: 0, max: 1, step: 0.02, v: 0.32 },
        { k: 'blur', l: '半径', min: 2, max: 40, step: 1, v: 14 }
      ]
    },
    chroma: {
      name: '色散', desc: 'RGB 通道错位（近似）',
      params: [
        { k: 'offset', l: '偏移', min: 0, max: 12, step: 0.5, v: 3 },
        { k: 'amount', l: '强度', min: 0, max: 1, step: 0.02, v: 0.35 }
      ]
    },
    pixelate: {
      name: '像素化', desc: '降低采样再放大',
      params: [{ k: 'size', l: '块大小', min: 1, max: 16, step: 1, v: 4 }]
    },
    scanline: {
      name: '扫描线', desc: 'CRT 横向暗线',
      params: [
        { k: 'alpha', l: '浓度', min: 0, max: 0.6, step: 0.02, v: 0.16 },
        { k: 'gap', l: '间距', min: 2, max: 8, step: 1, v: 3 }
      ]
    },
    grain: {
      name: '颗粒', desc: '胶片噪点',
      params: [{ k: 'alpha', l: '强度', min: 0, max: 0.3, step: 0.01, v: 0.05 }]
    },
    vignette: {
      name: '暗角', desc: '四周压暗',
      params: [{ k: 'amount', l: '强度', min: 0, max: 1, step: 0.02, v: 0.45 }]
    }
  };

  const DEFAULT_CHAIN = [
    { id: 'grade', on: true },
    { id: 'bloom', on: true },
    { id: 'chroma', on: false },
    { id: 'pixelate', on: false },
    { id: 'scanline', on: false },
    { id: 'grain', on: false },
    { id: 'vignette', on: true }
  ];

  const PRESETS = {
    clean:  { name: '干净',   base: '25d',   chain: { grade: 1, bloom: 0, chroma: 0, pixelate: 0, scanline: 0, grain: 0, vignette: 1 } },
    crt:    { name: '街机 CRT', base: 'pixel', chain: { grade: 1, bloom: 1, chroma: 0, pixelate: 1, scanline: 1, grain: 1, vignette: 1 } },
    cyber:  { name: '赛博',   base: 'neon',  chain: { grade: 1, bloom: 1, chroma: 1, pixelate: 0, scanline: 1, grain: 0, vignette: 1 } },
    film:   { name: '胶片',   base: 'toon',  chain: { grade: 1, bloom: 1, chroma: 0, pixelate: 0, scanline: 0, grain: 1, vignette: 1 } },
    ink:    { name: '宣纸',   base: 'ink',   chain: { grade: 1, bloom: 0, chroma: 0, pixelate: 0, scanline: 0, grain: 1, vignette: 1 } }
  };

  class HyperRenderer {
    constructor(engine) {
      this.engine = engine;
      this.time = 0;
      this.base = '25d';
      this.chain = U.clone(DEFAULT_CHAIN).map(c => Object.assign({ p: {} }, c));
      // 参数初值
      for (const c of this.chain) {
        const def = PASS_DEFS[c.id];
        if (!def) continue;
        for (const p of def.params) c.p[p.k] = p.v;
      }
      this.script = '';
      this.scriptFn = null;
      this.scriptErr = null;
      this.preset = 'clean';

      this.src = null;
      this.cur = null;
      this.dst = null;
      this.small = null;
      this.noise = null;
      this.scan = null;
      this.baseInstance = null;
      this.baseId = null;
      this.lastFrame = 0;
    }

    destroy() { this.baseInstance = null; }

    /* ---------- 画布 ---------- */
    ensure() {
      if (this.src || typeof document === 'undefined') return;
      const mk = (w, h) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
      };
      this.src = mk(W, H); this.srcCtx = this.src.getContext('2d');
      this.cur = mk(W, H); this.curCtx = this.cur.getContext('2d');
      this.dst = mk(W, H); this.dstCtx = this.dst.getContext('2d');
      this.small = mk(320, 180); this.smallCtx = this.small.getContext('2d');
      this.bloomBuf = mk(320, 180); this.bloomCtx = this.bloomBuf.getContext('2d');

      // 噪点
      this.noise = mk(96, 96);
      const ng = this.noise.getContext('2d');
      const img = ng.createImageData(96, 96);
      let seed = 20261023;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + rnd() * 135;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ng.putImageData(img, 0, 0);
    }

    /* ---------- 基础后端 ---------- */
    getBase(id) {
      if (this.baseId === id && this.baseInstance) return this.baseInstance;
      const def = FE.renderers.get(id);
      if (!def || def.id === 'hyper') return null;
      if (this.baseInstance && this.baseInstance.destroy) this.baseInstance.destroy();
      this.baseInstance = def.create(this.engine);
      this.baseId = id;
      return this.baseInstance;
    }

    setBase(id) {
      const def = FE.renderers.get(id);
      if (!def || id === 'hyper') return false;
      // 自走仿真的后端不能作为基础层（否则会双内核）
      if (def.create && def.id === 'c') return false;
      this.base = id;
      this.baseInstance = null;
      this.baseId = null;
      return true;
    }

    setPreset(key) {
      const p = PRESETS[key];
      if (!p) return false;
      this.preset = key;
      this.setBase(p.base);
      for (const c of this.chain) {
        if (p.chain[c.id] !== undefined) c.on = !!p.chain[c.id];
      }
      if (key === 'crt') {
        this.setParam('pixelate', 'size', 3);
        this.setParam('scanline', 'alpha', 0.20);
        this.setParam('grain', 'alpha', 0.05);
      }
      if (key === 'cyber') {
        this.setParam('chroma', 'offset', 4);
        this.setParam('chroma', 'amount', 0.45);
        this.setParam('grade', 'hue', 25);
        this.setParam('scanline', 'alpha', 0.10);
      }
      if (key === 'film') {
        this.setParam('grade', 'sat', 0.9);
        this.setParam('grade', 'con', 1.1);
        this.setParam('grain', 'alpha', 0.09);
        this.setParam('bloom', 'amount', 0.42);
      }
      if (key === 'ink') {
        this.setParam('grade', 'sat', 1.1);
        this.setParam('grain', 'alpha', 0.07);
      }
      return true;
    }

    setParam(passId, key, v) {
      const c = this.chain.find(x => x.id === passId);
      if (c) c.p[key] = v;
    }

    /** 编译用户脚本 */
    applyScript(src) {
      this.script = src || '';
      this.scriptErr = null;
      this.scriptFn = null;
      if (!this.script.trim()) return true;
      try {
        // eslint-disable-next-line no-new-func
        this.scriptFn = new Function('api', this.script);
        return true;
      } catch (e) {
        this.scriptErr = String(e.message || e);
        return false;
      }
    }

    /* ---------- 绘制 ---------- */
    draw(match, dt) {
      this.time += 1 / 60;
      const ctx = this.engine.ctx;

      /* 与外部配置（面板）同步 */
      const cfg = FE.hyperCfg;
      if (cfg) {
        if (cfg.base && cfg.base !== this.base) {
          this.base = cfg.base;
          this.baseInstance = null;
          this.baseId = null;
        }
        if (cfg.chain) this.chain = cfg.chain;
        if (cfg.script !== undefined && cfg.script !== this.script) {
          this.applyScript(cfg.script);
        }
      }

      if (!match) { FE.kit.idle(ctx, 'HYPER'); return; }
      this.ensure();
      if (!this.srcCtx) { FE.kit.idle(ctx, 'HYPER'); return; }

      const base = this.getBase(this.base);
      if (!base) { FE.kit.idle(ctx, 'HYPER'); return; }

      /* 1. 基础后端画到离屏 */
      const realCtx = this.engine.ctx;
      this.srcCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.srcCtx.clearRect(0, 0, W, H);
      this.engine.ctx = this.srcCtx;
      try {
        base.draw(match, 1);
      } catch (e) {
        this.scriptErr = 'base: ' + e.message;
      } finally {
        this.engine.ctx = realCtx;
      }

      /* 2. 通道链（严格 ping-pong，避免源目标重叠） */
      let cur = this.src;
      let useDst = true;
      for (const c of this.chain) {
        if (!c.on) continue;
        const fn = this.passFn(c.id);
        if (!fn) continue;
        const target = useDst ? this.dstCtx : this.curCtx;
        const targetCanvas = useDst ? this.dst : this.cur;
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.clearRect(0, 0, W, H);
        try {
          fn.call(this, target, cur, c.p || {});
        } catch (e) {
          this.scriptErr = c.id + ': ' + e.message;
          target.drawImage(cur, 0, 0);
        }
        cur = targetCanvas;
        useDst = !useDst;
      }

      /* 3. 合成到屏幕 */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(cur, 0, 0);

      /* 4. 自定义脚本 */
      if (this.scriptFn) {
        try {
          this.scriptFn({
            ctx, src: cur, W, H,
            frame: match.frame, time: this.time,
            api: this
          });
        } catch (e) {
          this.scriptErr = 'script: ' + e.message;
          this.scriptFn = null;
        }
      }

      this.projectPoint = base.projectPoint;
    }

    passFn(id) {
      switch (id) {
        case 'grade':
          return function (t, src, p) {
            t.filter = `saturate(${p.sat}) contrast(${p.con}) brightness(${p.bri}) hue-rotate(${p.hue}deg)`;
            t.drawImage(src, 0, 0);
            t.filter = 'none';
          };
        case 'bloom':
          return function (t, src, p) {
            t.drawImage(src, 0, 0);
            // 1/4 降采样后模糊，再放大叠加 —— 视觉几乎一致，开销降到 1/16
            const bw = 320, bh = 180;
            const bc = this.bloomCtx;
            if (!bc) return;
            this.bloomBuf.width = bw; this.bloomBuf.height = bh;
            bc.setTransform(1, 0, 0, 1, 0, 0);
            bc.clearRect(0, 0, bw, bh);
            bc.drawImage(src, 0, 0, bw, bh);
            t.save();
            t.globalCompositeOperation = 'lighter';
            t.globalAlpha = p.amount;
            t.filter = `blur(${Math.max(1, p.blur / 4)}px)`;
            t.drawImage(this.bloomBuf, 0, 0, bw, bh, 0, 0, W, H);
            t.restore();
          };
        case 'chroma':
          return function (t, src, p) {
            t.drawImage(src, 0, 0);
            t.save();
            t.globalCompositeOperation = 'lighter';
            t.globalAlpha = p.amount;
            t.drawImage(src, p.offset, 0);
            t.drawImage(src, -p.offset, 0);
            t.restore();
          };
        case 'pixelate':
          return function (t, src, p) {
            const s = Math.max(1, p.size | 0);
            const w = Math.max(1, Math.floor(W / s)), h = Math.max(1, Math.floor(H / s));
            this.small.width = w; this.small.height = h;
            this.smallCtx.imageSmoothingEnabled = false;
            this.smallCtx.clearRect(0, 0, w, h);
            this.smallCtx.drawImage(src, 0, 0, w, h);
            t.imageSmoothingEnabled = false;
            t.drawImage(this.small, 0, 0, w, h, 0, 0, W, H);
            t.imageSmoothingEnabled = true;
          };
        case 'scanline':
          return function (t, src, p) {
            t.drawImage(src, 0, 0);
            const gap = Math.max(2, p.gap | 0);
            if (!this.scanPat || this.scanGap !== gap) {
              const c = document.createElement('canvas');
              c.width = 1; c.height = gap;
              const g = c.getContext('2d');
              g.fillStyle = 'rgba(0,0,0,1)';
              g.fillRect(0, 0, 1, 1);
              this.scanPat = c;
              this.scanGap = gap;
            }
            const pat = t.createPattern(this.scanPat, 'repeat');
            if (!pat) return;
            t.save();
            t.globalAlpha = p.alpha;
            t.fillStyle = pat;
            t.fillRect(0, 0, W, H);
            t.restore();
          };
        case 'grain':
          return function (t, src, p) {
            t.drawImage(src, 0, 0);
            if (!this.noise) return;
            const pat = t.createPattern(this.noise, 'repeat');
            if (!pat) return;
            t.save();
            t.globalAlpha = p.alpha * 2.2;
            t.fillStyle = pat;
            t.fillRect(0, 0, W, H);
            t.restore();
          };
        case 'vignette':
          return function (t, src, p) {
            t.drawImage(src, 0, 0);
            const g = t.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.95);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, `rgba(0,0,0,${p.amount})`);
            t.fillStyle = g;
            t.fillRect(0, 0, W, H);
          };
        default:
          return null;
      }
    }
  }

  FE.renderers.register('hyper', {
    name: 'Hyper 管线',
    short: 'HYPER',
    desc: '可编排渲染通道 + 自定义脚本，能直接改写渲染方式',
    create(engine) { return new HyperRenderer(engine); }
  });

  FE.hyperDefs = { PASS_DEFS, DEFAULT_CHAIN, PRESETS };
})();
