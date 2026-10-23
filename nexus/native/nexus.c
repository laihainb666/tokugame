/* ==========================================================================
   NEXUS FIGHT — 纯 C 内核 (C99, 零依赖, 单文件)
   ==========================================================================
   这是与 JS 版**完全不同架构**的第二个内核实现：

     JS 内核                      C 内核
     ------------------------     --------------------------
     浮点运算                      Q16.16 定点整数（位级确定性）
     对象 + 动态数组              定长结构体 + 静态数组（零分配）
     回调式状态机                 显式 switch 状态机
     Math.random                  xorshift32（可复现）
     无法逐帧复现                 每帧可计算 FNV-1a 状态哈希

   编译（任选其一）：
     gcc -O2 -std=c99 nexus.c -o nexus
     clang -O2 nexus.c -o nexus
     cl nexus.c /O2 /Fe:nexus.exe
     tcc nexus.c -o nexus.exe

   运行：
     nexus                       // 默认 900 帧, seed 12345
     nexus 1800 777              // 1800 帧, seed 777
     nexus 900 12345 --quiet     // 只打印最终哈希

   WASM 构建（给浏览器用）：
     clang --target=wasm32 -nostdlib -O2 -DNK_NO_MAIN \
           -Wl,--no-entry -Wl,--export-all -o nexus.wasm nexus.c
     emcc -O2 -DNK_NO_MAIN -s EXPORTED_FUNCTIONS='["_nk_init","_nk_step",...]' \
           nexus.c -o nexus.js

   浏览器里的 JS 镜像见 src/kernel/c-kernel.js —— 它与本文件逐行同构，
   跑出的帧哈希必须与 C 版完全一致（见 native/GOLDEN.txt）。
   ========================================================================== */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* --------------------------------------------------------------------------
   Q16.16 定点
   -------------------------------------------------------------------------- */
typedef int32_t fx;

#define FXQ(n)      ((fx)((n) * 65536))          /* 整数 → 定点 */
#define FXH(n)      ((fx)((n) * 32768))          /* 半数 → 定点（1.5 写作 FXH(3)）*/
#define FX_ONE      (65536)
#define FX_INT(v)   ((v) >> 16)                  /* 取整（向负无穷） */
#define FX_F(v)     ((float)(v) / 65536.0f)

static fx fx_mul(fx a, fx b) {
    return (fx)(((int64_t)a * (int64_t)b) >> 16);
}
static fx fx_div(fx a, fx b) {
    if (b == 0) return 0;
    return (fx)(((int64_t)a << 16) / (int64_t)b);
}
static fx fx_abs(fx a) { return a < 0 ? -a : a; }

/* --------------------------------------------------------------------------
   常量（全部预先算好，避免不同编译器对浮点常量的差异）
   -------------------------------------------------------------------------- */
#define NK_MAX_FIGHTERS 2
#define NK_MAX_PROJ     8
#define NK_MAX_REPLAY   20000

#define NK_STAGE_HALF   FXQ(640)
#define NK_GRAVITY      51118      /* 0.780 */
#define NK_JUMP         930611     /* 14.200 */
#define NK_WALK         180224     /* 2.750 */
#define NK_BACK         140902     /* 2.150 */
#define NK_AIRCTRL      29491      /* 0.450 */
#define NK_FRICTION     52428      /* 0.800 */
#define NK_AIRFRIC      63897      /* 0.975 */
#define NK_STUNFRIC     58982      /* 0.900 */

#define NK_MAX_HP       1000
#define NK_MAX_METER    100
#define NK_METER_REGEN  3          /* 每帧 0.05 的百分之一，近似 */

/* 状态 */
enum {
    ST_IDLE = 0, ST_WALK_F, ST_WALK_B, ST_CROUCH, ST_AIR,
    ST_ATTACK, ST_HITSTUN, ST_BLOCKSTUN, ST_KO, ST_COUNT
};

/* 招式 */
enum { MV_LIGHT = 0, MV_HEAVY, MV_SWEEP, MV_UPPER, MV_FIRE, MV_SUPER, MV_COUNT };

/* 打击高度 */
enum { HT_MID = 0, HT_LOW, HT_OVERHEAD, HT_UNBLOCKABLE };

/* 招式种类 */
enum { MK_NORMAL = 0, MK_PROJECTILE, MK_LAUNCHER };

