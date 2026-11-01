/**
 * Host half of the tarot bundle.
 *
 * Registers two model-facing tools:
 *   - `tarot_reading`  draws the cards for a question (standard shuffle → spread →
 *     upright/reversed) and returns each card's position, core meaning and keywords,
 *     so the model writes the reading itself instead of reciting a template.
 *   - `tarot_history`  lists, opens and annotates saved readings, so a draw from
 *     weeks ago can be revisited and compared with what actually happened.
 *
 * Readings persist as JSON under `$DSH_HOME/tarot/readings.json`.
 *
 * The deck data here mirrors `client.js` (the overlay renders its own copy in the
 * browser, which cannot import this module). Keep the card text in sync.
 */

import { promises as fsPromises } from 'node:fs';
import nodePath from 'node:path';
import nodeOs from 'node:os';

const SUITS = {
  wands: { zh: '权杖', en: 'Wands', element: '火', domain: '行动、热情与创造' },
  cups: { zh: '圣杯', en: 'Cups', element: '水', domain: '情感、关系与直觉' },
  swords: { zh: '宝剑', en: 'Swords', element: '风', domain: '思维、沟通与真相' },
  pentacles: { zh: '钱币', en: 'Pentacles', element: '土', domain: '现实、金钱与身体' }
};

const SUIT_KEYS = ['wands', 'cups', 'swords', 'pentacles'];

const MAJORS = [
  { id: 'fool', num: 0, roman: '0', zh: '愚者', en: 'The Fool', core: '一次不计后果的出发', up: ['新的开始', '纯粹的可能性', '信任直觉'], rev: ['鲁莽', '逃避承诺', '不敢迈步'] },
  { id: 'magician', num: 1, roman: 'I', zh: '魔术师', en: 'The Magician', core: '把想法变成现实的动手能力', up: ['意志', '资源整合', '表达'], rev: ['空谈', '操控', '自我怀疑'] },
  { id: 'highpriestess', num: 2, roman: 'II', zh: '女祭司', en: 'The High Priestess', core: '还没说出口、但你已经知道的事', up: ['直觉', '静观', '秘密'], rev: ['忽视直觉', '自我封闭', '信息不明'] },
  { id: 'empress', num: 3, roman: 'III', zh: '皇后', en: 'The Empress', core: '丰盛、滋养与允许自己享受', up: ['滋养', '创造', '感官'], rev: ['过度付出', '枯竭', '依赖'] },
  { id: 'emperor', num: 4, roman: 'IV', zh: '皇帝', en: 'The Emperor', core: '秩序、边界与承担责任', up: ['结构', '权威', '掌控'], rev: ['僵化', '控制欲', '逃避责任'] },
  { id: 'hierophant', num: 5, roman: 'V', zh: '教皇', en: 'The Hierophant', core: '传统、规则与可依靠的经验', up: ['教导', '规范', '归属'], rev: ['反叛', '教条', '形式主义'] },
  { id: 'lovers', num: 6, roman: 'VI', zh: '恋人', en: 'The Lovers', core: '一次关于价值观的真心选择', up: ['结合', '吸引', '抉择'], rev: ['犹豫', '失衡', '价值冲突'] },
  { id: 'chariot', num: 7, roman: 'VII', zh: '战车', en: 'The Chariot', core: '靠意志把对立的两股力量拉向同一方向', up: ['推进', '自律', '胜利'], rev: ['失控', '内耗', '方向不明'] },
  { id: 'strength', num: 8, roman: 'VIII', zh: '力量', en: 'Strength', core: '以温柔而非蛮力驯服本能', up: ['耐心', '勇气', '自我安抚'], rev: ['自我怀疑', '压抑', '失控'] },
  { id: 'hermit', num: 9, roman: 'IX', zh: '隐者', en: 'The Hermit', core: '暂时离场，独自把问题想清楚', up: ['独处', '内省', '求索'], rev: ['孤立', '逃避', '钻牛角尖'] },
  { id: 'wheel', num: 10, roman: 'X', zh: '命运之轮', en: 'Wheel of Fortune', core: '你无法控制、但正在转动的时机', up: ['转折', '周期', '运气'], rev: ['停滞', '重复旧模式', '抗拒变化'] },
  { id: 'justice', num: 11, roman: 'XI', zh: '正义', en: 'Justice', core: '因果、权衡与必须承担的后果', up: ['公平', '真相', '责任'], rev: ['偏颇', '逃避后果', '自欺'] },
  { id: 'hangedman', num: 12, roman: 'XII', zh: '倒吊人', en: 'The Hanged Man', core: '主动停下来，换一个角度看', up: ['暂停', '换位', '自愿付出'], rev: ['白等', '僵持', '无谓牺牲'] },
  { id: 'death', num: 13, roman: 'XIII', zh: '死神', en: 'Death', core: '一个阶段真正的结束', up: ['断舍离', '转化', '重生'], rev: ['拒绝结束', '拖延', '留恋'] },
  { id: 'temperance', num: 14, roman: 'XIV', zh: '节制', en: 'Temperance', core: '把两种极端调和成可持续的节奏', up: ['平衡', '耐心', '疗愈'], rev: ['失衡', '急躁', '过度'] },
  { id: 'devil', num: 15, roman: 'XV', zh: '恶魔', en: 'The Devil', core: '你明知有害却离不开的东西', up: ['欲望', '束缚', '执念'], rev: ['松绑', '看清', '戒断'] },
  { id: 'tower', num: 16, roman: 'XVI', zh: '塔', en: 'The Tower', core: '被现实强行拆掉的旧结构', up: ['突变', '揭露', '崩塌'], rev: ['延迟的崩塌', '勉强维持', '恐惧改变'] },
  { id: 'star', num: 17, roman: 'XVII', zh: '星星', en: 'The Star', core: '在废墟上重新长出的希望', up: ['希望', '疗愈', '指引'], rev: ['失望', '信心不足', '自我怀疑'] },
  { id: 'moon', num: 18, roman: 'XVIII', zh: '月亮', en: 'The Moon', core: '看不清全貌时的恐惧与想象', up: ['迷雾', '潜意识', '不安'], rev: ['迷雾散去', '释放恐惧', '真相浮现'] },
  { id: 'sun', num: 19, roman: 'XIX', zh: '太阳', en: 'The Sun', core: '被看见、被确认的清晰与喜悦', up: ['成功', '坦率', '生命力'], rev: ['暂时的阴霾', '过度乐观', '延迟的好消息'] },
  { id: 'judgement', num: 20, roman: 'XX', zh: '审判', en: 'Judgement', core: '一次必须回应的召唤与清算', up: ['觉醒', '复盘', '重生'], rev: ['自我批判', '回避召唤', '拖延决定'] },
  { id: 'world', num: 21, roman: 'XXI', zh: '世界', en: 'The World', core: '一个周期完整地走完', up: ['完成', '整合', '圆满'], rev: ['差最后一步', '不愿结束', '停滞'] }
];

