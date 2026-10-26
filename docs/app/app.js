/* 몇 번 고치면 되는가 — 논문 'AI 반복 교정의 수렴' 결과를 쓰는 앱
   측정 방법(문자 편집 거리 ÷ 입력 문자 수)과 실측 평균(조건 A/B)은 논문 §3·§4 그대로. */

// 논문 §4 실측 데이터
const PAPER = {
  a: { avg: [6.91, 1.49, 0.62], oscSamples: '10편 중 3편', label: '조건 A · 문체 다듬기 허용' },
  b: { avg: [5.00, 0.00, 0.00], oscSamples: '0편 — 전원 1차 완전 수렴', label: '조건 B · 규범 오류만' },
};
const PROMPTS = {
  a: {
    title: '조건 A 지시문 — 논문에서 쓴 것 그대로',
    text: '다음 글을 맞춤법·띄어쓰기·어색한 표현 중심으로 다듬어라. 의미와 분량·문체(합쇼체/해요체 등)는 유지하고, 고친 글만 출력하라.',
    note: '이 지시문은 스타일까지 건드릴 수 있어, 논문에서 10편 중 3편이 수렴 후에도 작은 재편집(잔존 진동)을 보였습니다. 대부분 2회차에서 수렴했으니 2~3회차에서 멈추는 것을 권합니다.',
  },
  b: {
    title: '조건 B 지시문 — 논문 대조군 그대로',
    text: '다음 글의 맞춤법과 띄어쓰기 오류만 고쳐라. 문체·어휘·문장 구조·어미는 절대 바꾸지 마라. 고친 글만 출력하라.',
    note: '이 지시문은 논문에서 10편 전부 1차 변경률 이후 0% — 완전 수렴했습니다. "계속 고치는" 진동이 싫다면 이 쪽입니다. 대신 글의 문체는 손대지 않으니 스타일 개선도 없습니다.',
  },
};

const MAXLEN = 6000; // 너무 긴 입력 보호
const rounds = [];   // 기록된 변경률 목록
let curCond = 'a';

/* ── 편집 거리 (논문과 같은 Levenshtein, 문자 기준) ── */
function lev(a, b) {
  if (a === b) return 0;
  if (b.length < a.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const $ = id => document.getElementById(id);
const taA = $('ta-a'), taB = $('ta-b');
const showErr = (msg) => {
  document.querySelectorAll('.err').forEach(e => e.remove());
  if (!msg) return;
  const el = document.createElement('p');
  el.className = 'err'; el.textContent = msg;
  document.querySelector('#measure .btn-row').after(el);
};

/* 문자 수 표시 */
const count = () => { $('cnt-a').textContent = taA.value.length + '자'; $('cnt-b').textContent = taB.value.length + '자'; };
taA.addEventListener('input', count); taB.addEventListener('input', count);

/* ── 할 일 1: 변경률 측정 ── */
$('btn-measure').addEventListener('click', () => {
  showErr('');
  const a = taA.value, b = taB.value;
  if (!a.trim()) return showErr('이전 글 칸이 비어 있습니다. 교정 전 글을 넣어 주세요.');
  if (!b.trim()) return showErr('다음 글 칸이 비어 있습니다. 교정된 글을 넣어 주세요.');
  if (a.length > MAXLEN || b.length > MAXLEN) return showErr(`한쪽 글이 ${MAXLEN.toLocaleString()}자를 넘습니다. 짧은 문단으로 해 보세요.`);

  const rate = lev(a, b) / a.length * 100;
  const r = rounds.length; // 이번이 몇 번째 측정인지
  const paperAvg = PAPER[curCond].avg[Math.min(r, 2)];
  const prev = rounds[rounds.length - 1];

  const v = $('verdict');
  v.hidden = false;
  v.className = 'verdict ' + verdictClass(rate, prev, r);
  $('v-rate').textContent = rate.toFixed(2);

  const t = $('v-title'), d = $('v-desc'), p = $('v-paper');
  if (rate === 0) {
    t.textContent = '변경 없음 — 완전 수렴 지점';
    d.textContent = 'AI가 더 고칠 곳을 못 찾았다는 뜻입니다. 여기서 멈추고 최종본을 사람이 승인하면 됩니다.';
  } else if (prev !== undefined && rate > prev) {
    t.textContent = '변경률이 되올랐습니다 — 잔존 진동';
    d.textContent = '논문에서 10편 중 3편이 보인 현상입니다. 기준이 애매한 스타일을 AI가 다시 손보는 구간 — 지금 멈추는 것을 권합니다.';
  } else if (r === 0 && rate > paperAvg * 1.5) {
    t.textContent = '첫 교정 — 논문 평균보다 조금 크게 바뀌었습니다';
    d.textContent = `1차 평균은 ${PAPER[curCond].avg[0]}%(범위 2.9~9.3%). 원본에 오류가 많았다는 뜻입니다. 다음 회차도 재 보세요.`;
  } else if (prev !== undefined && rate <= Math.max(prev * 0.1, 0.5)) {
    t.textContent = '거의 수렴 — 논문의 정지 규칙에 해당';
    d.textContent = '변경률이 직전 회차의 1/10 이하(또는 0.5% 미만)입니다. 논문의 정지 규칙대로라면 여기서 멈춰도 됩니다.';
  } else {
    t.textContent = '아직 고치는 중 — 한 회차 더 재 볼 만합니다';
    d.textContent = '논문에서도 1차가 가장 크고 2차에서 급감했습니다. 다음 회차에서 거의 0에 가까워질지 확인해 보세요.';
  }
  p.textContent = `논문 비교: ${PAPER[curCond].label} ${Math.min(r + 1, 3)}차 평균 ${paperAvg}%`;
});

/* ── 할 일 2: 회차 기록·추적 ── */
$('btn-record').addEventListener('click', () => {
  const a = taA.value, b = taB.value;
  if (!a.trim()) return showErr('기록할 측정이 없습니다. 먼저 변경률을 재세요.');
  rounds.push(+(lev(a, b) / a.length * 100).toFixed(2));
  renderRounds();
  // 다음 회차 준비: 이번 출력이 다음 입력
  taA.value = b; taB.value = ''; taB.focus(); count();
});

$('btn-next').addEventListener('click', () => { taB.focus(); $('measure').scrollIntoView({ behavior: 'smooth' }); });
$('btn-clear').addEventListener('click', () => { rounds.length = 0; renderRounds(); });

function verdictClass(rate, prev, r) {
  if (rate === 0) return 'conv';
  if (prev !== undefined && rate > prev) return 'osc';
  if (prev !== undefined && rate <= Math.max(prev * 0.1, 0.5)) return 'conv';
  return 'go';
}

function renderRounds() {
  const has = rounds.length > 0;
  $('rounds-empty').hidden = has;
  $('chart').hidden = !has;
  $('round-status').hidden = !has;
  $('round-btns').hidden = !has;
  if (!has) return;

  const max = Math.max(...rounds, PAPER.a.avg[0], 1);
  $('chart-rows').innerHTML = rounds.map((r, i) => {
    const p = PAPER[curCond].avg[Math.min(i, 2)];
    return `<div class="chart-row">
      <span>${i + 1}차</span>
      <div class="bar mine" title="${r}%"><i style="width:${r / max * 100}%"></i></div>
      <div class="bar paper" title="${p}%"><i style="width:${p / max * 100}%"></i></div>
    </div>
    <div class="chart-row"><span></span><span class="val">${r}%</span><span class="val">논문 ${p}%</span></div>`;
  }).join('');

  const last = rounds[rounds.length - 1], prev = rounds[rounds.length - 2];
  const st = $('round-status');
  if (last === 0) {
    st.className = 'round-status conv';
    st.textContent = `${rounds.length}차에 변경률 0% — 완전 수렴입니다. 더 반복해도 논문상 의미 있는 변화가 없습니다.`;
  } else if (prev !== undefined && last > prev) {
    st.className = 'round-status osc';
    st.textContent = `${rounds.length}차에서 변경률이 다시 올랐습니다(${prev}% → ${last}%) — 잔존 진동. 논문에서 본 "수렴 후 재편집" 그대로입니다.`;
  } else if (prev !== undefined && last <= Math.max(prev * 0.1, 0.5)) {
    st.className = 'round-status conv';
    st.textContent = `${rounds.length}차에 거의 수렴했습니다 — 정지 규칙상 여기서 멈추고 최종본을 사람이 승인하면 됩니다.`;
  } else {
    st.className = 'round-status go';
    st.textContent = `${rounds.length}차까지 ${last}% — 논문 패턴대로라면 다음 회차에 급감합니다. 계속 재 보세요.`;
  }
}

/* ── 할 일 3: 지시문 비교 ── */
document.querySelectorAll('.cond').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.cond').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  curCond = btn.dataset.cond;
  renderCond(); renderRounds();
}));