/* 输入按钮位 */
enum {
    BTN_LIGHT = 1 << 0,
    BTN_HEAVY = 1 << 1,
    BTN_SPECIAL = 1 << 2,
    BTN_SUPER = 1 << 3,
    BTN_JUMP = 1 << 4
};

typedef struct {
    const char *name;
    int startup, active, recovery;
    fx  hbx, hby;
    int hbw, hbh;
    int dmg, hitstun, blockstun, hitstop;
    fx  kbx, kby;
    int height, cost, gain, kind;
} NkMove;

/*                       名      起 判 收   判定盒x    y     w   h   伤 硬 挡 顿   击退x      击退y      高 耗 回 类 */
static const NkMove NK_MOVES[MV_COUNT] = {
    { "light",  4,  3,  7,  FXQ(44), FXQ(116), 54,  24,  36, 15,  9,  5, FXH(3),      0,             HT_MID, 0,  5, MK_NORMAL },
    { "heavy",  9,  4, 15,  FXQ(50), FXQ(110), 62,  32,  82, 21, 13,  8, 222822,      0,             HT_MID, 0,  9, MK_NORMAL },
    { "sweep", 10,  4, 22,  FXQ(48), FXQ(26),  74,  26,  68, 26, 13,  9, 235929,      360448,        HT_LOW, 0,  9, MK_NORMAL },
    { "upper",  5,  5, 26,  FXQ(40), FXQ(130), 58,  76,  96, 28, 14, 10, 157286,      622592,        HT_MID, 0, 11, MK_LAUNCHER },
    { "fire",  12,  2, 24,  FXQ(52), FXQ(104),  0,   0,   0,  0,  0,  0, 0,           0,             HT_MID, 0, 12, MK_PROJECTILE },
    { "super",  8, 10, 30,  FXQ(46), FXQ(90), 150, 130, 240, 34, 20, 16, 524288,      393216,        HT_MID, 50, 0, MK_NORMAL }
};

typedef struct {
    fx x, y, vx, vy;
    int facing;
    int state, state_time;
    int move_id, move_frame;
    int health, meter;
    int hitstop, stun, invuln, armor;
    int airborne;
    int combo, combo_dmg, combo_timer;
    int hit_reg;         /* 本次招式已命中过（0/1），防同帧多段 */
    int crouching;
} NkFighter;

typedef struct {
    int active;
    int owner;
    fx x, y, vx;
    int w, h;
    int life;
    int dmg, hitstun, blockstun, hitstop;
    fx kbx, kby;
} NkProj;

typedef struct {
    int8_t dx, dy;
    uint16_t btn;
} NkInput;

typedef struct {
    NkFighter f[NK_MAX_FIGHTERS];
    NkProj    p[NK_MAX_PROJ];
    NkInput   in[NK_MAX_FIGHTERS];
    uint32_t  rng;
    uint32_t  frame;
    uint32_t  hash;
    int       timer;        /* 剩余帧数 */
    int       winner;       /* -1 未结束, 0/1 获胜, 2 平局 */
    uint32_t  replay[NK_MAX_REPLAY];
    int       replay_len;
} NkState;

/* --------------------------------------------------------------------------
   确定性随机
   -------------------------------------------------------------------------- */
static uint32_t nk_rand(NkState *s) {
    uint32_t x = s->rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s->rng = x;
    return x;
}

/* --------------------------------------------------------------------------
   几何
   -------------------------------------------------------------------------- */
static int nk_overlap(fx ax, fx ay, int aw, int ah, fx bx, fx by, int bw, int bh) {
    /* 盒子以 (x, y) 为底边中点 */
    fx a_half = aw * FX_ONE / 2;
    fx b_half = bw * FX_ONE / 2;
    fx dx = ax - bx;
    if (dx < 0) dx = -dx;
    if (dx >= a_half + b_half) return 0;
    if (ay + (fx)(ah * FX_ONE) <= by) return 0;
    if (by + (fx)(bh * FX_ONE) <= ay) return 0;
    return 1;
}

/* --------------------------------------------------------------------------
   初始化
   -------------------------------------------------------------------------- */