/* [core, upright keywords, reversed keywords] — A..10, Page, Knight, Queen, King */
const MINOR_TEXT = {
  wands: [
    ['纯粹的灵感火种', '灵感、新机会、行动力', '热情受阻、延迟、方向不明'],
    ['站在门口规划下一步', '远见、选择、掌控全局', '害怕改变、计划落空、短视'],
    ['把眼光放到更远处', '扩张、等待回报、合作前景', '延迟、挫折、进展停滞'],
    ['值得庆祝的阶段性稳定', '庆祝、归家、里程碑', '不稳定、摩擦、庆祝延后'],
    ['各说各话的竞争与摩擦', '竞争、冲突、磨合', '回避冲突、内耗、压制异议'],
    ['被看见的胜利与认可', '胜利、认可、进步', '缺乏认可、骄傲、成果被忽视'],
    ['站在高处守住自己的位置', '坚守、防御、竞争压力', '疲惫、放弃、防线失守'],
    ['事情突然加速', '迅速、消息、行动', '延误、混乱、急躁'],
    ['带着伤还在坚持的最后一程', '韧性、坚持、接近终点', '偏执、耗竭、想放弃'],
    ['一个人扛下所有的重量', '重担、责任、硬撑', '卸下重担、无法放手、崩溃边缘'],
    ['好奇地试探', '探索、新点子、一条消息', '三分钟热度、坏消息、方向感差'],
    ['说走就走的冲动', '行动、冒险、远行', '鲁莽、暴躁、半途而废'],
    ['有魅力的自信与热度', '自信、魅力、温暖', '嫉妒、控制欲、消耗'],
    ['把热情变成愿景与事业', '愿景、领导、决断', '专横、冲动、好大喜功']
  ],
  cups: [
    ['情感之门的打开', '新的感情、直觉、疗愈', '情感阻塞、空虚、压抑'],
    ['两个人之间的对等与吸引', '结盟、吸引、和解', '失衡、分离、单方付出'],
    ['被朋友与喜悦围住的时刻', '友谊、庆祝、社群', '过度放纵、三角关系、孤立'],
    ['对眼前的一切提不起兴趣', '倦怠、错失机会、内省', '重燃兴趣、走出低谷、接受'],
    ['只盯着失去的那部分', '失落、遗憾、悲伤', '接受、宽恕、看见剩下的'],
    ['被回忆与旧人牵动', '怀旧、童年、旧友', '困于过去、幼稚、该放下'],
    ['选择太多反而看不清', '幻想、选项过多、迷惑', '看清现实、聚焦、幻灭'],
    ['主动离开不再滋养你的地方', '离开、追寻意义、放下', '害怕离开、徘徊、回头'],
    ['愿望达成的满足', '满足、愿望实现、享受', '不满足、虚荣、表面富足'],
    ['情感上的圆满与归属', '圆满、家庭、长久', '家庭失和、价值冲突、理想破灭'],
    ['情感上的初次试探', '情感消息、直觉初开、浪漫', '情绪化、逃避、不成熟'],
    ['追随心的浪漫与邀约', '浪漫、理想主义、邀约', '空想、善变、情感操控'],
    ['能接住别人情绪的温柔', '共情、温柔、成熟', '情绪淹没、过度牺牲、界限模糊'],
    ['稳得住的情感成熟', '稳定、包容、外交', '压抑、冷漠、情绪勒索']
  ],
  swords: [
    ['一刀切开迷雾的清醒', '清晰、真相、突破', '混乱、误判、想法偏执'],
    ['两边都不敢选的僵持', '僵局、回避、绷紧的平衡', '打破僵局、信息过载、被迫决定'],
    ['被真相刺中的痛', '心碎、背叛、分离', '疗愈开始、释放、仍在否认'],
    ['必须停下来休息的疲惫', '休息、恢复、暂停', '倦怠、被迫停摆、焦虑难眠'],
    ['赢了争论却输了关系', '冲突、胜利的代价、失和', '和解、放下争斗、转入地下'],
    ['正在离开一片浑水的过渡', '过渡、迁移、平静前行', '无法前进、旧问题复发、拖延'],
    ['有所保留的策略与隐瞒', '策略、隐瞒、自欺', '坦白、被揭穿、良心不安'],
    ['困住你的其实是你自己的想法', '受限、自我设限、无力', '解脱、换视角、自我赋能'],
    ['半夜放大的焦虑', '焦虑、失眠、过度担忧', '走出焦虑、求助、恐惧浮现'],
    ['彻底到底的结束', '终结、谷底、结束', '复原、最坏已过、抗拒结束'],
    ['好奇与求知', '求知、观察、一条消息', '搬弄是非、空谈、说话伤人'],
    ['直冲出去的言辞与行动', '直率、激进、快速出击', '鲁莽、言语攻击、无谋'],
    ['清醒、有边界、不糊弄', '清醒、独立、界限', '冷酷、苛刻、记恨'],
    ['以理性与原则做判断', '理智、原则、专业', '专断、滥用理性、教条']
  ],
  pentacles: [
    ['一颗可以种下的现实种子', '物质机会、财务起点、健康', '错失机会、财务不稳、空谈'],
    ['在几件事之间找平衡', '平衡、多任务、灵活', '失衡、分身乏术、财务混乱'],
    ['靠手艺与协作做出的初步成果', '协作、专业、初步成果', '团队失和、质量不佳、平庸'],
    ['抓得太紧的安全感', '保守、储蓄、占有', '放手、过度消费、贪婪失控'],
    ['匮乏与孤立中的一段路', '匮乏、孤立、低谷', '走出困境、接受帮助、恢复'],
    ['给予与接受之间的流动', '给予、公平、援助', '失衡的施与受、债务、条件'],
    ['投入之后的耐心等待', '耐心、长期投入、评估', '急躁、投入失利、徒劳'],
    ['日复一日的精进', '精进、学徒、专注', '完美主义、敷衍、缺乏进步'],
    ['靠自己挣来的独立与从容', '独立、自足、享受成果', '过度依赖、财务风险、虚荣'],
    ['长期积累下来的稳固', '富足、传承、长期稳定', '家庭财务纠纷、短视、根基动摇'],
    ['老老实实开始学', '学习、务实起步、专注', '拖延、眼高手低、不切实际'],
    ['一步一个脚印的可靠', '勤勉、稳健、可靠', '固执、停滞、过度保守'],
    ['把日子过好的务实与照顾', '务实、理财、照顾', '过度操心、物质焦虑、忽略自己'],
    ['稳得住盘子的经营能力', '物质成功、经营、可靠', '贪婪、固执、以钱衡量一切']
  ]
};

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const RANK_EN = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const COURTS = [
  { zh: '侍从', en: 'Page' },
  { zh: '骑士', en: 'Knight' },
  { zh: '皇后', en: 'Queen' },
  { zh: '国王', en: 'King' }
];

