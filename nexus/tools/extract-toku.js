/* 从 tokugame v38 单文件里抽出 CHARS / NEW_CHARS / STAGES / TAUNTS */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = 'D:/tokugame/repo/tokugame-v38-marvis.html';
const html = fs.readFileSync(SRC, 'utf8');

/** 从 startIdx 的 '[' 开始做括号匹配（跳过字符串/模板/注释） */
function matchBracket(s, openIdx) {
  let depth = 0, i = openIdx;
  let inS = null, inTpl = 0, inLine = false, inBlock = false;
  for (; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) {
      if (c === '\\') { i++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '`') { inTpl++; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced');
}

function grab(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*\\[');
  const m = re.exec(html);
  if (!m) return null;
  const openIdx = html.indexOf('[', m.index);
  return matchBracket(html, openIdx);
}

const out = {};
for (const name of ['CHARS', 'NEW_CHARS', 'STAGES', 'TAUNTS', 'ITEMS']) {
  const src = grab(name);
  if (!src) { console.log('!! not found:', name); continue; }
  try {
    const arr = vm.runInNewContext('(' + src + ')', { Math, Date, console });
    out[name] = arr;
    console.log(name, '→', Array.isArray(arr) ? arr.length + ' 项' : typeof arr);
  } catch (e) {
    console.log('!! eval fail', name, e.message);
  }
}

fs.mkdirSync('tools/out', { recursive: true });
fs.writeFileSync('tools/out/toku-raw.json', JSON.stringify(out, null, 1));
console.log('written tools/out/toku-raw.json',
  (fs.statSync('tools/out/toku-raw.json').size / 1024).toFixed(0) + 'KB');

// 看看字段分布
const all = [...(out.CHARS || []), ...(out.NEW_CHARS || [])];
const keys = {};
const styles = {};
for (const c of all) {
  for (const k in c) keys[k] = (keys[k] || 0) + 1;
  styles[c.style || '?'] = (styles[c.style || '?'] || 0) + 1;
}
console.log('\n字段:', Object.keys(keys).join(', '));
console.log('\n风格:', JSON.stringify(styles, null, 1));
console.log('\nhead 取值:', JSON.stringify([...new Set(all.map(c => c.head))]));
console.log('ptype 取值:', JSON.stringify([...new Set(all.map(c => c.pAtk && c.pAtk.ptype))]));
console.log('special.type:', JSON.stringify([...new Set(all.map(c => c.special && c.special.type))].slice(0, 40)));