static void nk_init(NkState *s, uint32_t seed) {
    memset(s, 0, sizeof(NkState));
    s->rng = seed ? seed : 1u;
    s->timer = 60 * 60;
    s->winner = -1;
    s->frame = 0;
    for (int i = 0; i < NK_MAX_FIGHTERS; i++) {
        NkFighter *f = &s->f[i];
        f->x = (i == 0) ? -FXQ(150) : FXQ(150);
        f->facing = (i == 0) ? 1 : -1;
        f->state = ST_IDLE;
        f->health = NK_MAX_HP;
        f->meter = 0;
        f->move_id = -1;
    }
    s->hash = 0x811c9dc5u;
}

/* --------------------------------------------------------------------------
   输入 → 招式选择
   -------------------------------------------------------------------------- */
static int nk_can_act(const NkFighter *f) {
    return f->state == ST_IDLE || f->state == ST_WALK_F ||
           f->state == ST_WALK_B || f->state == ST_CROUCH ||
           f->state == ST_AIR;
}

static int nk_select(const NkFighter *f, const NkInput *in) {
    int crouch = (in->dy > 0) && !f->airborne;
    int up = (in->dy < 0);
    int grounded = !f->airborne;

    if (in->btn & BTN_SUPER) {
        if (f->meter >= NK_MOVES[MV_SUPER].cost) return MV_SUPER;
    }
    if (in->btn & BTN_SPECIAL) {
        if (grounded) return MV_FIRE;
    }
    if (in->btn & BTN_HEAVY) {
        if (grounded && up) return MV_UPPER;
        if (grounded && crouch) return MV_SWEEP;
        if (grounded) return MV_HEAVY;
    }
    if (in->btn & BTN_LIGHT) {
        if (grounded) return MV_LIGHT;
    }
    return -1;
}

static void nk_start_move(NkState *s, int idx, int mv) {
    NkFighter *f = &s->f[idx];
    const NkMove *m = &NK_MOVES[mv];
    if (m->cost > 0 && f->meter < m->cost) return;
    f->meter -= m->cost;
    f->move_id = mv;
    f->move_frame = 0;
    f->hit_reg = 0;
    f->armor = (mv == MV_SUPER) ? 1 : 0;
    f->invuln = (mv == MV_SUPER) ? 12 : (mv == MV_UPPER ? 6 : 0);
    f->state = ST_ATTACK;
    f->state_time = 0;
}

/* --------------------------------------------------------------------------
   地面移动
   -------------------------------------------------------------------------- */
static void nk_ground_move(NkState *s, int idx) {
    NkFighter *f = &s->f[idx];
    const NkInput *in = &s->in[idx];

    if (in->dy > 0) { f->state = ST_CROUCH; return; }
    if (in->dx == 0) { f->state = ST_IDLE; return; }
    if (in->dx == f->facing) {
        f->vx = NK_WALK;
        f->state = ST_WALK_F;
    } else {
        f->vx = -NK_BACK;
        f->state = ST_WALK_B;
    }
}

/* --------------------------------------------------------------------------
   投射物
   -------------------------------------------------------------------------- */
static void nk_spawn_proj(NkState *s, int idx) {
    for (int i = 0; i < NK_MAX_PROJ; i++) {
        if (!s->p[i].active) {
            NkFighter *f = &s->f[idx];
            NkProj *p = &s->p[i];
            p->active = 1;
            p->owner = idx;
            p->x = f->x + (fx)f->facing * FXQ(62);
            p->y = f->y + FXQ(104);
            p->vx = (fx)f->facing * 622592;   /* 9.5 */
            p->w = 34;
            p->h = 30;
            p->life = 110;
            p->dmg = 62;
            p->hitstun = 20;
            p->blockstun = 12;
            p->hitstop = 7;
            p->kbx = 209715;                  /* 3.2 */
            p->kby = 78643;                   /* 1.2 */
            return;
        }
    }
}

/* --------------------------------------------------------------------------
   命中应用
   -------------------------------------------------------------------------- */
