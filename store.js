'use strict';

/**
 * データ層。保存先はここだけに閉じ込める。
 * Supabase へ移す場合、差し替えるのはこのファイルだけで済む。
 * データの形は sotsugyo.md 5章・8.3 に対応。
 */
var Store = (function () {
  var STORAGE_KEY = 'kyoshitsu-schedule-v1';
  var DEFAULT_MINUTES = 90; // 終了時間の自動入力に使う既定の長さ

  // --- 日付と時刻の道具（すべてゼロ埋め文字列で扱う） ---

  function formatDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function today() {
    return formatDate(new Date());
  }

  function shiftDays(dateString, days) {
    var parts = dateString.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }

  /** "HH:MM" に分を足す。24時を超えたら "23:59" で止める */
  function addMinutes(timeString, minutes) {
    var parts = timeString.split(':');
    var total = Number(parts[0]) * 60 + Number(parts[1]) + minutes;
    if (total > 23 * 60 + 59) total = 23 * 60 + 59;
    var h = Math.floor(total / 60);
    var m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function nowStamp() {
    var d = new Date();
    return formatDate(d) + 'T' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // --- 保存と読み込み ---

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('保存データを読めませんでした。初期データに戻します。', e);
      return null;
    }
  }

  // --- 動作確認用のサンプルデータ ---
  // 実装が進んだら削除する。日付は起動日を基準に作る。

  function buildSampleData() {
    var rooms = [
      { id: 'room-a', name: 'A教室', sort_order: 1, is_active: true },
      { id: 'room-b', name: 'B教室', sort_order: 2, is_active: true }
    ];
    var instructors = [
      { id: 'inst-1', name: '山田太郎', sort_order: 1, is_active: true },
      { id: 'inst-2', name: '佐藤花子', sort_order: 2, is_active: true }
    ];

    var now = nowStamp();
    function schedule(dayOffset, start, end, roomId, instructorId, status, note) {
      return {
        id: newId(),
        date: shiftDays(today(), dayOffset),
        start_time: start,
        end_time: end,
        room_id: roomId,
        instructor_id: instructorId,
        status: status,
        note: note,
        deleted_at: null,
        created_at: now,
        updated_at: now
      };
    }

    var schedules = [
      // 同じ日に2件。開始時間の順に並ぶことの確認用（入力順はわざと逆）
      schedule(0, '13:00', '14:30', 'room-b', 'inst-2', 'scheduled', ''),
      schedule(0, '10:00', '11:30', 'room-a', 'inst-1', 'scheduled', ''),
      schedule(1, '10:00', '11:30', 'room-a', 'inst-1', 'scheduled', '振替分'),
      // 休講。消さずに残ることの確認用
      schedule(2, '15:00', '16:30', 'room-b', 'inst-2', 'canceled', ''),
      schedule(5, '10:00', '11:30', 'room-a', 'inst-2', 'scheduled', ''),
      // 過去の予定。既定の表示（今日以降）に出ないことの確認用
      schedule(-3, '10:00', '11:30', 'room-a', 'inst-1', 'scheduled', '')
    ];

    // 削除済みの1件。一覧に出ないことの確認用
    var removed = schedule(1, '16:00', '17:00', 'room-b', 'inst-1', 'scheduled', '');
    removed.deleted_at = now;
    schedules.push(removed);

    return { version: 1, rooms: rooms, instructors: instructors, schedules: schedules };
  }

  function init() {
    var data = load();
    if (!data) {
      data = buildSampleData();
      save(data);
    }
    return data;
  }

  // --- マスタの取得 ---

  function activeSorted(list) {
    return list
      .filter(function (x) { return x.is_active; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; });
  }

  function listRooms() { return activeSorted(init().rooms); }
  function listInstructors() { return activeSorted(init().instructors); }

  // --- 予定の取得 ---

  function decorate(data, s) {
    var room = null;
    var instructor = null;
    data.rooms.forEach(function (r) { if (r.id === s.room_id) room = r; });
    data.instructors.forEach(function (i) { if (i.id === s.instructor_id) instructor = i; });
    return {
      id: s.id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      room_id: s.room_id,
      instructor_id: s.instructor_id,
      room_name: room ? room.name : '(不明な教室)',
      instructor_name: instructor ? instructor.name : '(不明な講師)',
      status: s.status,
      note: s.note
    };
  }

  /**
   * 予定を取り出す。
   * 削除済み（deleted_at あり）は除外し、日付→開始時間の昇順で返す。
   * @param {{from?: string, to?: string}} range 省略時は全期間
   */
  function listSchedules(range) {
    var data = init();
    var from = range && range.from ? range.from : null;
    var to = range && range.to ? range.to : null;

    return data.schedules
      .filter(function (s) {
        if (s.deleted_at) return false;
        if (from && s.date < from) return false;
        if (to && s.date > to) return false;
        return true;
      })
      .map(function (s) { return decorate(data, s); })
      .sort(function (a, b) {
        // 日付も時刻もゼロ埋め文字列なので、連結した辞書順が時系列順になる
        var keyA = a.date + ' ' + a.start_time;
        var keyB = b.date + ' ' + b.start_time;
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      });
  }

  function getSchedule(id) {
    var data = init();
    var found = null;
    data.schedules.forEach(function (s) { if (s.id === id) found = s; });
    return found ? decorate(data, found) : null;
  }

  /** 削除済みを除いた全件数。「まだ1件も無い」の判定に使う */
  function countAll() {
    return init().schedules.filter(function (s) { return !s.deleted_at; }).length;
  }

  // --- 検証（sotsugyo.md 5.4） ---

  /**
   * 保存を止めるべき違反を返す。
   * @returns {Array<{field: string, message: string}>} 空配列なら問題なし
   */
  function validate(input) {
    var errors = [];
    if (!trim(input.date)) {
      errors.push({ field: 'date', message: '日付を入力してください。' });
    }
    if (!trim(input.start_time)) {
      errors.push({ field: 'start_time', message: '開始時間を入力してください。' });
    }
    if (!trim(input.end_time)) {
      errors.push({ field: 'end_time', message: '終了時間を入力してください。' });
    }
    if (!trim(input.room_id)) {
      errors.push({ field: 'room_id', message: '教室を選んでください。' });
    }
    if (!trim(input.instructor_id)) {
      errors.push({ field: 'instructor_id', message: '講師を選んでください。' });
    }
    if (trim(input.start_time) && trim(input.end_time) && input.end_time <= input.start_time) {
      errors.push({ field: 'end_time', message: '終了時間は開始時間より後にしてください。' });
    }
    return errors;
  }

  /**
   * 予定の重なりを返す。保存は止めない（警告のみ）。
   * 休講と削除済みは相手に数えない。
   * @returns {Array<{type: string, message: string}>}
   */
  function findConflicts(input, excludeId) {
    var data = init();
    var warnings = [];

    data.schedules.forEach(function (s) {
      if (s.deleted_at) return;
      if (s.status === 'canceled') return;
      if (excludeId && s.id === excludeId) return;
      if (s.date !== input.date) return;
      // 重なりの判定: 開始 < 相手の終了 かつ 終了 > 相手の開始
      var overlaps = input.start_time < s.end_time && input.end_time > s.start_time;
      if (!overlaps) return;

      var decorated = decorate(data, s);
      if (s.room_id === input.room_id) {
        warnings.push({
          type: 'room',
          message: decorated.room_name + ' は ' + s.start_time + '〜' + s.end_time + ' に予定が入っています。'
        });
      }
      if (s.instructor_id === input.instructor_id) {
        warnings.push({
          type: 'instructor',
          message: decorated.instructor_name + ' は ' + s.start_time + '〜' + s.end_time + ' に予定が入っています。'
        });
      }
    });

    return warnings;
  }

  // --- 書き込み ---

  /**
   * 新規登録と変更の両方。input.id があれば変更、なければ新規。
   * 呼ぶ前に validate() を通すこと。
   * @returns {string} 保存した予定の id
   */
  function saveSchedule(input) {
    var data = init();
    var stamp = nowStamp();

    if (input.id) {
      var target = null;
      data.schedules.forEach(function (s) { if (s.id === input.id) target = s; });
      if (!target) throw new Error('変更対象の予定が見つかりません: ' + input.id);

      target.date = input.date;
      target.start_time = input.start_time;
      target.end_time = input.end_time;
      target.room_id = input.room_id;
      target.instructor_id = input.instructor_id;
      target.status = input.status;
      target.note = trim(input.note);
      target.updated_at = stamp;
      save(data);
      return target.id;
    }

    var created = {
      id: newId(),
      date: input.date,
      start_time: input.start_time,
      end_time: input.end_time,
      room_id: input.room_id,
      instructor_id: input.instructor_id,
      status: input.status || 'scheduled',
      note: trim(input.note),
      deleted_at: null,
      created_at: stamp,
      updated_at: stamp
    };
    data.schedules.push(created);
    save(data);
    return created.id;
  }

  /** 論理削除。物理削除しないので元に戻せる */
  function removeSchedule(id) {
    var data = init();
    data.schedules.forEach(function (s) {
      if (s.id === id) {
        s.deleted_at = nowStamp();
        s.updated_at = s.deleted_at;
      }
    });
    save(data);
  }

  /** 削除の取り消し */
  function restoreSchedule(id) {
    var data = init();
    data.schedules.forEach(function (s) {
      if (s.id === id) {
        s.deleted_at = null;
        s.updated_at = nowStamp();
      }
    });
    save(data);
  }

  return {
    today: today,
    shiftDays: shiftDays,
    addMinutes: addMinutes,
    DEFAULT_MINUTES: DEFAULT_MINUTES,
    listRooms: listRooms,
    listInstructors: listInstructors,
    listSchedules: listSchedules,
    getSchedule: getSchedule,
    countAll: countAll,
    validate: validate,
    findConflicts: findConflicts,
    saveSchedule: saveSchedule,
    removeSchedule: removeSchedule,
    restoreSchedule: restoreSchedule
  };
})();

// Node で動作確認する場合に使う
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}
