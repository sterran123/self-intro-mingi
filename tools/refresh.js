// refresh.js — 리추얼 기록·과제·출석 입력 → 사이트 숫자 + 능력별 문단 후보 재생성
// 같은 입력이면 언제나 같은 결과. 외부 호출 없이 파일만 읽어 계산한다.
// 사용: node tools/refresh.js   (결과: docs/data.json, output/candidates.md)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const INPUT = path.join(ROOT, 'input');
const SRC_LABEL = '리추얼 기록(13주)';

const read = f => { try { return fs.readFileSync(path.join(INPUT, f), 'utf8'); } catch (e) { return null; } };
const sha = s => crypto.createHash('sha256').update(s ?? '').digest('hex').slice(0, 12);

/* ── 1) 리추얼 기록 파싱 ── */
function parseRitual(md) {
  const days = [];
  const re = /^## (\d{4}-\d{2}-\d{2})\s*$/gm;
  let m, prev = null;
  const marks = [];
  while ((m = re.exec(md))) marks.push({ date: m[1], i: m.index + m[0].length });
  for (let k = 0; k < marks.length; k++) {
    const body = md.slice(marks[k].i, marks[k + 1] ? marks[k + 1].i - (marks[k + 1].date.length + 4) : md.length);
    const d = { date: marks[k].date, 아침: [], 마무리: [] };
    let sec = null;
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (t === '[아침]') { sec = '아침'; continue; }
      if (t === '[마무리]') { sec = '마무리'; continue; }
      const f = /^-\s*([^:：]+)\s*[:：]\s*(.*)$/.exec(t);
      if (sec && f) d[sec].push({ key: f[1].trim(), value: f[2].trim() });
    }
    days.push(d);
  }
  return days;
}

/* ── 2) 숫자 계산 ── */
function stats(days, assignments, attendance) {
  const morning = days.filter(d => d.아침.length).length;
  const eveningDays = days.filter(d => d.마무리.length);
  const fields = (d, sec) => d[sec].map(f => `${f.key}: ${f.value}`);

  // 강점 행동 실천 분포
  const prac = { 실천: 0, 일부: 0, 못함: 0 };
  eveningDays.forEach(d => d.마무리.forEach(f => {
    if (f.key.startsWith('강점 행동')) {
      if (f.value.includes('못')) prac.못함++;
      else if (f.value.includes('일부')) prac.일부++;
      else if (f.value.includes('실천')) prac.실천++;
    }
  }));
  const pracTotal = prac.실천 + prac.일부 + prac.못함;
  const pracRate = pracTotal ? Math.round((prac.실천 + prac.일부) / pracTotal * 100) : 0;

  const breaths = days.flatMap(d => d.아침).filter(f => f.key === '호흡')
    .map(f => parseFloat(f.value)).filter(v => !isNaN(v));
  const breathAvg = breaths.length ? (breaths.reduce((a, b) => a + b, 0) / breaths.length) : 0;
  const breathSum = breaths.reduce((a, b) => a + b, 0);

  const count = keyRe => days.reduce((n, d) =>
    n + d.아침.concat(d.마무리).filter(f => keyRe.test(f.key)).length, 0);

  const done = assignments ? assignments.items.filter(i => i.status === 'done').length : 0;
  const total = assignments ? assignments.items.filter(i => i.status !== 'planned').length : 0;

  const out = [
    { id: 'period', label: '기록 기간', value: `${days[0]?.date} ~ ${days[days.length - 1]?.date}`, source: SRC_LABEL, span: true },
    { id: 'days', label: '아침·마무리 기록', value: days.length, unit: '일', source: SRC_LABEL },
    { id: 'morning', label: '아침 기록', value: morning, unit: '일', source: SRC_LABEL },
    { id: 'evening', label: '마무리 기록', value: eveningDays.length, unit: '일', source: SRC_LABEL },
    { id: 'practice', label: '강점 행동 실천율', value: pracRate + '%',
      detail: `마무리 ${pracTotal}일 중 실천 ${prac.실천} · 일부 ${prac.일부} · 못 했다 ${prac.못함}`,
      source: SRC_LABEL, hardship: '못 했다고 솔직하게 적은 날도 숫자에 포함됩니다' },
    { id: 'breath', label: '아침 호흡 평균', value: breathAvg.toFixed(1), unit: '분',
      detail: `전체 ${Math.round(breathSum)}분`, source: SRC_LABEL },
    { id: 'thanks', label: '감사일기', value: count(/^감사일기/), unit: '건', source: SRC_LABEL },
    { id: 'peer', label: '동료가 말해 준 장점', value: count(/동료\s*\d+가 말해 준 내 장점/), unit: '건', source: SRC_LABEL },
    { id: 'mypraise', label: '내가 건넨 장점', value: count(/동료\s*\d+에게 말한 장점/), unit: '건', source: SRC_LABEL },
  ];
  if (assignments) out.push({
    id: 'tasks', label: '과제 완료', value: `${done}/${total}`,
    detail: assignments.items.filter(i => i.status === 'in_progress').map(i => `과제 ${i.no} 진행 중`).join(' · ') || '전부 완료',
    source: '내 제출 현황',
  });
  if (attendance) {
    const a = { 출석_일수: '출석', 결석_일수: '결석', 지각_횟수: '지각' };
    for (const [k, label] of Object.entries(a))
      if (attendance[k] != null) out.push({ id: 'att_' + k, label, value: attendance[k], unit: label === '지각' ? '회' : '일', source: '내 출석 기록' });
  }
  return out;
}