static void nk_apply_hit(NkState *s, int ai, int vi, const NkMove *m) {
    NkFighter *a = &s->f[ai];
    NkFighter *v = &s->f[vi];
    const NkInput *vin = &s->in[vi];

    /* 连段递减：0.87^n，最低 0.22 */
    int scale_q = 65536;
    for (int i = 0; i < a->combo && i < 12; i++) scale_q = scale_q * 87 / 100;
    if (scale_q < 14418) scale_q = 14418;

    int blocked = 0;
    if (!v->airborne && v->state != ST_ATTACK && m->height != HT_UNBLOCKABLE) {
        if (vin->dx == -v->facing) {
            blocked = 1;
            if (m->height == HT_LOW && !(vin->dy > 0)) blocked = 0;
            if (m->height == HT_OVERHEAD && (vin->dy > 0)) blocked = 0;
        }
    }

    int dmg = m->dmg * scale_q / 65536;
    if (blocked) dmg = dmg * 14 / 100;

    v->health -= dmg;
    if (v->health < 0) v->health = 0;
    a->meter += m->gain;
    if (a->meter > NK_MAX_METER) a->meter = NK_MAX_METER;
    v->meter += blocked ? 2 : 3;
    if (v->meter > NK_MAX_METER) v->meter = NK_MAX_METER;

    if (blocked) {
        v->state = ST_BLOCKSTUN;
        v->stun = m->blockstun;
        v->hitstop = m->hitstop * 6 / 10;
        a->hitstop = m->hitstop * 6 / 10;
        v->vx = (v->x > a->x ? 1 : -1) * (m->kbx / 2);
    } else {
        v->facing = (a->x > v->x) ? 1 : -1;
        v->state = ST_HITSTUN;
        v->stun = m->hitstun;
        v->hitstop = m->hitstop;
        a->hitstop = m->hitstop;
        v->vx = (v->x > a->x ? 1 : -1) * m->kbx;
        if (m->kby > 0) {
            v->airborne = 1;
            v->vy = m->kby;
        }
        a->combo += 1;
        a->combo_dmg += dmg;
        a->combo_timer = m->hitstun;
    }

    if (v->health <= 0) {
        v->state = ST_KO;
        v->vy = 7 * FX_ONE;
        v->vx = (v->x > a->x ? 1 : -1) * 5 * FX_ONE;
        v->airborne = 1;
    }
}

/* --------------------------------------------------------------------------
   近战解算
   -------------------------------------------------------------------------- */
static void nk_resolve(NkState *s) {
    for (int ai = 0; ai < NK_MAX_FIGHTERS; ai++) {
        NkFighter *a = &s->f[ai];
        if (a->state != ST_ATTACK || a->move_id < 0 || a->hit_reg) continue;
        const NkMove *m = &NK_MOVES[a->move_id];
        if (m->kind == MK_PROJECTILE) continue;
        if (a->move_frame < m->startup) continue;
        if (a->move_frame >= m->startup + m->active) continue;

        int vi = 1 - ai;
        NkFighter *v = &s->f[vi];
        if (v->state == ST_KO || v->invuln > 0) continue;

        fx hx = a->x + (fx)a->facing * m->hbx;
        fx hy = a->y + m->hby;
        int uh = (v->state == ST_CROUCH || v->crouching) ? 112 : 176;

        if (nk_overlap(hx, hy, m->hbw, m->hbh, v->x, v->y, 54, uh)) {
            /* 霸体 */
            if (v->armor > 0 && v->state == ST_ATTACK) {
                v->armor -= 1;
                v->health -= m->dmg * 6 / 10;
                if (v->health < 0) v->health = 0;
                v->hitstop = m->hitstop;
                a->hit_reg = 1;
                continue;
            }
            nk_apply_hit(s, ai, vi, m);
            a->hit_reg = 1;
        }
    }
}

/* --------------------------------------------------------------------------
   投射物更新
   -------------------------------------------------------------------------- */
static void nk_update_proj(NkState *s) {
    for (int i = 0; i < NK_MAX_PROJ; i++) {
        NkProj *p = &s->p[i];
        if (!p->active) continue;
        p->x += p->vx;
        p->life -= 1;
        if (p->life <= 0 || p->x < -NK_STAGE_HALF - FXQ(80) || p->x > NK_STAGE_HALF + FXQ(80)) {
            p->active = 0;
            continue;
        }
        int vi = 1 - p->owner;
        NkFighter *v = &s->f[vi];
        if (v->state == ST_KO || v->invuln > 0) continue;
        int uh = (v->state == ST_CROUCH || v->crouching) ? 112 : 176;
        if (nk_overlap(p->x, p->y, p->w, p->h, v->x, v->y, 54, uh)) {
            NkMove tmp = NK_MOVES[MV_LIGHT];
            tmp.dmg = p->dmg;
            tmp.hitstun = p->hitstun;
            tmp.blockstun = p->blockstun;
            tmp.hitstop = p->hitstop;
            tmp.kbx = p->kbx;
            tmp.kby = p->kby;
            tmp.height = HT_MID;
            nk_apply_hit(s, p->owner, vi, &tmp);
            p->active = 0;
        }
    }
}

