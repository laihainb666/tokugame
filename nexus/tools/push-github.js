/* 用 GitHub REST API 把 NEXUS FIGHT 推成一个新分支
   （本机 git 到 github 的 443 被拦，所以走 API）
   用法：GITHUB_TOKEN=xxx node tools/push-github.js
*/
const fs = require('fs');
const path = require('path');

const OWNER = 'laihainb666';
const REPO = 'tokugame';
const BRANCH = 'nexus-fight';
const PREFIX = 'nexus';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('缺少 GITHUB_TOKEN'); process.exit(1); }

const H = {
  Authorization: 'Bearer ' + TOKEN,
  'User-Agent': 'nexus-fight-publisher',
  Accept: 'application/vnd.github+json'
};

async function api(p, method, body) {
  const r = await fetch(API + p, {
    method: method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, H),
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch (_) { j = txt; }
  if (!r.ok) throw new Error(`${method || 'GET'} ${p} → ${r.status} ${txt.slice(0, 300)}`);
  return j;
}

/* 收集要上传的文件 */
const ROOT = path.join(__dirname, '..');
const FILES = [];
function add(rel, abs) {
  FILES.push({ rel, abs: abs || path.join(ROOT, rel) });
}
add('index.html');
add('README.md');
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) add('assets/' + f);
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel + '/' + e.name;
    if (e.isDirectory()) walk(abs, r);
    else if (/\.(js|css|html|md|c|h|txt|bat|sh)$/.test(e.name) || e.name === 'Makefile') add(r, abs);
  }
}
walk(path.join(ROOT, 'src'), 'src');
walk(path.join(ROOT, 'native'), 'native');
walk(path.join(ROOT, 'test'), 'test');
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) {
  if (f.endsWith('.js')) add('tools/' + f);
}

(async () => {
  console.log('仓库', OWNER + '/' + REPO, '分支', BRANCH);
  const info = await api(`/repos/${OWNER}/${REPO}`);
  const base = info.default_branch;
  const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${base}`);
  const headSha = ref.object.sha;
  const headCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  console.log('基线', base, headSha.slice(0, 7));

  /* 1. 建 blob */
  const tree = [];
  for (const f of FILES) {
    const buf = fs.readFileSync(f.abs);
    const b64 = buf.toString('base64');
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, 'POST', {
      content: b64, encoding: 'base64'
    });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write(`  ${f.rel} (${(buf.length / 1024).toFixed(0)}KB)\n`);
  }
  console.log('共', tree.length, '个文件');

  /* 2. nexus 子树 */
  const sub = await api(`/repos/${OWNER}/${REPO}/git/trees`, 'POST', { tree });

  /* 3. 根树：在基线之上加 nexus/，并替换入口页 */
  const rootIndex = fs.readFileSync(path.join(ROOT, 'tools', 'index-entry.html'), 'utf8');
  const idxBlob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, 'POST', {
    content: Buffer.from(rootIndex).toString('base64'), encoding: 'base64'
  });
  const rootTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, 'POST', {
    base_tree: headCommit.tree.sha,
    tree: [
      { path: PREFIX, mode: '040000', type: 'tree', sha: sub.sha },
      { path: 'index.html', mode: '100644', type: 'blob', sha: idxBlob.sha }
    ]
  });

  /* 4. 提交 */
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, 'POST', {
    message: 'feat(nexus): 引入 NEXUS FIGHT 可扩展格斗引擎 + 326 角色内容包\n\n' +
      '- 9 种渲染后端：3D / 2.5D / 纯内核数据 / C 内核 / 像素 / 水墨 / 霓虹 / 赛璐璐 / Hyper 管线\n' +
      '- 角色适配检测：未适配后端自动生成替身\n' +
      '- 图片生成角色 + 本地创意工坊\n' +
      '- Hyper 渲染管线：通道链 + 自定义脚本，可改写渲染方式\n' +
      '- 内容包：导入 tokugame v38 的 326 名角色与 13 张战场\n' +
      '- native/nexus.c：Q16.16 定点 C 内核（单文件零依赖）+ 基准哈希对拍',
    tree: rootTree.sha,
    parents: [headSha]
  });
  console.log('commit', commit.sha.slice(0, 7));

  /* 5. 建分支 */
  try {
    await api(`/repos/${OWNER}/${REPO}/git/refs`, 'POST', {
      ref: `refs/heads/${BRANCH}`, sha: commit.sha
    });
  } catch (e) {
    // 已存在则更新
    await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, 'PATCH', {
      sha: commit.sha, force: true
    });
  }
  console.log('\n✅ 分支已推送:', `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`);
  console.log('   预览:', `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${PREFIX}/index.html`);
})();
