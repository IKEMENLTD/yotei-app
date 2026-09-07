'use strict';

/**
 * 画面の描画と操作。
 * 実装規約（sotsugyo.md 8.2）: 入力値の表示は textContent を使い、innerHTML に渡さない。
 * 描画方針（8.1-4）: データを唯一の正とし、変更のたび一覧を全部描き直す。
 */
(function () {
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var ERROR_FIELDS = ['date', 'start_time', 'end_time', 'room_id', 'instructor_id'];

  var el = {};
  var editingId = null;   // null なら新規登録
  var formSnapshot = '';  // 入力途中かどうかの判定用
  var toastTimer = null;

  // --- 小さな道具 ---

  function createEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatDateLabel(dateString) {
    var parts = dateString.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Number(parts[1]) + '月' + Number(parts[2]) + '日（' + WEEKDAYS[d.getDay()] + '）';
  }

  // --- 一覧 ---

  function currentRange() {
    return { from: el.filterFrom.value || null, to: el.filterTo.value || null };
  }

  function rangeLabel(range) {
    if (range.from && range.to) {
      return formatDateLabel(range.from) + ' 〜 ' + formatDateLabel(range.to);
    }
    if (range.from) return formatDateLabel(range.from) + ' 以降';
    if (range.to) return formatDateLabel(range.to) + ' まで';
    return '全期間';
  }

  function buildRow(item) {
    var row = createEl('li', 'row');
    if (item.status === 'canceled') row.classList.add('is-canceled');

    row.appendChild(createEl('span', 'row-time', item.start_time + '〜' + item.end_time));
    row.appendChild(createEl('span', 'row-room', item.room_name));
    row.appendChild(createEl('span', 'row-instructor', item.instructor_name));

    var tail = createEl('span', 'row-tail');
    if (item.status === 'canceled') tail.appendChild(createEl('span', 'badge', '休講'));
    if (item.note) tail.appendChild(createEl('span', 'row-note', item.note));

    var editButton = createEl('button', 'row-action', '編集');
    editButton.type = 'button';
    editButton.addEventListener('click', function () { openForm(item.id); });
    tail.appendChild(editButton);

    var deleteButton = createEl('button', 'row-action', '削除');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', function () { handleDelete(item); });
    tail.appendChild(deleteButton);

    row.appendChild(tail);
    return row;
  }

  function buildDateGroups(items) {
    var fragment = document.createDocumentFragment();
    var currentDate = null;
    var currentList = null;

    items.forEach(function (item) {
      if (item.date !== currentDate) {
        currentDate = item.date;
        var group = createEl('section', 'date-group');
        var heading = createEl('h2', 'date-heading', formatDateLabel(item.date));
        if (item.date === Store.today()) {
          heading.appendChild(createEl('span', 'today-badge', '今日'));
        }
        group.appendChild(heading);
        currentList = createEl('ul', 'rows');
        group.appendChild(currentList);
        fragment.appendChild(group);
      }
      currentList.appendChild(buildRow(item));
    });

    return fragment;
  }

  /** 「まだ1件も無い」と「絞り込み結果が0件」を必ず出し分ける（sotsugyo.md 6章） */
  function buildEmpty(range) {
    var box = createEl('div', 'empty');
    if (Store.countAll() === 0) {
      box.appendChild(createEl('p', 'empty-title', 'まだ予定がありません。'));
      box.appendChild(createEl('p', 'empty-hint', '「予定を追加」から始めてください。'));
    } else {
      box.appendChild(createEl('p', 'empty-title', rangeLabel(range) + ' の予定はありません。'));
      box.appendChild(createEl('p', 'empty-hint', '別の期間に予定があります。絞り込みを解除して確認してください。'));
    }
    return box;
  }

  function render() {
    var range = currentRange();
    var items = Store.listSchedules(range);

    el.filterStatus.textContent = '表示中: ' + rangeLabel(range) + '（' + items.length + '件）';

    el.list.textContent = '';
    el.list.appendChild(items.length === 0 ? buildEmpty(range) : buildDateGroups(items));
  }

  function resetToDefault() {
    el.filterFrom.value = Store.today();
    el.filterTo.value = '';
    render();
  }

  // --- 画面の切り替え ---

  function showList() {
    el.viewForm.hidden = true;
    el.viewList.hidden = false;
    el.addButton.hidden = false;
    render();
  }

  function showForm() {
    el.viewList.hidden = true;
    el.viewForm.hidden = false;
    el.addButton.hidden = true;
  }

  // --- フォーム ---

  function fillSelect(select, items, selectedId) {
    select.textContent = '';
    var placeholder = createEl('option', null, '選んでください');
    placeholder.value = '';
    select.appendChild(placeholder);

    items.forEach(function (item) {
      var option = createEl('option', null, item.name);
      option.value = item.id;
      if (item.id === selectedId) option.selected = true;
      select.appendChild(option);
    });
  }

  function readForm() {
    return {
      id: editingId,
      date: el.fDate.value,
      start_time: el.fStart.value,
      end_time: el.fEnd.value,
      room_id: el.fRoom.value,
      instructor_id: el.fInstructor.value,
      status: el.fStatus.value,
      note: el.fNote.value
    };
  }

  function snapshot() {
    return JSON.stringify(readForm());
  }

  function clearErrors() {
    ERROR_FIELDS.forEach(function (field) {
      var node = document.getElementById('e-' + field);
      node.textContent = '';
      node.hidden = true;
    });
  }

  /** 違反はまとめて全部出す。1つずつ直させない（sotsugyo.md 6章） */
  function showErrors(errors) {
    clearErrors();
    errors.forEach(function (error) {
      var node = document.getElementById('e-' + error.field);
      if (node) {
        node.textContent = error.message;
        node.hidden = false;
      }
    });
  }

  function openForm(id) {
    editingId = id || null;
    clearErrors();

    var rooms = Store.listRooms();
    var instructors = Store.listInstructors();

    if (editingId) {
      var item = Store.getSchedule(editingId);
      if (!item) {
        showToast('対象の予定が見つかりませんでした。');
        return;
      }
      el.formTitle.textContent = '予定を編集';
      el.fDate.value = item.date;
      el.fStart.value = item.start_time;
      el.fEnd.value = item.end_time;
      el.fStatus.value = item.status;
      el.fNote.value = item.note || '';
      fillSelect(el.fRoom, rooms, item.room_id);
      fillSelect(el.fInstructor, instructors, item.instructor_id);
    } else {
      el.formTitle.textContent = '予定を追加';
      el.fDate.value = el.filterFrom.value || Store.today();
      el.fStart.value = '10:00';
      el.fEnd.value = Store.addMinutes('10:00', Store.DEFAULT_MINUTES);
      el.fStatus.value = 'scheduled';
      el.fNote.value = '';
      fillSelect(el.fRoom, rooms, null);
      fillSelect(el.fInstructor, instructors, null);
    }

    formSnapshot = snapshot();
    showForm();
    el.fDate.focus();
  }

  /** 開始時間を変えたら、終了時間を自動で埋める（空か、開始より前になった場合） */
  function autoFillEnd() {
    if (!el.fStart.value) return;
    if (!el.fEnd.value || el.fEnd.value <= el.fStart.value) {
      el.fEnd.value = Store.addMinutes(el.fStart.value, Store.DEFAULT_MINUTES);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    var input = readForm();

    var errors = Store.validate(input);
    if (errors.length > 0) {
      showErrors(errors);
      return;
    }
    clearErrors();

    // 重なりは警告のみ。保存は止めない（sotsugyo.md 5.4）
    var conflicts = Store.findConflicts(input, editingId);
    if (conflicts.length > 0) {
      var lines = conflicts.map(function (c) { return '・' + c.message; }).join('\n');
      var proceed = window.confirm('予定が重なっています。\n\n' + lines + '\n\nこのまま保存しますか？');
      if (!proceed) return;
    }

    Store.saveSchedule(input);
    formSnapshot = snapshot();
    showToast(editingId ? '保存しました。' : '予定を追加しました。');
    editingId = null;
    showList();
  }

  /** 入力途中で離れるときは確認する（sotsugyo.md 6章） */
  function handleCancel() {
    if (snapshot() !== formSnapshot) {
      var leave = window.confirm('入力内容が保存されていません。やめますか？');
      if (!leave) return;
    }
    editingId = null;
    showList();
  }

  // --- 削除と取り消し ---

  function handleDelete(item) {
    var label = formatDateLabel(item.date) + ' ' + item.start_time + '〜' + item.end_time +
      '\n' + item.room_name + ' / ' + item.instructor_name;
    if (!window.confirm('この予定を削除します。\n\n' + label + '\n\nよろしいですか？')) return;

    Store.removeSchedule(item.id);
    render();
    showToast('削除しました。', '元に戻す', function () {
      Store.restoreSchedule(item.id);
      render();
      showToast('元に戻しました。');
    });
  }

  // --- メモの要約 ---

  function setSummary(className, lines) {
    el.summaryResult.textContent = '';
    el.summaryResult.className = 'summary-result ' + className;
    lines.forEach(function (line) {
      el.summaryResult.appendChild(createEl('p', null, line));
    });
    el.summaryResult.hidden = false;
  }

  async function handleSummarize() {
    var items = Store.listSchedules(currentRange());
    // 送るのは日付とメモだけ。教室名・講師名は送らない
    var notes = items
      .filter(function (item) { return item.note && item.note.trim() !== ''; })
      .map(function (item) { return { date: item.date, note: item.note }; });

    if (notes.length === 0) {
      setSummary('is-info', ['表示中の期間に、メモの付いた予定がありません。']);
      return;
    }

    el.summarizeButton.disabled = true;
    setSummary('is-info', ['要約しています…（' + notes.length + '件のメモ）']);

    try {
      var result = await Summarize.run(notes);
      setSummary('is-done', String(result.summary || '').split('\n').filter(function (line) {
        return line.trim() !== '';
      }));
    } catch (err) {
      setSummary('is-error', [err.message]);
    } finally {
      el.summarizeButton.disabled = false;
    }
  }

  // --- 通知 ---

  function showToast(message, actionLabel, onAction) {
    if (toastTimer) clearTimeout(toastTimer);

    el.toast.textContent = '';
    el.toast.appendChild(createEl('span', null, message));

    if (actionLabel && onAction) {
      var button = createEl('button', 'toast-action', actionLabel);
      button.type = 'button';
      button.addEventListener('click', function () {
        hideToast();
        onAction();
      });
      el.toast.appendChild(button);
    }

    el.toast.hidden = false;
    toastTimer = setTimeout(hideToast, 6000);
  }

  function hideToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    el.toast.hidden = true;
  }

  // --- 起動 ---

  function init() {
    el.viewList = document.getElementById('view-list');
    el.viewForm = document.getElementById('view-form');
    el.addButton = document.getElementById('add-button');

    el.filterFrom = document.getElementById('filter-from');
    el.filterTo = document.getElementById('filter-to');
    el.filterReset = document.getElementById('filter-reset');
    el.filterStatus = document.getElementById('filter-status');
    el.list = document.getElementById('list');
    el.summarizeButton = document.getElementById('summarize-button');
    el.summaryResult = document.getElementById('summary-result');

    el.form = document.getElementById('schedule-form');
    el.formTitle = document.getElementById('form-title');
    el.formCancel = document.getElementById('form-cancel');
    el.fDate = document.getElementById('f-date');
    el.fStart = document.getElementById('f-start');
    el.fEnd = document.getElementById('f-end');
    el.fRoom = document.getElementById('f-room');
    el.fInstructor = document.getElementById('f-instructor');
    el.fStatus = document.getElementById('f-status');
    el.fNote = document.getElementById('f-note');

    el.toast = document.getElementById('toast');

    el.filterFrom.addEventListener('change', render);
    el.filterTo.addEventListener('change', render);
    el.filterReset.addEventListener('click', resetToDefault);
    el.summarizeButton.addEventListener('click', handleSummarize);
    el.addButton.addEventListener('click', function () { openForm(null); });
    el.form.addEventListener('submit', handleSubmit);
    el.formCancel.addEventListener('click', handleCancel);
    el.fStart.addEventListener('change', autoFillEnd);

    resetToDefault();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