/* --------------------------------------------------------------------------
   单角色更新
   -------------------------------------------------------------------------- */
static void nk_step_fighter(NkState *s, int idx) {
    NkFighter *f = &s->f[idx];
    const NkInput *in = &s->in[idx];

    if (f->hitstop > 0) { f->hitstop -= 1; return; }
    if (f->invuln > 0) f->invuln -= 1;
    f->state_time += 1;
    if ((s->frame & 15) == 0 && f->meter < NK_MAX_METER) f->meter += 1;

    /* 连段计时：对手脱离硬直后清零 */
    if (f->combo_timer > 0) {
        f->combo_timer -= 1;
        if (f->combo_timer == 0) f->combo = 0;
    }

    int oi = 1 - idx;
    fx ox = s->f[oi].x;
    if (!f->airborne &&
        (f->state == ST_IDLE || f->state == ST_WALK_F || f->state == ST_WALK_B ||
         f->state == ST_CROUCH || f->state == ST_BLOCKSTUN)) {
        if (ox > f->x + FXQ(6)) f->facing = 1;
        else if (ox < f->x - FXQ(6)) f->facing = -1;
    }

    f->crouching = (in->dy > 0) && !f->airborne;

    switch (f->state) {
    case ST_HITSTUN:
    case ST_BLOCKSTUN:
        f->stun -= 1;
        if (f->stun <= 0) {
            f->state = f->airborne ? ST_AIR : ST_IDLE;
        }
        break;

    case ST_KO:
        break;

    case ST_ATTACK: {
        const NkMove *m = &NK_MOVES[f->move_id];
        int prev = f->move_frame;
        f->move_frame += 1;
        if (m->kind == MK_PROJECTILE && prev < m->startup && f->move_frame >= m->startup) {
            nk_spawn_proj(s, idx);
        }
        if (f->move_frame >= m->startup + m->active + m->recovery) {
            f->move_id = -1;
            f->state = f->airborne ? ST_AIR : ST_IDLE;
        }
        break;
    }

    case ST_AIR:
        if (in->dx != 0) f->vx += (fx)in->dx * NK_AIRCTRL;
        if (f->vx > 589824) f->vx = 589824;
        if (f->vx < -589824) f->vx = -589824;
        break;

    default: {
        int mv = nk_select(f, in);
        if (mv >= 0) { nk_start_move(s, idx, mv); break; }
        nk_ground_move(s, idx);
        break;
    }
    }

    /* --- 物理 --- */
    {
        fx fr;
        if (f->airborne) fr = NK_AIRFRIC;
        else if (f->state == ST_HITSTUN || f->state == ST_BLOCKSTUN) fr = NK_STUNFRIC;
        else fr = NK_FRICTION;

        int walking = (f->state == ST_WALK_F || f->state == ST_WALK_B);
        if (!walking) {
            f->vx = fx_mul(f->vx, fr);
            if (f->vx > -1311 && f->vx < 1311) f->vx = 0;
        }

        f->x += f->vx;
        if (f->x > NK_STAGE_HALF) f->x = NK_STAGE_HALF;
        if (f->x < -NK_STAGE_HALF) f->x = -NK_STAGE_HALF;

        if (f->airborne || f->y > 0) {
            f->vy -= NK_GRAVITY;
            f->y += f->vy;
            if (f->y <= 0) {
                f->y = 0;
                if (f->vy < -FX_ONE) {
                    f->airborne = 0;
                    f->vy = 0;
                    f->vx = f->vx * 55 / 100;
                    if (f->state == ST_KO) {
                        /* 保持倒地 */
                    } else {
                        f->state = ST_IDLE;
                        f->move_id = -1;
                        f->stun = 0;
                    }
                } else {
                    f->airborne = 0;
                    f->vy = 0;
                }
            }
        }
    }
}