const CARDS = [];
MAJORS.forEach((card) => {
  CARDS.push({
    id: card.id,
    arcana: 'major',
    zh: card.zh,
    en: card.en,
    core: card.core,
    up: card.up,
    rev: card.rev
  });
});
SUIT_KEYS.forEach((suit) => {
  MINOR_TEXT[suit].forEach((row, index) => {
    const court = index >= 10 ? COURTS[index - 10] : null;
    CARDS.push({
      id: suit + '-' + (index + 1),
      arcana: 'minor',
      suit: suit,
      rank: index + 1,
      zh: SUITS[suit].zh + (court ? court.zh : CN_NUM[index]),
      en: (court ? court.en : RANK_EN[index]) + ' of ' + SUITS[suit].en,
      roman: court ? String(index + 11) : RANK_LABEL[index],
      core: row[0],
      up: row[1].split('、'),
      rev: row[2].split('、')
    });
  });
});

const SPREADS = {
  single: {
    name: '单张 · 指引',
    positions: [{ zh: '此刻的指引', hint: '把这张牌当作一个提醒，而不是结论。' }]
  },
  three: {
    name: '三张 · 时间流',
    positions: [
      { zh: '过去', hint: '它说明你是怎么走到今天的。' },
      { zh: '现在', hint: '这是此刻的真实处境，不是评价。' },
      { zh: '未来', hint: '照现在这样走，接下来比较可能遇到的质地。' }
    ]
  },
  cross5: {
    name: '五张 · 十字',
    positions: [
      { zh: '现状', hint: '这是此刻最核心的状态。' },
      { zh: '过去', hint: '它的根扎在这里。' },
      { zh: '未来', hint: '事情正在往这个方向走。' },
      { zh: '建议', hint: '牌给的动作建议。' },
      { zh: '走向', hint: '沿当前路径走下去，比较可能抵达的地方。' }
    ]
  },
  celtic: {
    name: '凯尔特十字',
    positions: [
      { zh: '现状', hint: '你此刻真正的处境与视角。' },
      { zh: '挑战', hint: '横压在现状上的那股阻力。' },
      { zh: '根源', hint: '事情从哪里来。' },
      { zh: '近期', hint: '接下来几步会遇到什么。' },
      { zh: '意识目标', hint: '你明面上想要的结果。' },
      { zh: '潜意识', hint: '真正在推着你走的东西。' },
      { zh: '建议', hint: '该用什么样的姿态应对。' },
      { zh: '外部', hint: '他人与环境带来的、你控制不了的部分。' },
      { zh: '希望与恐惧', hint: '往往是一体两面。' },
      { zh: '结果', hint: '沿当前路径走下去的终点。' }
    ]
  }
};