/* ── 3) 능력별 문단 후보 — 키워드 점수 + 날짜·근거 ── */
const ABILITIES = {
  자기조절력: ['버텼', '버티', '지각', '루틴', '수면', '돌아보', '관리', '참아', '졸', '일찍', '스트레칭', '절제'],
  대인관계력: ['도와주', '알려주', '대화', '동료', '감사', '인사', '토론', '조언', '친절', '들어주', '고민', '분위기', '존중', '취합', '응대'],
  자기동기력: ['첫 행동', '실천', '만들', '서비스', '강의', '목표', '행복', '긍정', '투두', '체크', '검토', '반영', '계획', '노력'],
};
const FIELD_WEIGHT = { '감사일기': 3, '강점을 위해 노력하고 생각한 것': 2, '나에게 남기는 말': 2, '강점이 드러난 일화': 2, '오늘의 첫 행동': 2, '내가 나눈 감사': 1 };

function candidates(days, perAbility = 4) {
  const all = [];
  for (const d of days)
    for (const sec of ['아침', '마무리'])
      for (const f of d[sec]) {
        if (!f.value || f.value.length < 8) continue;
        all.push({ date: d.date, sec, field: f.key, text: f.value });
      }
  const res = {};
  for (const [ab, kws] of Object.entries(ABILITIES)) {
    res[ab] = all.map(r => {
      let s = 0;
      kws.forEach(k => { s += (r.text.split(k).length - 1); });
      s += FIELD_WEIGHT[r.field] || 0;
      return { ...r, score: s };
    }).filter(r => r.score >= 3)
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
      .slice(0, perAbility)
      .map(({ date, sec, field, text, score }) => ({
        date, source: `${SRC_LABEL} ${date} ${sec} '${field}'`, text, score,
      }));
  }
  return res;
}

/* ── 4) 출력 ── */
function main() {
  const md = read('ritual.md');
  if (!md) { console.error('input/ritual.md 없음'); process.exit(1); }
  const assignments = JSON.parse(read('assignments.json') || 'null');
  const attendance = JSON.parse(read('attendance.json') || 'null');

  const days = parseRitual(md);
  const st = stats(days, assignments, attendance);
  const cand = candidates(days);

  const data = {
    input_sha256: { 'ritual.md': sha(md), 'assignments.json': sha(read('assignments.json')), 'attendance.json': sha(read('attendance.json')) },
    stats: st, candidates: cand,
  };
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'data.json'), JSON.stringify(data, null, 2));

  // 사람이 검토·승인할 후보 문서 — 날짜와 근거가 붙는다
  let out = `# 능력별 문단 후보 (자동 생성)\n\n승인할 문장만 사이트 이야기에 반영합니다. 근거는 ${SRC_LABEL}의 해당 날짜 항목입니다.\n`;
  for (const [ab, list] of Object.entries(cand)) {
    out += `\n## ${ab}\n`;
    list.forEach((c, i) => {
      out += `\n${i + 1}. **${c.date}** — ${c.text}\n   - 근거: ${c.source}\n`;
    });
  }
  fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'output', 'candidates.md'), out);

  console.log(`기록 ${days.length}일 · 숫자 ${st.length}개 · 후보 ${Object.values(cand).reduce((a, b) => a + b.length, 0)}건`);
  console.log('→ docs/data.json, output/candidates.md');
}
main();