function renderCond() {
  const c = PROMPTS[curCond], d = PAPER[curCond];
  $('cond-detail').innerHTML = `
    <h3>${c.title}</h3>
    <p>${c.note}</p>
    <pre>${c.text}</pre>
    <button class="btn" id="btn-copy">이 지시문 복사</button>
    <p class="tiny">실측: ${d.avg.map((v, i) => `${i + 1}차 ${v}%`).join(' → ')} · 진동 샘플 ${d.oscSamples}</p>`;
  $('btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(c.text).then(() => { $('btn-copy').textContent = '복사됨 ✓'; });
  });
}
renderCond();

/* ── 예시 데이터 (논문과 별개의 공개 예시) ── */
$('btn-sample').addEventListener('click', () => {
  const samples = [
    ['오늘은 학교에서 발표를 했다. 준비를 많이 햇는데도 손이 떨렷다. 그치만 친구들이 잘했다고 해주어서 기분이 좋았다. 다음엔 더 자신있게 할수 있을것 같다.',
     '오늘은 학교에서 발표를 했다. 준비를 많이 했는데도 손이 떨렸다. 그렇지만 친구들이 잘했다고 해 줘서 기분이 좋았다. 다음엔 더 자신 있게 할 수 있을 것 같다.'],
    ['어제 읽은책이 아직도 생각난다. 주인공이 포기하지 않고 계속 도전하는것이 인상적이였다. 나도 힘든일이 있어도 쉽게 포기하면 안되겠다고 느낀다.',
     '어제 읽은 책이 아직도 생각난다. 주인공이 포기하지 않고 계속 도전하는 것이 인상적이었다. 나도 힘든 일이 있어도 쉽게 포기하면 안 되겠다고 느낀다.'],
    ['프로젝트 회의가 세시간이나 걸렸다. 각자 생각이 달라서 의견조율이 어려웠지만, 결국 모두가 동의할수 있는 결론에 도달했다. 힘들었지만 성과가 있던 회의였다.',
     '프로젝트 회의가 세 시간이나 걸렸다. 각자 생각이 달라서 의견 조율이 어려웠지만, 결국 모두가 동의할 수 있는 결론에 도달했다. 힘들었지만 성과가 있던 회의였다.'],
  ];
  const s = samples[rounds.length % samples.length];
  taA.value = s[0]; taB.value = s[1]; count(); showErr('');
  $('btn-measure').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('btn-swap').addEventListener('click', () => { const t = taA.value; taA.value = taB.value; taB.value = t; count(); });