/* ---------- draw ---------- */

function rnd(size) {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % size;
    }
  } catch (error) {
    /* fall through */
  }
  return Math.floor(Math.random() * size);
}

function drawCards(count, allowReversed) {
  const pool = CARDS.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = rnd(i + 1);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, count).map((card) => ({
    card: card,
    reversed: allowReversed ? rnd(100) < 35 : false
  }));
}

/* ---------- display helpers (CJK-aware columns) ---------- */

function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    const wide = (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe4f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

function padCell(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function frame(entries) {
  const cells = entries.map((entry) => ({
    head: entry.position.zh,
    name: entry.card.zh,
    side: entry.reversed ? '逆位 ⟲' : '正位'
  }));
  const widths = cells.map((cell) => Math.max(
    8,
    displayWidth(cell.head),
    displayWidth(cell.name),
    displayWidth(cell.side)
  ) + 2);

  const border = (left, mid, right) => left + widths.map((w) => '─'.repeat(w)).join(mid) + right;
  const row = (pick) => '│' + cells.map((cell, i) => {
    const text = pick(cell);
    const gap = Math.max(0, widths[i] - displayWidth(text) - 2);
    const leftPad = Math.floor(gap / 2);
    const rightPad = gap - leftPad;
    return ' ' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + ' ';
  }).join('│') + '│';

  return [
    border('┌', '┬', '┐'),
    row((cell) => cell.head),
    border('├', '┼', '┤'),
    row((cell) => cell.name),
    row((cell) => cell.side),
    border('└', '┴', '┘')
  ].join('\n');
}

function listing(entries) {
  const lines = entries.map((entry, index) => {
    const side = entry.reversed ? '逆位 ⟲' : '正位';
    return String(index + 1).padStart(2, ' ')
      + '  ' + padCell(entry.position.zh, 11)
      + padCell(entry.card.zh, 12)
      + padCell(side, 7)
      + entry.card.core;
  });
  return lines.join('\n');
}

/* ---------- reading payload ---------- */

function buildReading(question, spreadKey, allowReversed) {
  const spread = SPREADS[spreadKey] || SPREADS.three;
  const key = SPREADS[spreadKey] ? spreadKey : 'three';
  const drawn = drawCards(spread.positions.length, allowReversed);

  const entries = drawn.map((item, index) => ({
    index: index,
    position: spread.positions[index],
    card: item.card,
    reversed: item.reversed
  }));

  const cards = entries.map((entry) => ({
    position: entry.position.zh,
    positionHint: entry.position.hint,
    name: entry.card.zh,
    nameEn: entry.card.en,
    arcana: entry.card.arcana,
    suit: entry.card.suit || '',
    orientation: entry.reversed ? 'reversed' : 'upright',
    core: entry.card.core,
    keywords: entry.reversed ? entry.card.rev : entry.card.up
  }));

  const suitCount = { wands: 0, cups: 0, swords: 0, pentacles: 0 };
  entries.forEach((entry) => {
    if (entry.card.suit) suitCount[entry.card.suit] += 1;
  });
  const majors = entries.filter((entry) => entry.card.arcana === 'major').length;
  const reversed = entries.filter((entry) => entry.reversed).length;
  const missing = SUIT_KEYS.filter((suit) => suitCount[suit] === 0);

  const parts = [];
  parts.push('大牌 ' + majors + '/' + entries.length);
  if (allowReversed) parts.push('逆位 ' + reversed);
  parts.push(SUIT_KEYS.map((suit) => SUITS[suit].zh + ' ' + suitCount[suit]).join(' · '));
  if (entries.length >= 4 && missing.length === 1) {
    parts.push('缺' + SUITS[missing[0]].zh);
  }

  const body = entries.length <= 5 ? frame(entries) : listing(entries);
  const text = [
    '【塔罗占卜 · ' + spread.name + ' · ' + entries.length + ' 张】',
    '问题：' + question,
    '',
    body,
    '',
    '结构：' + parts.join('｜')
  ].join('\n');

  return {
    question: question,
    spread: { key: key, name: spread.name, count: entries.length },
    allowReversed: !!allowReversed,
    cards: cards,
    structure: {
      majors: majors,
      reversed: reversed,
      suits: suitCount,
      missingSuits: missing,
      summary: parts.join('｜')
    },
    text: text
  };
}

/* ---------- reading history ---------- */

const DSH_HOME = process.env.DSH_HOME || nodePath.join(nodeOs.homedir(), '.dsh');
const DATA_DIR = nodePath.join(DSH_HOME, 'tarot');
const DATA_FILE = nodePath.join(DATA_DIR, 'readings.json');
const HISTORY_LIMIT = 200;
const LIST_DEFAULT = 10;

let state = null;
let loading = null;
let writeQueue = Promise.resolve();

async function loadState() {
  if (state) return state;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await fsPromises.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const readings = Array.isArray(parsed.readings) ? parsed.readings : [];
        state = {
          readings: readings,
          nextSeq: Number.isFinite(parsed.nextSeq) ? parsed.nextSeq : readings.length + 1
        };
      } catch (error) {
        try {
          await fsPromises.rename(DATA_FILE, DATA_FILE + '.corrupt');
        } catch (renameError) {
          /* no existing file — first run */
        }
        state = { readings: [], nextSeq: 1 };
      }
      return state;
    })();
  }
  return loading;
}