/* --------------------------------------------------------------------------
   推挤
   -------------------------------------------------------------------------- */
static void nk_separate(NkState *s) {
    NkFighter *a = &s->f[0];
    NkFighter *b = &s->f[1];
    if (a->airborne || b->airborne) return;
    fx d = b->x - a->x;
    fx min = FXQ(74);
    if (d < 0) d = -d;
    if (d < min) {
        fx push = (min - d) / 2;
        if (b->x > a->x) { a->x -= push; b->x += push; }
        else { a->x += push; b->x -= push; }
    }
}

/* --------------------------------------------------------------------------
   确定性 AI（作为"输入设备"）
   -------------------------------------------------------------------------- */
static void nk_ai(NkState *s, int side, NkInput *out) {
    NkFighter *f = &s->f[side];
    NkFighter *o = &s->f[1 - side];
    out->dx = 0; out->dy = 0; out->btn = 0;
    if (f->state == ST_KO) return;

    fx dist = fx_abs(o->x - f->x);
    int toward = (o->x > f->x) ? 1 : -1;
    uint32_t r = nk_rand(s);
    int act = (int)(r % 100);

    /* 对手在出招且很近 → 防御 */
    if (o->state == ST_ATTACK && dist < FXQ(150) && act < 45) {
        out->dx = (int8_t)(-f->facing);
        if (NK_MOVES[o->move_id < 0 ? 0 : o->move_id].height == HT_LOW) out->dy = 1;
        return;
    }

    if (dist < FXQ(105)) {
        if (act < 18) out->btn = BTN_LIGHT;
        else if (act < 34) out->btn = BTN_HEAVY;
        else if (act < 42) { out->btn = BTN_HEAVY; out->dy = 1; }
        else if (act < 50) { out->btn = BTN_HEAVY; out->dy = -1; }
        else if (act < 58 && f->meter >= NK_MOVES[MV_SUPER].cost) out->btn = BTN_SUPER;
        else out->dx = (int8_t)toward;
        return;
    }
    if (dist < FXQ(260)) {
        if (act < 22) out->btn = BTN_HEAVY;
        else if (act < 30) { out->btn = BTN_SPECIAL; }
        else out->dx = (int8_t)toward;
        return;
    }
    if (act < 26) { out->btn = BTN_SPECIAL; return; }
    out->dx = (int8_t)toward;
}

/* --------------------------------------------------------------------------
   状态哈希（逐字段，避免结构体 padding 造成的不可移植）
   -------------------------------------------------------------------------- */
static uint32_t h_u32(uint32_t h, uint32_t v) {
    h ^= v;
    h *= 16777619u;
    return h;
}

static uint32_t nk_hash(const NkState *s) {
    uint32_t h = 2166136261u;
    h = h_u32(h, s->frame);
    h = h_u32(h, s->rng);
    h = h_u32(h, (uint32_t)s->timer);
    h = h_u32(h, (uint32_t)(s->winner + 2));
    for (int i = 0; i < NK_MAX_FIGHTERS; i++) {
        const NkFighter *f = &s->f[i];
        h = h_u32(h, (uint32_t)f->x);
        h = h_u32(h, (uint32_t)f->y);
        h = h_u32(h, (uint32_t)f->vx);
        h = h_u32(h, (uint32_t)f->vy);
        h = h_u32(h, (uint32_t)(f->facing + 4));
        h = h_u32(h, (uint32_t)f->state);
        h = h_u32(h, (uint32_t)f->state_time);
        h = h_u32(h, (uint32_t)(f->move_id + 2));
        h = h_u32(h, (uint32_t)f->move_frame);
        h = h_u32(h, (uint32_t)f->health);
        h = h_u32(h, (uint32_t)f->meter);
        h = h_u32(h, (uint32_t)f->hitstop);
        h = h_u32(h, (uint32_t)f->stun);
        h = h_u32(h, (uint32_t)f->invuln);
        h = h_u32(h, (uint32_t)f->armor);
        h = h_u32(h, (uint32_t)f->airborne);
        h = h_u32(h, (uint32_t)f->combo);
        h = h_u32(h, (uint32_t)f->combo_dmg);
        h = h_u32(h, (uint32_t)f->combo_timer);
        h = h_u32(h, (uint32_t)f->hit_reg);
    }
    for (int i = 0; i < NK_MAX_PROJ; i++) {
        const NkProj *p = &s->p[i];
        h = h_u32(h, (uint32_t)p->active);
        if (p->active) {
            h = h_u32(h, (uint32_t)p->owner);
            h = h_u32(h, (uint32_t)p->x);
            h = h_u32(h, (uint32_t)p->y);
            h = h_u32(h, (uint32_t)p->life);
        }
    }
    return h;
}

