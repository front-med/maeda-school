/* ===========================================================
   前田学校 — 共通処理
   -----------------------------------------------------------
   3ページ（正門・職員室・教室）から使う土台。
   ・データの読み込みと索引づくり（検索用の文字列は起動時に1回だけ作る）
   ・日付／秒数の整形
   ・先生カラーから、明暗どちらでも読める色を計算して要素に配る
   ・テーマ（自動／ライト／ダーク）の保存と切替
   ・カードの組み立て（DOM生成。innerHTMLに外部文字列を混ぜない）

   ES Modules を使わないのは file:// でブロックされるため。
   window.School に生やす素のスクリプト。
   =========================================================== */
(function (global, doc) {
  'use strict';

  /* --------------------------------------------------
     1. データ
     -------------------------------------------------- */
  var TEACHERS = Array.isArray(global.SCHOOL_TEACHERS) ? global.SCHOOL_TEACHERS : [];
  var LECTURES = Array.isArray(global.SCHOOL_LECTURES) ? global.SCHOOL_LECTURES : [];

  // teacherId が名簿に無い講義が来ても落ちないための代理職員
  var SUBSTITUTE = {
    id: null, name: '担当未設定', kana: '', subject: 'その他', room: '—',
    color: '#7b8593', emoji: '📄', tags: [], catchphrase: '', profile: '',
    joined: '', founding: true
  };

  // プロトタイプ由来のキー（"constructor" など）を拾わないよう素の辞書にする
  var teacherById = Object.create(null);
  var i;
  for (i = 0; i < TEACHERS.length; i++) teacherById[TEACHERS[i].id] = TEACHERS[i];

  function teacherOf(lec) {
    return (lec && teacherById[lec.teacherId]) || SUBSTITUTE;
  }

  /* --------------------------------------------------
     2. 日付・時間
     -------------------------------------------------- */
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function two(n) { return n < 10 ? '0' + n : String(n); }

  // "2026-08-16" -> Date（ローカル時刻で作る。UTC解釈による1日ズレを避ける）
  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  // 2026年8月16日（土）
  function fmtLong(iso) {
    var d = parseISO(iso);
    if (!d) return String(iso || '');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）';
  }

  // 08/16
  function fmtMD(iso) {
    var d = parseISO(iso);
    if (!d) return String(iso || '');
    return two(d.getMonth() + 1) + '/' + two(d.getDate());
  }

  // 754 -> "12:34" / 3725 -> "1:02:05"
  function mmss(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return h > 0 ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
  }

  /* --------------------------------------------------
     3. 色 — 先生カラーを明暗どちらでも読める値に展開する
     -------------------------------------------------- */
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '7b8593';
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }

  function hsl(h, s, l) {
    return 'hsl(' + Math.round(h) + ', ' + Math.round(clamp(s, 0, 100)) + '%, ' + Math.round(clamp(l, 0, 100)) + '%)';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // hsl -> 相対輝度（白文字か黒文字かの判定用）
  function hslLuminance(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function ch(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var c = [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map(function (v) {
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /* 先生カラーは10色あり、そのままでは地に対して読めないものが混ざる
     （緑・金・青緑は明度を下げないとライト面で 4.5:1 に届かない）。
     色相と彩度は残したまま、明度だけを動かして必要なコントラストを取る。
     こうしておけば、新任教師がどんな色を持ってきても破綻しない。 */
  var MIN_RATIO = 4.6;    // AA は 4.5。丸めで目減りする分の余白を足してある
  var PAPER_LUM = 0.898;  // #f3f5f8
  var SURF_D_LUM = 0.0105;// #141920
  var INK_LUM  = 0.0086;  // #11151b

  function ratio(a, b) {
    return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);
  }

  // 明度を下げながら、地に対して min を満たす最初の値を返す（色味は保つ）
  function darkenUntil(h, s, from, bgLum, min) {
    for (var l = Math.min(from, 62); l >= 0; l--) {
      if (ratio(hslLuminance(h, s, l), bgLum) >= min) return l;
    }
    return 0;
  }

  // 明度を上げながら同じことをする
  function lightenUntil(h, s, from, bgLum, min) {
    for (var l = Math.max(from, 44); l <= 100; l++) {
      if (ratio(hslLuminance(h, s, l), bgLum) >= min) return l;
    }
    return 100;
  }

  var INK_RGB = [17, 21, 27];
  var WHITE_RGB = [255, 255, 255];

  function hslToRgb255(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function ch(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
  }

  function lumRGB(c) {
    var v = [0, 1, 2].map(function (k) {
      var x = c[k] / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  /* 「今日の一手」は色を面で使う唯一の場所。
     地色と、その上に乗る2種類の文字色を一緒に解く。
       on  … 本文。地に対して 7:1
       on2 … ラベルと署名。地に向けて混ぜて弱めるが 4.5:1 は割らない
     opacity で弱めると色ごとに実効コントラストが変わって AA を割るので、
     混色済みの色を直接持たせる。 */
  function solveFill(h, s, l) {
    // 本文は 5.0 まで。7:1 まで欲張ると地色が淡くなりすぎて、
    // 「ここだけ色を面で使う」という設計の押しが消える。
    // 4.6 は AA(4.5) にわずかな余白を足した値（rgb を整数に丸めた分の目減り対策）。
    var FILL_TARGET = 5.0, SUB_TARGET = 4.6;
    var best = null;

    [[INK_RGB, '#11151b'], [WHITE_RGB, '#ffffff']].forEach(function (opt) {
      var fonLum = lumRGB(opt[0]);
      for (var d = 0; d <= 70; d++) {
        var cands = d === 0 ? [l] : [l - d, l + d];   // 元の明度に近い順に外へ広げる
        for (var i = 0; i < cands.length; i++) {
          var L = cands[i];
          if (L < 0 || L > 100) continue;
          var fl = lumRGB(hslToRgb255(h, s, L));
          if (ratio(fl, fonLum) >= FILL_TARGET) {
            if (!best || d < best.d) best = { d: d, l: L, on: opt[1], fon: opt[0], fillLum: fl };
            return;
          }
        }
      }
    });
    if (!best) best = { l: clamp(l, 38, 58), on: '#ffffff', fon: WHITE_RGB, fillLum: hslLuminance(h, s, clamp(l, 38, 58)) };

    // 控えめな文字色。混色は必ず「丸めたあとの値」で判定する
    // （rgb() は整数に丸まるので、丸める前で測ると実際より甘く出る）。
    // どこまで混ぜても届かないときは本文と同じ色に落とす（弱めないだけで害はない）。
    var fillRGB = hslToRgb255(h, s, best.l);
    var on2 = best.on;
    for (var a = 60; a <= 100; a += 2) {
      var mix = [0, 1, 2].map(function (k) {
        return Math.round(best.fon[k] * (a / 100) + fillRGB[k] * (1 - a / 100));
      });
      if (ratio(lumRGB(mix), best.fillLum) >= SUB_TARGET) {
        on2 = 'rgb(' + mix.join(', ') + ')';
        break;
      }
    }
    return { l: best.l, on: best.on, on2: on2 };
  }

  var tintCache = Object.create(null);

  function tintOf(hex) {
    if (tintCache[hex]) return tintCache[hex];
    var rgb = hexToRgb(hex);
    var a = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = a[0], s = a[1], l = a[2];

    var sLight = Math.min(s + 8, 92);
    var sDark  = Math.min(s, 82);
    var fill = solveFill(h, s, l);

    // 淡い色チップの実際の明るさを基準にする。色相によって同じ明度でも
    // 見た目の明るさが違う（紫は暗く、黄は明るい）ため、決め打ちだと足りない。
    var sSoftL = Math.min(s, 70), sSoftD = Math.min(s, 48);
    var softLightLum = hslLuminance(h, sSoftL, 94);
    var softDarkLum  = hslLuminance(h, sSoftD, 17);

    // 文字が乗りうる面のうち、ライトは最も暗い方／ダークは最も明るい方に合わせる
    var bgLight = Math.min(softLightLum, PAPER_LUM);
    var bgDark  = Math.max(softDarkLum, SURF_D_LUM);

    var t = {
      tc:   hex,                                                        // 背表紙・時刻の点（原色のまま）
      tt:   hsl(h, sLight, darkenUntil(h, sLight, l, bgLight, MIN_RATIO)),  // ライト時の文字
      ttd:  hsl(h, sDark, lightenUntil(h, sDark, l, bgDark, MIN_RATIO)),    // ダーク時の文字
      ts:   hsl(h, sSoftL, 94),                                         // ライト時の淡い面
      tsd:  hsl(h, sSoftD, 17),                                         // ダーク時の淡い面
      tm:   hsl(h, Math.min(s, 60), 79),                                // ライト時の罫線
      tmd:  hsl(h, Math.min(s, 45), 33),                                // ダーク時の罫線
      tf:   hsl(h, s, fill.l),                                          // 今日の一手の地色
      tfon: fill.on,                                                    // その上の本文
      tfon2: fill.on2                                                   // その上のラベル・署名
    };
    tintCache[hex] = t;
    return t;
  }

  // 要素に先生カラーを配る
  function applyTint(el, hex) {
    if (!el) return;
    var t = tintOf(hex || SUBSTITUTE.color);
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) {
      el.style.setProperty('--' + k, t[k]);
    }
    el.classList.add('tint');
  }

  /* --------------------------------------------------
     4. 索引 — 起動時に1回だけ組む
     -------------------------------------------------- */
  var views = [];              // 表示・検索に必要なものを前計算した配列（新しい順＝元配列の順）
  var byId = Object.create(null);

  function buildViews() {
    var order = {};
    for (var n = 0; n < LECTURES.length; n++) {
      var lec = LECTURES[n] || {};
      var t = teacherOf(lec);
      var vid = lec.video || {};
      var board = Array.isArray(lec.board) ? lec.board : [];
      var terms = Array.isArray(lec.terms) ? lec.terms : [];
      var tags = Array.isArray(lec.tags) ? lec.tags : [];

      // 何限目か。ID末尾の連番（2026-08-16-03 → 3限）を正とし、
      // 形式が違うときだけ同日内の並びから数える。
      var m = /^\d{4}-\d{2}-\d{2}-(\d+)$/.exec(String(lec.id || ''));
      var period;
      if (m) {
        period = String(parseInt(m[1], 10));
      } else {
        order[lec.date] = (order[lec.date] || 0) + 1;
        period = String(order[lec.date]);
      }

      // 検索対象：タイトル・要約・タグ・板書本文（＋先生名と教科）
      var hay = [
        lec.title, lec.summary, tags.join(' '),
        t.name, t.kana, t.subject, lec.action, vid.title, vid.channel
      ];
      var b, p;
      for (b = 0; b < board.length; b++) {
        hay.push(board[b] && board[b].heading);
        var pts = (board[b] && board[b].points) || [];
        for (p = 0; p < pts.length; p++) hay.push(pts[p]);
      }
      for (b = 0; b < terms.length; b++) {
        hay.push(terms[b] && terms[b].term, terms[b] && terms[b].definition);
      }

      var v = {
        lec: lec, teacher: t, video: vid, board: board, terms: terms, tags: tags,
        index: n,
        period: period,
        dateMD: fmtMD(lec.date),
        dateLong: fmtLong(lec.date),
        hay: hay.join(' ').toLowerCase()
      };
      views.push(v);
      if (lec.id) byId[lec.id] = v;
    }
  }
  buildViews();

  /* --------------------------------------------------
     5. 検索・集計
     -------------------------------------------------- */
  function search(list, opt) {
    opt = opt || {};
    var q = String(opt.q || '').trim().toLowerCase();
    var teacher = opt.teacher || '';
    var tag = opt.tag || '';
    var out = [];
    for (var n = 0; n < list.length; n++) {
      var v = list[n];
      if (teacher && v.lec.teacherId !== teacher) continue;
      if (tag && v.tags.indexOf(tag) < 0) continue;
      if (q && v.hay.indexOf(q) < 0) continue;
      out.push(v);
    }
    return out;
  }

  function countByTeacher() {
    var c = {};
    for (var n = 0; n < views.length; n++) {
      var id = views[n].lec.teacherId;
      c[id] = (c[id] || 0) + 1;
    }
    return c;
  }

  function tagRanking(limit) {
    var c = {}, k;
    for (var n = 0; n < views.length; n++) {
      var tg = views[n].tags;
      for (var i2 = 0; i2 < tg.length; i2++) c[tg[i2]] = (c[tg[i2]] || 0) + 1;
    }
    var arr = [];
    for (k in c) if (Object.prototype.hasOwnProperty.call(c, k)) arr.push({ tag: k, n: c[k] });
    arr.sort(function (a, b) { return b.n - a.n || a.tag.localeCompare(b.tag, 'ja'); });
    return limit ? arr.slice(0, limit) : arr;
  }

  function stats() {
    var ym = todayISO().slice(0, 7);
    var thisMonth = 0;
    for (var n = 0; n < views.length; n++) {
      if (String(views[n].lec.date || '').slice(0, 7) === ym) thisMonth++;
    }
    return {
      lectures: views.length,
      teachers: TEACHERS.length,
      thisMonth: thisMonth,
      last: views.length ? views[0].lec.date : null
    };
  }

  /* --------------------------------------------------
     6. YouTube
     -------------------------------------------------- */
  function thumbUrl(videoId) {
    return videoId ? 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg' : null;
  }

  // 元動画の該当時刻へ。url も at も揃っているときだけ返す
  function seekUrl(url, sec) {
    if (!url || sec === null || sec === undefined || isNaN(Number(sec))) return null;
    return url + (String(url).indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.max(0, Math.floor(sec)) + 's';
  }

  /* --------------------------------------------------
     7. DOM ヘルパ
     -------------------------------------------------- */
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; }
  }

  // file:// では history API が使えないブラウザがあるので握りつぶす
  function syncUrl(params) {
    try {
      var parts = [];
      for (var k in params) if (params[k]) parts.push(k + '=' + encodeURIComponent(params[k]));
      global.history.replaceState(null, '', parts.length ? '?' + parts.join('&') : global.location.pathname);
    } catch (e) { /* file:// では無視 */ }
  }

  /* --------------------------------------------------
     8. 部品
     -------------------------------------------------- */
  // 先生チップ（絵文字＋名前）
  function teacherChip(t) {
    var c = el('span', 'tchip');
    c.appendChild(el('em', null, t.emoji || '📄'));
    c.appendChild(el('span', null, t.name));
    return c;
  }

  // 「08/16 3限」
  function periodTag(v) {
    var p = el('span', 'period');
    p.appendChild(doc.createTextNode(v.dateMD + ' '));
    p.appendChild(el('b', null, v.period));
    p.appendChild(doc.createTextNode('限'));
    return p;
  }

  // サムネイル。video.id が無い／読めないときは先生の色＋絵文字で埋める
  function thumbBox(v, cls) {
    var box = el('span', 'thumb' + (cls ? ' ' + cls : ''));
    var ph = el('span', 'thumb__ph', v.teacher.emoji || '📄');
    box.appendChild(ph);

    var url = thumbUrl(v.video && v.video.id);
    if (url) {
      var img = doc.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      img.src = url;
      box.appendChild(img);
    }

    var dur = v.video && v.video.duration;
    if (dur && dur !== '—' && dur !== '-') box.appendChild(el('span', 'thumb__dur', dur));
    return box;
  }

  // 一覧用の講義カード
  function lectureCard(v) {
    var a = doc.createElement('a');
    a.className = 'lec';
    a.href = '教室.html?id=' + encodeURIComponent(v.lec.id);
    applyTint(a, v.teacher.color);

    a.appendChild(el('span', 'lec__spine'));

    var body = el('span', 'lec__body');
    var eye = el('span', 'lec__eyebrow');
    eye.appendChild(teacherChip(v.teacher));
    eye.appendChild(periodTag(v));
    // 極端に狭い画面でサムネが落ちたとき、尺だけこちらに出す（CSS側で表示切替）
    var d = v.video && v.video.duration;
    if (d && d !== '—' && d !== '-') eye.appendChild(el('span', 'period lec__dur', d));
    if (v.lec.demo) eye.appendChild(el('span', 'badge-demo', 'サンプル'));
    body.appendChild(eye);

    body.appendChild(el('span', 'lec__title', v.lec.title || '（無題の講義）'));
    if (v.lec.summary) body.appendChild(el('span', 'lec__summary', v.lec.summary));

    if (v.tags.length) {
      var tg = el('span', 'lec__tags');
      for (var i3 = 0; i3 < Math.min(v.tags.length, 4); i3++) {
        tg.appendChild(el('span', null, '#' + v.tags[i3]));
      }
      body.appendChild(tg);
    }
    a.appendChild(body);
    a.appendChild(thumbBox(v, 'lec__thumb'));
    return a;
  }

  /* --------------------------------------------------
     9. テーマ（自動 / ライト / ダーク）
     -------------------------------------------------- */
  var KEY = 'maeda-school-theme';
  var MODES = ['auto', 'light', 'dark'];
  var FACE = { auto: '◐', light: '☀', dark: '☾' };
  var LABEL = { auto: '端末に合わせる', light: 'ライト', dark: 'ダーク' };

  function readTheme() {
    try { var v = global.localStorage.getItem(KEY); return MODES.indexOf(v) >= 0 ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }

  function writeTheme(v) {
    try { global.localStorage.setItem(KEY, v); } catch (e) { /* プライベートモード等 */ }
  }

  function applyTheme(v) {
    var root = doc.documentElement;
    if (v === 'auto') { root.removeAttribute('data-theme'); root.style.colorScheme = ''; }
    else { root.setAttribute('data-theme', v); root.style.colorScheme = v; }
  }

  function mountTheme(btn) {
    if (!btn) return;
    var cur = readTheme();
    function paint() {
      btn.textContent = FACE[cur];
      btn.setAttribute('title', 'テーマ: ' + LABEL[cur] + '（クリックで切替）');
      btn.setAttribute('aria-label', 'テーマ: ' + LABEL[cur] + '。クリックで切替');
    }
    applyTheme(cur); paint();
    btn.addEventListener('click', function () {
      cur = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
      writeTheme(cur); applyTheme(cur); paint();
    });
  }

  /* --------------------------------------------------
     10. 公開
     -------------------------------------------------- */
  global.School = {
    teachers: TEACHERS,
    lectures: LECTURES,
    views: views,
    byId: byId,
    substitute: SUBSTITUTE,

    teacherOf: teacherOf,
    teacherById: function (id) { return teacherById[id] || SUBSTITUTE; },

    todayISO: todayISO,
    fmtLong: fmtLong,
    fmtMD: fmtMD,
    mmss: mmss,

    tintOf: tintOf,
    applyTint: applyTint,

    search: search,
    countByTeacher: countByTeacher,
    tagRanking: tagRanking,
    stats: stats,

    thumbUrl: thumbUrl,
    seekUrl: seekUrl,

    el: el,
    qs: qs,
    syncUrl: syncUrl,
    teacherChip: teacherChip,
    periodTag: periodTag,
    thumbBox: thumbBox,
    lectureCard: lectureCard,

    mountTheme: mountTheme
  };
})(window, document);