function enqueue(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => {}, () => {});
  return next;
}

async function persist(current) {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
  const temp = DATA_FILE + '.tmp';
  const body = JSON.stringify({
    version: 1,
    nextSeq: current.nextSeq,
    readings: current.readings
  });
  await fsPromises.writeFile(temp, body, 'utf8');
  await fsPromises.rename(temp, DATA_FILE);
}

function newId() {
  return 'tr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function localTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

async function recordReading(value, exec) {
  try {
    const current = await loadState();
    const record = {
      id: newId(),
      seq: 0,
      at: new Date().toISOString(),
      sessionId: exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '',
      question: value.question,
      spread: value.spread,
      cards: value.cards.map((card) => ({
        position: card.position,
        name: card.name,
        orientation: card.orientation,
        core: card.core
      })),
      structure: {
        majors: value.structure.majors,
        reversed: value.structure.reversed,
        summary: value.structure.summary
      },
      notes: []
    };

    return await enqueue(async () => {
      record.seq = current.nextSeq;
      current.nextSeq += 1;
      current.readings.unshift(record);
      if (current.readings.length > HISTORY_LIMIT) current.readings.length = HISTORY_LIMIT;
      await persist(current);
      return { id: record.id, seq: record.seq };
    });
  } catch (error) {
    return null;
  }
}

function entriesOf(record) {
  return (record.cards || []).map((card) => ({
    position: { zh: card.position },
    card: { zh: card.name, core: card.core },
    reversed: card.orientation === 'reversed'
  }));
}

function cardsBlock(record) {
  const entries = entriesOf(record);
  if (!entries.length) return '（牌面缺失）';
  return entries.length <= 5 ? frame(entries) : listing(entries);
}

function renderRecord(record) {
  const lines = [];
  lines.push('#' + record.seq + ' · ' + localTime(record.at) + ' · ' + record.spread.name + ' · ' + (record.cards || []).length + ' 张');
  lines.push('问题：' + record.question);
  lines.push('');
  lines.push(cardsBlock(record));
  lines.push('');
  lines.push('结构：' + (record.structure && record.structure.summary ? record.structure.summary : '—'));
  if (record.notes && record.notes.length) {
    lines.push('');
    lines.push('复盘：');
    record.notes.forEach((note) => lines.push('  - ' + localTime(note.at) + ' ' + note.text));
  }
  lines.push('');
  lines.push('id：' + record.id);
  return lines.join('\n');
}

function renderList(readings, total, query) {
  if (!readings.length) {
    return query
      ? '没有找到与「' + query + '」相关的占卜记录。'
      : '还没有占卜记录。在对话里抽牌之后会自动记入。';
  }
  const lines = ['共 ' + total + ' 次占卜' + (query ? '，其中 ' + readings.length + ' 条匹配「' + query + '」' : '') + '：'];
  readings.forEach((record) => {
    lines.push('');
    lines.push('#' + record.seq + ' · ' + localTime(record.at) + ' · ' + record.spread.name);
    lines.push('  「' + record.question + '」');
    lines.push('  ' + (record.cards || []).map((card) => card.name + (card.orientation === 'reversed' ? ' 逆' : ' 正')).join(' · '));
    if (record.notes && record.notes.length) {
      lines.push('  复盘：' + record.notes[record.notes.length - 1].text);
    }
  });
  lines.push('');
  lines.push('用 action:"get" + id 查看完整牌阵；用 action:"review" + id + note 给某次占卜补上后续。');
  return lines.join('\n');
}

function findRecord(current, id) {
  const key = String(id || '').trim();
  if (!key) return current.readings[0];
  return current.readings.filter((record) => record.id === key || String(record.seq) === key)[0];
}

/* ---------- tool ---------- */

const RESERVED_QUESTION = '此刻我最需要看清什么？';

const DESCRIPTION = [
  '进行一次标准塔罗占卜：按问题选定牌阵，洗牌并抽出牌面（含正逆位），返回每张牌的牌位、牌名、正逆位、核心含义与关键词。',
  '何时使用：用户明确要求塔罗占卜、抽牌、看牌阵，或说“帮我用塔罗看看……”时。普通咨询、情绪倾诉且没有要求占卜时不要调用。',
  '调用之后由你本人解牌：结合用户的具体问题，逐张说明这张牌在它所在位置上意味着什么；指出大牌比例、逆位、花色集中等结构信号；最后给出 1–3 条现实中可执行的动作。不要原样复述牌面清单，也不要编造没有抽到的牌。',
  '牌阵：single（1 张，日常指引）、three（3 张，过去-现在-未来，默认）、cross5（5 张，现状-过去-未来-建议-走向）、celtic（10 张，凯尔特十字，适合复杂处境）。',
  '边界：不做医疗、法律、投资预测，不预测死亡或疾病；遇到这类问题，说明牌只呈现心理与趋势，并建议寻求专业意见。'
].join('\n');

const TOOL = {
  name: 'tarot_reading',
  description: DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '用户的原问题，尽量保留原话（例如“这段关系里我最需要看清什么？”）。不要替用户改写成一个结论式问题。'
      },
      spread: {
        type: 'string',
        enum: ['single', 'three', 'cross5', 'celtic'],
        description: '牌阵。默认 three。问题复杂、涉及多方或长期处境时用 celtic；想要一句提醒时用 single。'
      },
      allowReversed: {
        type: 'boolean',
        description: '是否启用逆位，默认 true。用户明确说“不看逆位”时传 false。'
      }
    },
    required: ['question'],
    additionalProperties: false
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: { type: 'string' },
        spread: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            count: { type: 'integer' }
          },
          required: ['key', 'name', 'count']
        },
        allowReversed: { type: 'boolean' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              position: { type: 'string' },
              positionHint: { type: 'string' },
              name: { type: 'string' },
              nameEn: { type: 'string' },
              arcana: { type: 'string' },
              suit: { type: 'string' },
              orientation: { type: 'string' },
              core: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } }
            },
            required: ['position', 'name', 'orientation', 'core', 'keywords']
          }
        },
        structure: {
          type: 'object',
          additionalProperties: false,
          properties: {
            majors: { type: 'integer' },
            reversed: { type: 'integer' },
            suits: {
              type: 'object',
              additionalProperties: false,
              properties: {
                wands: { type: 'integer' },
                cups: { type: 'integer' },
                swords: { type: 'integer' },
                pentacles: { type: 'integer' }
              },
              required: ['wands', 'cups', 'swords', 'pentacles']
            },
            missingSuits: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' }
          },
          required: ['majors', 'reversed', 'suits', 'missingSuits', 'summary']
        },
        history: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            seq: { type: 'integer' },
            saved: { type: 'boolean' }
          },
          required: ['id', 'seq', 'saved']
        },
        text: { type: 'string' }
      },
      required: ['question', 'spread', 'cards', 'structure', 'text']
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }];
    },
    presentationMeta(_args, value) {
      return {
        v: 1,
        question: value.question,
        spread: value.spread.name,
        count: value.spread.count,
        seq: value.history ? value.history.seq : 0,
        id: value.history ? value.history.id : '',
        structure: value.structure ? value.structure.summary : '',
        cards: value.cards.map((card) => ({
          p: card.position,
          n: card.name,
          r: card.orientation === 'reversed',
          c: card.core
        }))
      };
    }
  },
  presentCall(args) {
    const question = args && typeof args.question === 'string' ? args.question.trim() : '';
    const spread = args && SPREADS[args.spread] ? SPREADS[args.spread].name : SPREADS.three.name;
    return {
      card: 'generic',
      title: '塔罗占卜 · ' + spread + (question ? ' · ' + question.slice(0, 40) : ''),
      kind: 'other',
      rawInput: args
    };
  },
  async execute(args, exec) {
    const raw = args && typeof args.question === 'string' ? args.question.trim() : '';
    const question = (raw || RESERVED_QUESTION).slice(0, 300);
    const spreadKey = args && typeof args.spread === 'string' && SPREADS[args.spread] ? args.spread : 'three';
    const allowReversed = !(args && args.allowReversed === false);
    const value = buildReading(question, spreadKey, allowReversed);

    const saved = await recordReading(value, exec);
    if (saved) {
      value.history = { id: saved.id, seq: saved.seq, saved: true };
      value.text = value.text + '\n记录：#' + saved.seq + ' · ' + saved.id;
    } else {
      value.history = { id: '', seq: 0, saved: false };
    }
    return value;
  }
};

