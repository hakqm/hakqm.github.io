/* ============================================================================
   HQAA 계측기 통합관리 — 공통 모듈 (equipment/common.js)
   - 로그인 공유(hak_login_user), Apps Script JSONP/POST 요청
   - 상태·검교정 판정, 불출/반납 공통 모달, 사진 압축 업로드
   - manager.html(통합관리)과 detail.html(종류별 상세)이 함께 사용
   ============================================================================ */
(function (global) {
  "use strict";

  /* ── 설정 ── */
  var DEFAULT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwn9I60-14GHDQk_rNF_uJYBpig-Bovl7Qqje_eGGjcFmZJZfqQgtpUg6necytvlQQ-/exec";
  var URL_PARAMS = new URLSearchParams(global.location.search);
  var PARENT_URL = (function () { try { return (global.parent && global.parent.HAK_WEB_APP_URL) || ""; } catch (e) { return ""; } })();
  var WEB_APP_URL = URL_PARAMS.get("api") || PARENT_URL || DEFAULT_WEB_APP_URL;

  var LOGIN_KEY = "hak_login_user";           /* index.html 과 동일 키 (같은 도메인 공유) */
  var LOGIN_EXPIRE_MS = 600 * 60 * 1000;
  var RECENT_KEY = "hak_eq_recent_inputs";    /* 최근 사용 목적/장소 재사용 */

  var STATUS_LABEL = {
    available: "사용 가능", checked_out: "불출 중", inspect_needed: "반납 점검 필요",
    return_inspection: "반납 점검 필요", repair: "수리 중", lost: "분실",
    retired: "사용 중지", disabled: "사용 중지"
  };
  var STATUS_CLS = {
    available: "ok", checked_out: "out", inspect_needed: "warn", return_inspection: "warn",
    repair: "warn", lost: "bad", retired: "off", disabled: "off"
  };
  var COND_LABEL = { normal: "정상", issue: "이상 있음", damaged: "파손", lost: "분실" };

  var state = { user: null, busy: false };

  /* ── 로그인 ── */
  function loadUser() {
    try {
      var raw = localStorage.getItem(LOGIN_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p.user || !p.lastActivity) return null;
      if (Date.now() - p.lastActivity > LOGIN_EXPIRE_MS) { localStorage.removeItem(LOGIN_KEY); return null; }
      p.lastActivity = Date.now();
      localStorage.setItem(LOGIN_KEY, JSON.stringify(p));
      return p.user;
    } catch (e) { return null; }
  }
  function saveUser(user) {
    state.user = user;
    try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ user: user, lastActivity: Date.now() })); } catch (e) {}
  }
  function userParams() {
    var u = state.user || {};
    return { user_id: u.user_id || "", emp_no: u.emp_no || "" };
  }
  function isManagerLocal() {
    var u = state.user;
    if (!u) return false;
    return String(u.role || "").toLowerCase() === "admin" || String(u.equipment_manager || "").toUpperCase() === "Y";
  }

  /* ── JSONP ── */
  function jsonp(action, params, timeoutMs) {
    params = params || {};
    return new Promise(function (resolve, reject) {
      var cb = "hakEq_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      var q = new URLSearchParams({ action: action, callback: cb });
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== "") q.append(k, params[k]);
      });
      var el = document.createElement("script");
      var t0 = performance.now();
      var timer = setTimeout(function () { cleanup(); reject(new Error("서버 응답이 지연되고 있습니다. 다시 시도해주세요.")); }, timeoutMs || 20000);
      function cleanup() {
        clearTimeout(timer);
        global[cb] = function () { try { delete global[cb]; } catch (e) {} };
        setTimeout(function () { try { delete global[cb]; } catch (e) {} }, 30000);
        el.remove();
      }
      global[cb] = function (d) {
        cleanup();
        console.log("[HQAA perf] " + action + " " + Math.round(performance.now() - t0) + "ms");
        resolve(d);
      };
      el.onerror = function () { cleanup(); reject(new Error("서버 연결에 실패했습니다.")); };
      el.src = WEB_APP_URL + "?" + q.toString();
      document.body.appendChild(el);
    });
  }

  /* ── POST (사진 업로드 — text/plain 으로 preflight 없이 전송) ── */
  function postJson(body) {
    return fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  /* ── 유틸 ── */
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(n) { var d = new Date(Date.now() + n * 86400000); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  /* ── 한국식 날짜 표시 ──
     서버·시트가 어떤 형태(yyyy-MM-dd, "Wed Apr 22 2026 … GMT+0900" 원문 등)로 보내도
     화면에는 "2026년 7월 20일" / "2026년 7월 20일 11:30" 만 표시한다.
     yyyy-MM-dd 는 문자열로 직접 분해해 시간대 변환으로 날짜가 밀리는 문제를 차단. */
  function parseDateParts(v) {
    if (v == null || v === "") return null;
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : 0 };
    var d = new Date(s);
    if (!isNaN(d.getTime())) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
    return null;
  }
  function fmtDate(v) {
    var p = parseDateParts(v);
    if (!p) return String(v == null ? "" : v);
    return p.y + "년 " + p.mo + "월 " + p.d + "일";
  }
  function fmtDateTime(v) {
    var p = parseDateParts(v);
    if (!p) return String(v == null ? "" : v);
    var base = p.y + "년 " + p.mo + "월 " + p.d + "일";
    /* 자정(00:00)은 날짜만 저장된 값 — 불필요한 시간 표시 생략 */
    if (p.h == null || (p.h === 0 && p.mi === 0)) return base;
    return base + " " + p.h + ":" + pad2(p.mi);
  }

  /* ── 검색 정규화 ──
     소문자 + 공백/하이픈/슬래시 등 구분문자 제거 → "가공 치수"="가공치수", "dB"="db",
     "버니어캘리퍼스"="버니어 캘리퍼스". 관리번호도 동일 규칙으로 비교되므로
     Q-GB-020 / QGB020 / gb-020 모두 검색된다 (정확 검색 유지). */
  function normSearch(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[\s\-_\/·.,()\[\]]+/g, "");
  }
  /* 검색어를 공백 기준 토큰으로 나눠 각각 정규화 — 모든 토큰이 포함되어야 일치(AND) */
  function searchTokens(q) {
    return String(q || "").split(/\s+/).map(normSearch).filter(Boolean);
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = document.getElementById("eqToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "eqToast"; el.className = "eq-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "eq-toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = "eq-toast"; }, 3000);
  }

  /* 검교정 상태 판정: ok / d30 / d7 / today / overdue / none */
  function calState(due, today) {
    today = today || todayStr();
    if (!due) return { key: "none", label: "예정일 미등록", cls: "cal-none" };
    if (due < today) return { key: "overdue", label: "기한 경과", cls: "cal-overdue" };
    if (due === today) return { key: "today", label: "오늘 예정", cls: "cal-today" };
    var d7 = addDays(7), d30 = addDays(30);
    if (due <= d7) return { key: "d7", label: "7일 이내", cls: "cal-d7" };
    if (due <= d30) return { key: "d30", label: "30일 이내", cls: "cal-d30" };
    return { key: "ok", label: "정상", cls: "cal-ok" };
  }
  function statusLabel(s) { return STATUS_LABEL[s] || s || "-"; }
  function statusBadge(s) { return '<span class="eq-status ' + (STATUS_CLS[s] || "off") + '">' + esc(statusLabel(s)) + "</span>"; }
  function siteText(item) {
    if (item.site && item.location) return item.site + " · " + item.location;
    return item.site || item.location || "미지정";
  }
  /* 일반 사용자 불출 가능 여부 (검교정 경과 포함 차단) */
  function canCheckout(item, today) {
    if (item.active === "N") return false;
    if (item.status !== "available") return false;
    var cs = calState(item.next_cal_date, today);
    if (cs.key === "overdue") return false;
    return true;
  }
  function blockReason(item, today) {
    if (item.active === "N" || item.status === "retired") return "사용 중지";
    if (item.status === "checked_out") return "불출 중";
    if (item.status === "inspect_needed") return "반납 점검 필요";
    if (item.status === "repair") return "수리 중";
    if (item.status === "lost") return "분실";
    if (calState(item.next_cal_date, today).key === "overdue") return "검교정 기한 경과";
    return "";
  }
  function openCert(url) {
    if (!url) { toast("등록된 성적서가 없습니다.", true); return; }
    var full = /^https?:\/\//i.test(url) ? url : ("/" + url.replace(/^\/+/, ""));
    global.open(full, "_blank", "noopener");
  }

  /* 최근 입력 재사용 */
  function loadRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveRecent(purpose, place, project) {
    try {
      var r = loadRecent();
      function push(arr, v) {
        arr = Array.isArray(arr) ? arr : [];
        if (v) { arr = [v].concat(arr.filter(function (x) { return x !== v; })).slice(0, 5); }
        return arr;
      }
      r.purpose = push(r.purpose, purpose);
      r.place = push(r.place, place);
      r.project = push(r.project, project);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r));
    } catch (e) {}
  }

  /* ── API 래퍼 ── */
  var api = {
    list: function () { return jsonp("getEquipmentList", userParams()); },
    mine: function () { return jsonp("getMyEquipmentCheckouts", userParams()); },
    tx: function (extra) { return jsonp("getEquipmentTransactions", Object.assign(userParams(), extra || {})); },
    checkoutBatch: function (params) { return jsonp("checkoutEquipmentBatch", Object.assign(userParams(), params), 30000); },
    returnBatch: function (items, reqId) {
      return jsonp("returnEquipmentBatch", Object.assign(userParams(), {
        items: JSON.stringify(items), client_req_id: reqId
      }), 30000);
    },
    adminSummary: function () { return jsonp("getEquipmentAdminSummary", userParams()); },
    updateInfo: function (params) { return jsonp("updateEquipmentInfo", Object.assign(userParams(), params)); },
    completeCal: function (params) { return jsonp("completeCalibration", Object.assign(userParams(), params)); },
    resolveInspection: function (params) { return jsonp("resolveEquipmentInspection", Object.assign(userParams(), params)); },
    login: function (name, empNo) {
      return jsonp("login", { name: name, emp_no: empNo });
    },
    uploadPhoto: function (dataUrl, eqCode, reqId) {
      var u = state.user || {};
      return postJson({
        action: "uploadEquipmentPhoto", data: dataUrl,
        eq_code: eqCode || "", client_req_id: reqId || "",
        user_id: u.user_id || "", emp_no: u.emp_no || ""
      });
    }
  };

  /* ── 사진 압축 (최대 1280px, JPEG 0.75) ── */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("사진을 읽지 못했습니다.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("사진 형식을 인식하지 못했습니다.")); };
        img.onload = function () {
          var max = 1280;
          var w = img.width, h = img.height;
          if (w > max || h > max) {
            var ratio = Math.min(max / w, max / h);
            w = Math.round(w * ratio); h = Math.round(h * ratio);
          }
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── 공통 모달 인프라 ──
     닫힘 규칙 (openModal 옵션):
       closeOnBackdrop : 바깥(회색) 클릭으로 닫기 허용 — 기본 false (거래·입력 모달 보호)
       confirmOnDirty  : 입력 내용이 있으면 ESC 닫기 전 확인 — 기본 true
       closeOnEscape   : ESC 로 닫기 허용 — 기본 true
     닫히는 경로: X/취소 버튼(requestCloseModal), ESC(dirty 면 확인), 처리 성공(closeModal).
     처리 중(setModalBusy(true))에는 어떤 경로로도 닫히지 않는다. */
  function ensureModalRoot() {
    var root = document.getElementById("eqModalRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "eqModalRoot";
      document.body.appendChild(root);
    }
    return root;
  }
  var modalCtx = { opts: {}, opener: null, busy: false, snapshot: null };

  function snapshotModalInputs_(root) {
    var vals = [];
    root.querySelectorAll("input, select, textarea").forEach(function (el) {
      if (el.type === "file") vals.push("");
      else if (el.type === "checkbox" || el.type === "radio") vals.push(el.checked ? "1" : "0");
      else vals.push(el.value);
    });
    return vals.join("");
  }
  function modalIsDirty() {
    var root = document.getElementById("eqModalRoot");
    if (!root || !root.querySelector(".eq-modal") || modalCtx.snapshot == null) return false;
    var files = root.querySelectorAll('input[type="file"]');
    for (var i = 0; i < files.length; i++) {
      if (files[i].files && files[i].files.length) return true; /* 사진 선택됨 */
    }
    return snapshotModalInputs_(root) !== modalCtx.snapshot;
  }
  function openModal(html, opts) {
    opts = opts || {};
    var root = ensureModalRoot();
    modalCtx.opts = {
      closeOnBackdrop: !!opts.closeOnBackdrop,
      confirmOnDirty: opts.confirmOnDirty !== false,
      closeOnEscape: opts.closeOnEscape !== false,
      dirtyMessage: opts.dirtyMessage || "입력한 내용이 저장되지 않았습니다. 창을 닫으시겠습니까?"
    };
    modalCtx.opener = document.activeElement;
    modalCtx.busy = false;
    root.innerHTML = '<div class="eq-modal-overlay show"><div class="eq-modal">' + html + "</div></div>";
    var ov = root.querySelector(".eq-modal-overlay");
    ov.addEventListener("click", function (ev) {
      if (ev.target !== ov) return;
      if (!modalCtx.opts.closeOnBackdrop) return; /* 거래 모달: 바깥 클릭으로 닫지 않음 */
      requestCloseModal("backdrop");
    });
    document.body.classList.add("eq-modal-open"); /* 배경 스크롤 잠금 */
    modalCtx.snapshot = snapshotModalInputs_(root);
    /* 열릴 때 첫 입력 요소에 포커스 */
    setTimeout(function () {
      var m = root.querySelector(".eq-modal");
      if (!m) return;
      var f = m.querySelector('input:not([type="hidden"]):not([type="file"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
      if (f) { try { f.focus(); } catch (e) {} }
    }, 30);
    return root;
  }
  function setModalBusy(busy) { modalCtx.busy = !!busy; }
  /* 사용자 조작(X/취소/ESC/바깥 클릭)에 의한 닫기 요청 — 규칙 적용 */
  function requestCloseModal(source) {
    var root = document.getElementById("eqModalRoot");
    if (!root || !root.querySelector(".eq-modal")) return;
    if (modalCtx.busy) { toast("처리 중입니다. 잠시만 기다려주세요."); return; }
    if (source === "escape") {
      if (!modalCtx.opts.closeOnEscape) return;
      if (modalCtx.opts.confirmOnDirty && modalIsDirty() && !confirm(modalCtx.opts.dirtyMessage)) return;
    }
    if (source === "backdrop" && modalCtx.opts.confirmOnDirty && modalIsDirty() && !confirm(modalCtx.opts.dirtyMessage)) return;
    closeModal();
  }
  function closeModal() {
    var root = document.getElementById("eqModalRoot");
    if (root) root.innerHTML = "";
    document.body.classList.remove("eq-modal-open");
    modalCtx.snapshot = null;
    modalCtx.busy = false;
    /* 닫힐 때 원래 누른 버튼으로 포커스 복귀 */
    if (modalCtx.opener && modalCtx.opener.focus && document.contains(modalCtx.opener)) {
      try { modalCtx.opener.focus(); } catch (e) {}
    }
    modalCtx.opener = null;
  }
  /* ESC 닫기 + Tab 포커스 트랩 (모달이 열려 있을 때만 동작) */
  document.addEventListener("keydown", function (ev) {
    var root = document.getElementById("eqModalRoot");
    var modal = root && root.querySelector(".eq-modal");
    if (!modal) return;
    if (ev.key === "Escape") { ev.preventDefault(); requestCloseModal("escape"); return; }
    if (ev.key !== "Tab") return;
    var els = modal.querySelectorAll('a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), label.eq-ri-photo-label');
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });

  /* ── 로그인 모달 (QR 접속 등 미로그인 사용자용) ── */
  function openLoginModal(onSuccess) {
    var root = openModal(
      '<div class="eq-modal-head"><h3>로그인</h3><button type="button" class="eq-modal-close" id="eqLoginClose">×</button></div>' +
      '<p class="eq-hint">포털과 동일한 이름·사번으로 로그인합니다. 로그인 후 보던 화면이 유지됩니다.</p>' +
      '<div class="eq-form-row"><label>이름</label><input type="text" id="eqLoginName" autocomplete="off" /></div>' +
      '<div class="eq-form-row"><label>사번</label><input type="text" id="eqLoginEmp" autocomplete="off" inputmode="numeric" /></div>' +
      '<div class="eq-modal-actions"><button type="button" class="eq-btn primary" id="eqLoginSubmit">로그인</button></div>'
    );
    root.querySelector("#eqLoginClose").addEventListener("click", function () { requestCloseModal("button"); });
    var nameEl = root.querySelector("#eqLoginName");
    var empEl = root.querySelector("#eqLoginEmp");
    var btn = root.querySelector("#eqLoginSubmit");
    function submit() {
      var name = nameEl.value.trim(), emp = empEl.value.trim();
      if (!name || !emp) { toast("이름과 사번을 입력해주세요.", true); return; }
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = "확인 중…";
      setModalBusy(true);
      api.login(name, emp).then(function (r) {
        if (!r || !r.success) { toast((r && r.message) || "로그인에 실패했습니다.", true); return; }
        saveUser(r.user);
        setModalBusy(false);
        closeModal();
        toast("로그인되었습니다.");
        if (onSuccess) onSuccess(r.user);
      }).catch(function (e) {
        console.error(e); toast("서버 연결 오류로 로그인하지 못했습니다.", true);
      }).finally(function () { setModalBusy(false); btn.disabled = false; btn.textContent = "로그인"; });
    }
    btn.addEventListener("click", submit);
    empEl.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
    nameEl.focus();
  }
  function requireLogin(onSuccess) {
    if (state.user) { onSuccess(state.user); return; }
    openLoginModal(onSuccess);
  }

  /* ══════════ 공통: 일괄 불출 모달 ══════════ */
  var PURPOSE_PRESETS = ["수입검사", "공정검사", "출하검사", "현장 측정", "시험/평가", "기타"];

  function openCheckoutModal(items, onDone) {
    if (!items.length) { toast("선택한 장비가 없습니다.", true); return; }
    var recent = loadRecent();
    var reqId = "R" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var listHtml = items.map(function (it) {
      return '<div class="eq-sel-item"><b>' + esc(it.eq_code) + "</b> " + esc(it.eq_name) +
        ' <span class="eq-muted">' + esc(it.spec || "") + " · " + esc(siteText(it)) + "</span></div>";
    }).join("");
    var recentPlace = (recent.place || []).map(function (v) {
      return '<button type="button" class="eq-chip" data-place="' + esc(v) + '">' + esc(v) + "</button>";
    }).join("");
    var root = openModal(
      '<div class="eq-modal-head"><h3>선택 장비 불출 (' + items.length + "대)</h3>" +
      '<button type="button" class="eq-modal-close" id="eqCoClose">×</button></div>' +
      '<div class="eq-sel-list">' + listHtml + "</div>" +
      '<div class="eq-form-row"><label>사용 목적 <span class="req">*</span></label>' +
      '<div class="eq-chip-row">' + PURPOSE_PRESETS.map(function (v) {
        return '<button type="button" class="eq-chip" data-purpose="' + esc(v) + '">' + esc(v) + "</button>";
      }).join("") + "</div>" +
      '<input type="text" id="eqCoPurpose" placeholder="사용 목적 입력 또는 위에서 선택" value="' + esc((recent.purpose || [])[0] || "") + '" /></div>' +
      '<div class="eq-form-row"><label>사용 장소</label>' +
      (recentPlace ? '<div class="eq-chip-row">' + recentPlace + "</div>" : "") +
      '<input type="text" id="eqCoPlace" placeholder="예: 김해 본사 1공장, 창녕 FAN 시험실" /></div>' +
      '<div class="eq-form-row"><label>예상 반납일 <span class="req">*</span></label>' +
      '<div class="eq-chip-row">' +
      '<button type="button" class="eq-chip" data-days="0">오늘</button>' +
      '<button type="button" class="eq-chip" data-days="1">내일</button>' +
      '<button type="button" class="eq-chip" data-days="3">3일 후</button>' +
      '<button type="button" class="eq-chip" data-days="7">1주일</button></div>' +
      '<input type="date" id="eqCoReturn" value="' + addDays(1) + '" min="' + todayStr() + '" /></div>' +
      '<div class="eq-form-row"><label>프로젝트 / 호선</label><input type="text" id="eqCoProject" value="' + esc((recent.project || [])[0] || "") + '" placeholder="선택 입력" /></div>' +
      '<div class="eq-form-row"><label>비고</label><input type="text" id="eqCoNote" placeholder="선택 입력" /></div>' +
      '<div class="eq-modal-actions">' +
      '<button type="button" class="eq-btn" id="eqCoCancel">취소</button>' +
      '<button type="button" class="eq-btn green" id="eqCoSubmit">📤 ' + items.length + "대 불출</button></div>"
    );
    root.querySelector("#eqCoClose").addEventListener("click", function () { requestCloseModal("button"); });
    root.querySelector("#eqCoCancel").addEventListener("click", function () { requestCloseModal("button"); });
    root.querySelectorAll("[data-purpose]").forEach(function (b) {
      b.addEventListener("click", function () { root.querySelector("#eqCoPurpose").value = b.dataset.purpose; });
    });
    root.querySelectorAll("[data-place]").forEach(function (b) {
      b.addEventListener("click", function () { root.querySelector("#eqCoPlace").value = b.dataset.place; });
    });
    root.querySelectorAll("[data-days]").forEach(function (b) {
      b.addEventListener("click", function () { root.querySelector("#eqCoReturn").value = addDays(parseInt(b.dataset.days, 10)); });
    });
    var btn = root.querySelector("#eqCoSubmit");
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      var purpose = root.querySelector("#eqCoPurpose").value.trim();
      var place = root.querySelector("#eqCoPlace").value.trim();
      var retDate = root.querySelector("#eqCoReturn").value;
      var project = root.querySelector("#eqCoProject").value.trim();
      var note = root.querySelector("#eqCoNote").value.trim();
      if (!purpose) { toast("사용 목적을 입력해주세요.", true); return; }
      if (!retDate) { toast("예상 반납일을 선택해주세요.", true); return; }
      btn.disabled = true; btn.textContent = "불출 처리 중…";
      setModalBusy(true); /* 처리 중 모달 닫힘 방지 */
      api.checkoutBatch({
        eq_codes: items.map(function (i) { return i.eq_code; }).join(","),
        purpose: purpose, place: place, expected_return_date: retDate,
        project: project, note: note, client_req_id: reqId
      }).then(function (r) {
        if (!r || !r.success) {
          var msg = (r && r.message) || "불출에 실패했습니다.";
          if (r && r.failed && r.failed.length) {
            msg += "\n" + r.failed.map(function (f) { return "· " + f.eq_code + ": " + f.reason; }).join("\n");
          }
          alert(msg);
          setModalBusy(false);
          btn.disabled = false; btn.textContent = "📤 " + items.length + "대 불출";
          return;
        }
        saveRecent(purpose, place, project);
        setModalBusy(false);
        closeModal();
        toast(r.message || "불출이 완료되었습니다.");
        if (onDone) onDone(r);
      }).catch(function (e) {
        console.error(e);
        alert("서버 오류로 불출하지 못했습니다. 목록을 새로고침한 뒤 실제 처리 여부를 확인해주세요.");
        setModalBusy(false);
        btn.disabled = false; btn.textContent = "📤 " + items.length + "대 불출";
      });
    });
  }

  /* ══════════ 공통: 일괄 반납 모달 ══════════ */
  function openReturnModal(items, onDone) {
    if (!items.length) { toast("반납할 장비를 선택해주세요.", true); return; }
    var reqId = "R" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var condOptions = Object.keys(COND_LABEL).map(function (k) {
      return '<option value="' + k + '">' + COND_LABEL[k] + "</option>";
    }).join("");
    var rows = items.map(function (it, idx) {
      return '<div class="eq-return-item" data-idx="' + idx + '">' +
        '<div class="eq-ri-head"><b>' + esc(it.eq_code) + "</b> " + esc(it.eq_name) + "</div>" +
        '<div class="eq-ri-controls">' +
        '<select class="eq-ri-cond" data-idx="' + idx + '">' + condOptions + "</select>" +
        '<input type="text" class="eq-ri-note" data-idx="' + idx + '" placeholder="비고 (이상/파손/분실 시 필수)" style="display:none;" />' +
        '<label class="eq-ri-photo-label" data-idx="' + idx + '" style="display:none;">📷 사진 <span class="eq-ri-photo-state">미첨부</span>' +
        '<input type="file" class="eq-ri-photo" data-idx="' + idx + '" accept="image/*" capture="environment" style="display:none;" /></label>' +
        "</div></div>";
    }).join("");
    var root = openModal(
      '<div class="eq-modal-head"><h3>장비 반납 (' + items.length + "대)</h3>" +
      '<button type="button" class="eq-modal-close" id="eqReClose">×</button></div>' +
      '<p class="eq-hint">모두 정상이면 그대로 반납 버튼을 누르면 됩니다. 상태가 다른 장비만 개별 변경하세요.<br>' +
      "이상 있음 → 반납 점검 필요 / 파손 → 수리 중 / 분실 → 분실 처리됩니다.</p>" +
      '<div class="eq-return-list">' + rows + "</div>" +
      '<div class="eq-modal-actions">' +
      '<button type="button" class="eq-btn" id="eqReCancel">취소</button>' +
      '<button type="button" class="eq-btn green" id="eqReSubmit">📥 ' + items.length + "대 반납</button></div>"
    );
    root.querySelector("#eqReClose").addEventListener("click", function () { requestCloseModal("button"); });
    root.querySelector("#eqReCancel").addEventListener("click", function () { requestCloseModal("button"); });

    var photoData = {}; /* idx → dataURL */
    root.querySelectorAll(".eq-ri-cond").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var idx = sel.dataset.idx;
        var need = sel.value !== "normal";
        var noteEl = root.querySelector('.eq-ri-note[data-idx="' + idx + '"]');
        var photoLabel = root.querySelector('.eq-ri-photo-label[data-idx="' + idx + '"]');
        noteEl.style.display = need ? "" : "none";
        /* 사진: 이상/파손 필수, 분실은 사유만 */
        photoLabel.style.display = (sel.value === "issue" || sel.value === "damaged") ? "" : "none";
      });
    });
    root.querySelectorAll(".eq-ri-photo").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var idx = inp.dataset.idx;
        var stateEl = root.querySelector('.eq-ri-photo-label[data-idx="' + idx + '"] .eq-ri-photo-state');
        if (!inp.files || !inp.files[0]) { delete photoData[idx]; stateEl.textContent = "미첨부"; return; }
        var fname = inp.files[0].name || "";
        if (fname.length > 22) fname = fname.slice(0, 10) + "…" + fname.slice(-8);
        stateEl.textContent = "압축 중…";
        compressImage(inp.files[0]).then(function (dataUrl) {
          photoData[idx] = dataUrl;
          stateEl.textContent = "첨부됨 ✓ " + fname;
        }).catch(function (e) {
          console.error(e); delete photoData[idx];
          stateEl.textContent = "실패 — 다시 선택";
          toast("사진 처리에 실패했습니다. 다시 선택해주세요.", true);
        });
      });
    });

    var btn = root.querySelector("#eqReSubmit");
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      var payload = [];
      for (var i = 0; i < items.length; i++) {
        var cond = root.querySelector('.eq-ri-cond[data-idx="' + i + '"]').value;
        var note = root.querySelector('.eq-ri-note[data-idx="' + i + '"]').value.trim();
        if (cond !== "normal" && !note) {
          alert(items[i].eq_code + " — " + COND_LABEL[cond] + " 반납은 비고(사유)가 필수입니다.");
          return;
        }
        if ((cond === "issue" || cond === "damaged") && !photoData[i]) {
          alert(items[i].eq_code + " — " + COND_LABEL[cond] + " 반납은 사진 첨부가 필수입니다.");
          return;
        }
        payload.push({ eq_code: items[i].eq_code, condition: cond, note: note, idx: i });
      }
      btn.disabled = true;
      setModalBusy(true); /* 사진 업로드·반납 처리 중 모달 닫힘 방지 */

      /* 1) 사진 업로드 (필요한 장비만, 순차) → 2) 일괄 반납
         사진 저장이 모두 성공해야 반납 거래를 진행한다 — 사진 실패 시 장비는 반납되지 않음 */
      var uploads = payload.filter(function (p) { return photoData[p.idx]; });
      var uploaded = {};
      var chain = Promise.resolve();
      uploads.forEach(function (p, n) {
        chain = chain.then(function () {
          btn.textContent = "사진 업로드 중… (" + (n + 1) + "/" + uploads.length + ")";
          return api.uploadPhoto(photoData[p.idx], p.eq_code, reqId).then(function (r) {
            if (!r || !r.success || !r.url) {
              var err = new Error((r && r.message) || "");
              err.isPhotoUpload = true;
              throw err;
            }
            uploaded[p.idx] = r.url;
          }, function (e) {
            var err = new Error((e && e.isPhotoUpload && e.message) || "네트워크 문제로 사진을 전송하지 못했습니다.");
            err.isPhotoUpload = true;
            throw err;
          });
        });
      });
      chain.then(function () {
        btn.textContent = "반납 처리 중…";
        var body = payload.map(function (p) {
          return { eq_code: p.eq_code, condition: p.condition, note: p.note, photo_url: uploaded[p.idx] || "" };
        });
        return api.returnBatch(body, reqId);
      }).then(function (r) {
        if (!r || !r.success) {
          var msg = (r && r.message) || "반납에 실패했습니다.";
          if (r && r.failed && r.failed.length) {
            msg += "\n" + r.failed.map(function (f) { return "· " + f.eq_code + ": " + f.reason; }).join("\n");
          }
          alert(msg);
          setModalBusy(false);
          btn.disabled = false; btn.textContent = "📥 " + items.length + "대 반납";
          return;
        }
        setModalBusy(false);
        closeModal();
        toast(r.message || "반납이 완료되었습니다.");
        if (onDone) onDone(r);
      }).catch(function (e) {
        console.error(e);
        setModalBusy(false);
        if (e && e.isPhotoUpload) {
          /* 사진 단계 실패 — 반납은 진행되지 않았고, 입력값·선택 사진은 모달에 그대로 유지됨 */
          alert("반납 사진을 저장하지 못했습니다.\n" +
            (e.message ? e.message + "\n" : "") +
            "계측기 사진 저장 권한 설정을 확인해 주세요.\n입력한 반납 정보와 선택한 사진은 유지됩니다.");
        } else {
          alert(e.message || "서버 오류로 반납하지 못했습니다. 목록을 새로고침한 뒤 실제 처리 여부를 확인해주세요.");
        }
        btn.disabled = false; btn.textContent = "📥 " + items.length + "대 반납";
      });
    });
  }

  /* ── 초기화 ── */
  function init() {
    state.user = loadUser();
    return state.user;
  }

  global.EQ = {
    WEB_APP_URL: WEB_APP_URL,
    init: init,
    user: function () { return state.user; },
    isManager: isManagerLocal,
    requireLogin: requireLogin,
    openLoginModal: openLoginModal,
    api: api,
    esc: esc,
    todayStr: todayStr,
    addDays: addDays,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    toast: toast,
    calState: calState,
    statusLabel: statusLabel,
    statusBadge: statusBadge,
    siteText: siteText,
    canCheckout: canCheckout,
    blockReason: blockReason,
    openCert: openCert,
    openCheckoutModal: openCheckoutModal,
    openReturnModal: openReturnModal,
    openModal: openModal,
    closeModal: closeModal,
    requestCloseModal: requestCloseModal,
    setModalBusy: setModalBusy,
    normSearch: normSearch,
    searchTokens: searchTokens,
    compressImage: compressImage
  };
})(window);