/* --------------------------------------------------------------------------
   单帧推进
   -------------------------------------------------------------------------- */
static void nk_step(NkState *s) {
    s->frame += 1;

    for (int i = 0; i < NK_MAX_FIGHTERS; i++) {
        nk_ai(s, i, &s->in[i]);
        /* 记录输入（用于回放；每帧 1 个 uint32） */
        if (s->replay_len < NK_MAX_REPLAY) {
            s->replay[s->replay_len++] =
                ((uint32_t)(uint8_t)s->in[i].dx << 24) |
                ((uint32_t)(uint8_t)s->in[i].dy << 16) |
                (uint32_t)s->in[i].btn;
        }
    }

    for (int i = 0; i < NK_MAX_FIGHTERS; i++) nk_step_fighter(s, i);
    nk_update_proj(s);
    nk_resolve(s);
    nk_separate(s);

    if (s->timer > 0) s->timer -= 1;

    if (s->winner < 0) {
        int a_ko = (s->f[0].state == ST_KO);
        int b_ko = (s->f[1].state == ST_KO);
        if (a_ko && b_ko) s->winner = 2;
        else if (b_ko) s->winner = 0;
        else if (a_ko) s->winner = 1;
        else if (s->timer <= 0) {
            if (s->f[0].health == s->f[1].health) s->winner = 2;
            else s->winner = (s->f[0].health > s->f[1].health) ? 0 : 1;
        }
    }

    s->hash = nk_hash(s);
}

/* ==========================================================================
   CLI
   ========================================================================== */
#ifndef NK_NO_MAIN

static const char *NK_STATE_NAME[ST_COUNT] = {
    "idle", "walk_f", "walk_b", "crouch", "air",
    "attack", "hitstun", "blockstun", "ko"
};

int main(int argc, char **argv) {
    int frames = 900;
    uint32_t seed = 12345u;
    int quiet = 0;

    if (argc > 1) frames = atoi(argv[1]);
    if (argc > 2) seed = (uint32_t)strtoul(argv[2], 0, 10);
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--quiet") == 0) quiet = 1;
    }
    if (frames <= 0) frames = 900;

    NkState st;
    nk_init(&st, seed);

    printf("NEXUS FIGHT / C kernel\n");
    printf("seed=%u frames=%d\n", seed, frames);
    printf("---------------------------------------------------------------\n");

    uint32_t h60 = 0;
    for (int i = 0; i < frames; i++) {
        nk_step(&st);
        if (!quiet && (st.frame % 60 == 0)) {
            printf("f%05u  P1 %-9s hp=%4d m=%3d x=%8.2f | P2 %-9s hp=%4d m=%3d x=%8.2f  hash=%08X\n",
                   st.frame,
                   NK_STATE_NAME[st.f[0].state], st.f[0].health, st.f[0].meter, FX_F(st.f[0].x),
                   NK_STATE_NAME[st.f[1].state], st.f[1].health, st.f[1].meter, FX_F(st.f[1].x),
                   st.hash);
        }
        if (st.frame == 60) h60 = st.hash;
        if (st.winner >= 0) break;
    }

    printf("---------------------------------------------------------------\n");
    printf("frames=%u\n", st.frame);
    printf("winner=%d\n", st.winner);
    printf("hp: %d / %d\n", st.f[0].health, st.f[1].health);
    printf("combo: %d / %d\n", st.f[0].combo, st.f[1].combo);
    printf("replay_entries=%d\n", st.replay_len);
    printf("hash@60=%08X\n", h60);
    printf("FINAL_HASH=%08X\n", st.hash);
    printf("---------------------------------------------------------------\n");
    printf("与浏览器 C 模式对比：帧哈希必须完全一致（见 GOLDEN.txt）\n");
    return 0;
}

#endif /* NK_NO_MAIN */