const HISTORY_DESCRIPTION = [
  '读取、查看和补记塔罗占卜的历史记录（跨会话保存在本地）。',
  '何时使用：用户提到“上次的占卜”“之前抽到的牌”“我什么时候问过……”时，先 list 或 get 再回答；用户说“后来怎样了”“复盘一下”并给出结果时，用 review 把那次的后续记下来；用户想比较不同时间的两次占卜时，list 出相关记录再对照。',
  '不要凭空编造历史：没有调用本工具就声称“你上次抽到……”是不可接受的。记录为空时如实说明还没有记录。',
  'action：list 按时间倒序列出占卜（query 可过滤问题或牌名，limit 默认 10）；get 取一次占卜的完整牌阵与复盘（id 省略时返回最近一次）；review 给某次占卜追加“后来发生了什么”（id 省略时作用于最近一次，note 必填）。'
].join('\n');

const HISTORY_TOOL = {
  name: 'tarot_history',
  description: HISTORY_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'review'],
        description: 'list 列历史 / get 看一次完整牌阵 / review 补记后续。'
      },
      id: {
        type: 'string',
        description: '记录 id（形如 tr-xxxx-xxxx），也接受序号 #3 里的 3。省略时 get 与 review 作用于最近一次占卜。'
      },
      query: {
        type: 'string',
        description: 'list 时的过滤词：匹配问题文字或牌名（例如“工作”“宝剑五”）。'
      },
      limit: {
        type: 'integer',
        description: 'list 返回条数，默认 10，最大 50。'
      },
      note: {
        type: 'string',
        description: 'review 必填：这次占卜之后实际发生了什么、应验了哪些、哪里没中。控制在 200 字以内。'
      }
    },
    required: ['action'],
    additionalProperties: false
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string' },
        count: { type: 'integer' },
        text: { type: 'string' }
      },
      required: ['action', 'count', 'text']
    },
    render(_args, value) {
      return [{ type: 'text', text: value.text }];
    }
  },
  presentCall(args) {
    const action = args && typeof args.action === 'string' ? args.action : 'list';
    const label = action === 'review' ? '记录塔罗复盘' : action === 'get' ? '查看塔罗记录' : '塔罗占卜历史';
    return { card: 'generic', title: label, kind: 'other', rawInput: args };
  },
  async execute(args) {
    const action = args && typeof args.action === 'string' ? args.action : 'list';
    try {
      const current = await loadState();

      if (action === 'review') {
        const note = String(args.note || '').trim();
        if (!note) {
          return { action: action, count: 0, text: 'review 需要 note：请写下这次占卜之后实际发生了什么。' };
        }
        const target = findRecord(current, args.id);
        if (!target) {
          return { action: action, count: 0, text: '没有找到对应的记录。先用 action:"list" 看一下有哪些占卜。' };
        }
        target.notes = Array.isArray(target.notes) ? target.notes : [];
        target.notes.push({ at: new Date().toISOString(), text: note.slice(0, 500) });
        await enqueue(async () => {
          await persist(current);
          return true;
        });
        return { action: action, count: target.notes.length, text: '已记下这次复盘。\n\n' + renderRecord(target) };
      }

      if (action === 'get') {
        const target = findRecord(current, args.id);
        if (!target) {
          return {
            action: action,
            count: 0,
            text: current.readings.length ? '没有找到这个 id 的记录，可以先用 action:"list" 看看。' : '还没有任何占卜记录。'
          };
        }
        return { action: action, count: 1, text: renderRecord(target) };
      }

      const query = String(args.query || '').trim();
      const requested = Number(args.limit);
      const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(50, Math.floor(requested))
        : LIST_DEFAULT;
      let readings = current.readings;
      if (query) {
        readings = readings.filter((record) => (record.question || '').indexOf(query) >= 0
          || (record.cards || []).some((card) => (card.name || '').indexOf(query) >= 0));
      }
      const page = readings.slice(0, limit);
      return { action: action, count: page.length, text: renderList(page, readings.length, query) };
    } catch (error) {
      return { action: action, count: 0, text: '读取占卜历史失败：' + errorText(error) };
    }
  }
};

export const name = 'tarot-divination';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(TOOL));
  ctx.effect(() => ctx.tools.register(HISTORY_TOOL));
}
