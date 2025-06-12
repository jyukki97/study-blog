// ===== 개인화 기능 시스템 (Phase 5.2) =====

class PersonalizationFeatures {
  constructor() {
    this.settings = this.loadSettings();
    this.settingsPanel = null;
    this.readingHistory = this.loadReadingHistory();
    this.personalNotes = this.loadPersonalNotes();

    this.init();
  }

  async init() {
    console.log("[Personalization] 개인화 기능 초기화 시작...");

    // 사용자 설정 패널
    this.createSettingsPanel();

    // 폰트 크기 조절
    this.initFontSizeControl();

    // 읽기 속도 조절
    this.initReadingSpeedControl();

    // 개인 노트 기능
    this.initPersonalNotes();

    // 읽은 포스트 기록
    this.initReadingHistory();

    // 설정 적용
    this.applySettings();

    console.log("[Personalization] 개인화 기능 초기화 완료");
  }

  // 사용자 설정 패널 생성
  createSettingsPanel() {
    const panel = document.createElement("div");
    panel.className = "settings-panel";
    panel.innerHTML = `
      <div class="settings-backdrop"></div>
      <div class="settings-container">
        <div class="settings-header">
          <h2>⚙️ 개인 설정</h2>
          <button class="settings-close">×</button>
        </div>
        
        <div class="settings-content">
          <!-- 폰트 크기 설정 -->
          <div class="setting-group">
            <label class="setting-label">
              📝 폰트 크기
              <span class="setting-description">읽기 편의성을 위해 글자 크기를 조절하세요</span>
            </label>
            <div class="font-size-controls">
              <button class="font-btn" data-size="small">작게</button>
              <button class="font-btn" data-size="medium">보통</button>
              <button class="font-btn" data-size="large">크게</button>
              <button class="font-btn" data-size="extra-large">매우 크게</button>
            </div>
          </div>

          <!-- 읽기 속도 설정 -->
          <div class="setting-group">
            <label class="setting-label">
              ⏱️ 읽기 속도 (분당 단어 수)
              <span class="setting-description">읽기 시간 추정에 사용됩니다</span>
            </label>
            <div class="reading-speed-control">
              <input type="range" class="speed-slider" min="100" max="400" step="25" value="${
                this.settings.readingSpeed
              }">
              <span class="speed-value">${this.settings.readingSpeed} WPM</span>
            </div>
          </div>

          <!-- 개인 노트 설정 -->
          <div class="setting-group">
            <label class="setting-label">
              📓 개인 노트
              <span class="setting-description">포스트에 개인적인 메모를 남길 수 있습니다</span>
            </label>
            <div class="note-settings">
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.personalNotes ? "checked" : ""
                } data-setting="personalNotes">
                <span class="checkmark"></span>
                개인 노트 기능 활성화
              </label>
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.autoSaveNotes ? "checked" : ""
                } data-setting="autoSaveNotes">
                <span class="checkmark"></span>
                자동 저장
              </label>
            </div>
          </div>

          <!-- 읽기 기록 설정 -->
          <div class="setting-group">
            <label class="setting-label">
              📊 읽기 기록
              <span class="setting-description">읽은 포스트와 진행률을 추적합니다</span>
            </label>
            <div class="reading-history-settings">
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.trackReadingHistory ? "checked" : ""
                } data-setting="trackReadingHistory">
                <span class="checkmark"></span>
                읽기 기록 추적
              </label>
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.showReadingProgress ? "checked" : ""
                } data-setting="showReadingProgress">
                <span class="checkmark"></span>
                읽기 진행률 표시
              </label>
            </div>
          </div>

          <!-- 기타 설정 -->
          <div class="setting-group">
            <label class="setting-label">
              🎨 인터페이스
              <span class="setting-description">화면 표시 관련 설정</span>
            </label>
            <div class="interface-settings">
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.focusMode ? "checked" : ""
                } data-setting="focusMode">
                <span class="checkmark"></span>
                집중 모드 (사이드바 숨김)
              </label>
              <label class="setting-checkbox">
                <input type="checkbox" ${
                  this.settings.nightMode ? "checked" : ""
                } data-setting="nightMode">
                <span class="checkmark"></span>
                야간 독서 모드
              </label>
            </div>
          </div>
        </div>

        <div class="settings-footer">
          <button class="btn-reset">기본값으로 재설정</button>
          <button class="btn-export">설정 내보내기</button>
          <button class="btn-import">설정 가져오기</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.settingsPanel = panel;

    this.addSettingsStyles();
    this.attachSettingsListeners();
    this.createSettingsToggle();
  }

  addSettingsStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .settings-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: none;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .settings-panel.active {
        display: flex;
        opacity: 1;
      }

      .settings-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(5px);
      }

      .settings-container {
        position: relative;
        width: 90%;
        max-width: 600px;
        max-height: 80%;
        margin: auto;
        background: white;
        border-radius: 15px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .settings-header {
        background: linear-gradient(135deg, #b19cd9, #9a7bc8);
        color: white;
        padding: 20px 25px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .settings-header h2 {
        margin: 0;
        font-size: 1.5rem;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .settings-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 35px;
        height: 35px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .settings-close:hover {
        background: rgba(255,255,255,0.3);
      }

      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 25px;
      }

      .setting-group {
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 1px solid #f0f0f0;
      }

      .setting-group:last-child {
        border-bottom: none;
        margin-bottom: 0;
      }

      .setting-label {
        display: block;
        font-weight: 600;
        color: #333;
        margin-bottom: 15px;
        font-size: 1.1rem;
      }

      .setting-description {
        display: block;
        font-weight: normal;
        color: #666;
        font-size: 0.9rem;
        margin-top: 5px;
      }

      .font-size-controls {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 10px;
      }

      .font-btn {
        padding: 12px 16px;
        border: 2px solid #e0e0e0;
        background: white;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 500;
      }

      .font-btn:hover {
        border-color: #b19cd9;
        transform: translateY(-2px);
      }

      .font-btn.active {
        background: #b19cd9;
        color: white;
        border-color: #b19cd9;
      }

      .reading-speed-control {
        display: flex;
        align-items: center;
        gap: 15px;
      }

      .speed-slider {
        flex: 1;
        height: 6px;
        background: #e0e0e0;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
      }

      .speed-slider::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        background: #b19cd9;
        border-radius: 50%;
        cursor: pointer;
      }

      .speed-value {
        font-weight: 600;
        color: #b19cd9;
        min-width: 80px;
        text-align: center;
      }

      .note-settings,
      .reading-history-settings,
      .interface-settings {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .setting-checkbox {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        transition: background 0.2s;
      }

      .setting-checkbox:hover {
        background: #f8f9fa;
      }

      .setting-checkbox input[type="checkbox"] {
        display: none;
      }

      .checkmark {
        width: 20px;
        height: 20px;
        border: 2px solid #ddd;
        border-radius: 4px;
        position: relative;
        transition: all 0.2s;
      }

      .setting-checkbox input[type="checkbox"]:checked + .checkmark {
        background: #b19cd9;
        border-color: #b19cd9;
      }

      .setting-checkbox input[type="checkbox"]:checked + .checkmark::after {
        content: '✓';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: white;
        font-weight: bold;
        font-size: 12px;
      }

      .settings-footer {
        padding: 20px 25px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .settings-footer button {
        padding: 10px 16px;
        border: 1px solid #ddd;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
      }

      .btn-reset {
        color: #ff6b6b !important;
        border-color: #ff6b6b !important;
      }

      .btn-reset:hover {
        background: #ff6b6b !important;
        color: white !important;
      }

      .btn-export,
      .btn-import {
        color: #b19cd9 !important;
        border-color: #b19cd9 !important;
      }

      .btn-export:hover,
      .btn-import:hover {
        background: #b19cd9 !important;
        color: white !important;
      }

      .settings-toggle {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: #b19cd9;
        color: white;
        border: none;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.2rem;
        z-index: 9999;
        box-shadow: 0 4px 15px rgba(177, 156, 217, 0.3);
        transition: all 0.3s ease;
      }

      .settings-toggle:hover {
        background: #9a7bc8;
        transform: scale(1.1);
      }

      /* 폰트 크기 적용 */
      .font-size-small {
        font-size: 14px;
        line-height: 1.6;
      }

      .font-size-medium {
        font-size: 16px;
        line-height: 1.7;
      }

      .font-size-large {
        font-size: 18px;
        line-height: 1.8;
      }

      .font-size-extra-large {
        font-size: 20px;
        line-height: 1.9;
      }

      /* 집중 모드 */
      .focus-mode .sidebar,
      .focus-mode .analytics-container,
      .focus-mode .widget-area {
        display: none !important;
      }

      .focus-mode .main-content {
        max-width: 800px;
        margin: 0 auto;
      }

      /* 야간 독서 모드 */
      .night-mode {
        filter: sepia(10%) saturate(90%) brightness(80%);
      }

      /* 다크모드 지원 */
      [data-theme="dark"] .settings-container {
        background: #2d3748;
        color: #e2e8f0;
      }

      [data-theme="dark"] .setting-group {
        border-color: #4a5568;
      }

      [data-theme="dark"] .setting-label {
        color: #e2e8f0;
      }

      [data-theme="dark"] .setting-description {
        color: #a0aec0;
      }

      [data-theme="dark"] .font-btn {
        background: #374151;
        border-color: #4a5568;
        color: #e2e8f0;
      }

      [data-theme="dark"] .font-btn:hover {
        border-color: #b19cd9;
      }

      [data-theme="dark"] .setting-checkbox:hover {
        background: #374151;
      }

      [data-theme="dark"] .checkmark {
        border-color: #4a5568;
      }

      [data-theme="dark"] .settings-footer {
        border-color: #4a5568;
      }

      [data-theme="dark"] .settings-footer button {
        background: #374151;
        border-color: #4a5568;
        color: #e2e8f0;
      }

      /* 모바일 대응 */
      @media (max-width: 768px) {
        .settings-container {
          width: 95%;
          max-height: 90%;
        }

        .font-size-controls {
          grid-template-columns: repeat(2, 1fr);
        }

        .settings-footer {
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createSettingsToggle() {
    const toggle = document.createElement("button");
    toggle.className = "settings-toggle";
    toggle.innerHTML = "⚙️";
    toggle.title = "개인 설정";

    toggle.addEventListener("click", () => {
      this.openSettingsPanel();
    });

    document.body.appendChild(toggle);
  }

  attachSettingsListeners() {
    const panel = this.settingsPanel;

    // 패널 닫기
    panel.querySelector(".settings-close").addEventListener("click", () => {
      this.closeSettingsPanel();
    });

    panel.querySelector(".settings-backdrop").addEventListener("click", () => {
      this.closeSettingsPanel();
    });

    // 폰트 크기 버튼
    panel.querySelectorAll(".font-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const size = btn.dataset.size;
        this.changeFontSize(size);
        this.updateFontButtons(size);
      });
    });

    // 읽기 속도 슬라이더
    const speedSlider = panel.querySelector(".speed-slider");
    const speedValue = panel.querySelector(".speed-value");

    speedSlider.addEventListener("input", () => {
      const speed = speedSlider.value;
      speedValue.textContent = `${speed} WPM`;
      this.settings.readingSpeed = parseInt(speed);
      this.saveSettings();
    });

    // 체크박스 설정
    panel
      .querySelectorAll('input[type="checkbox"][data-setting]')
      .forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const setting = checkbox.dataset.setting;
          this.settings[setting] = checkbox.checked;
          this.saveSettings();
          this.applySettings();
        });
      });

    // 설정 관리 버튼
    panel.querySelector(".btn-reset").addEventListener("click", () => {
      this.resetSettings();
    });

    panel.querySelector(".btn-export").addEventListener("click", () => {
      this.exportSettings();
    });

    panel.querySelector(".btn-import").addEventListener("click", () => {
      this.importSettings();
    });
  }

  openSettingsPanel() {
    this.settingsPanel.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeSettingsPanel() {
    this.settingsPanel.classList.remove("active");
    document.body.style.overflow = "";
  }

  // 폰트 크기 조절
  initFontSizeControl() {
    this.applyFontSize(this.settings.fontSize);
  }

  changeFontSize(size) {
    this.settings.fontSize = size;
    this.saveSettings();
    this.applyFontSize(size);

    // GA 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "font_size_change", {
        event_category: "personalization",
        event_label: size,
      });
    }
  }

  applyFontSize(size) {
    document.documentElement.classList.remove(
      "font-size-small",
      "font-size-medium",
      "font-size-large",
      "font-size-extra-large"
    );
    document.documentElement.classList.add(`font-size-${size}`);
  }

  updateFontButtons(activeSize) {
    const buttons = this.settingsPanel.querySelectorAll(".font-btn");
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.size === activeSize);
    });
  }

  // 읽기 속도 조절
  initReadingSpeedControl() {
    // 읽기 시간 추정 업데이트
    this.updateReadingTimeEstimates();
  }

  updateReadingTimeEstimates() {
    const readingTimeElements = document.querySelectorAll(
      ".reading-time, .estimated-time"
    );

    readingTimeElements.forEach((element) => {
      const content = element.closest("article, .post")?.textContent || "";
      const wordCount = content.trim().split(/\s+/).length;
      const estimatedMinutes = Math.ceil(
        wordCount / this.settings.readingSpeed
      );

      element.textContent = `약 ${estimatedMinutes}분`;
    });
  }

  // 개인 노트 기능
  initPersonalNotes() {
    if (!this.settings.personalNotes) return;

    this.createNotesInterface();
  }

  createNotesInterface() {
    const currentUrl = window.location.pathname;
    const existingNote = this.personalNotes[currentUrl];

    const notesContainer = document.createElement("div");
    notesContainer.className = "personal-notes-container";
    notesContainer.innerHTML = `
      <div class="notes-header">
        <span class="notes-icon">📝</span>
        <h3>개인 노트</h3>
        <button class="notes-toggle">접기</button>
      </div>
      <div class="notes-content">
        <textarea class="notes-textarea" placeholder="이 포스트에 대한 개인적인 생각이나 메모를 남겨보세요...">${
          existingNote || ""
        }</textarea>
        <div class="notes-actions">
          <span class="notes-auto-save">자동 저장됨</span>
          <button class="notes-clear">지우기</button>
        </div>
      </div>
    `;

    // 포스트 하단에 삽입
    const article = document.querySelector("article, .post, .content");
    if (article) {
      article.appendChild(notesContainer);
    }

    this.addNotesStyles();
    this.attachNotesListeners(notesContainer);
  }

  addNotesStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .personal-notes-container {
        margin: 30px 0;
        border: 2px solid #e9ecef;
        border-radius: 12px;
        background: #f8f9fa;
        overflow: hidden;
        transition: all 0.3s ease;
      }

      .personal-notes-container:hover {
        border-color: #b19cd9;
      }

      .notes-header {
        background: linear-gradient(135deg, #b19cd9, #9a7bc8);
        color: white;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }

      .notes-header h3 {
        margin: 0;
        flex: 1;
        font-size: 16px;
      }

      .notes-toggle {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }

      .notes-content {
        padding: 16px;
        transition: all 0.3s ease;
      }

      .notes-content.collapsed {
        padding: 0;
        max-height: 0;
        overflow: hidden;
      }

      .notes-textarea {
        width: 100%;
        min-height: 120px;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 12px;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        resize: vertical;
        background: white;
        transition: border-color 0.2s;
      }

      .notes-textarea:focus {
        outline: none;
        border-color: #b19cd9;
        box-shadow: 0 0 0 3px rgba(177, 156, 217, 0.1);
      }

      .notes-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 12px;
      }

      .notes-auto-save {
        font-size: 12px;
        color: #28a745;
        opacity: 0;
        transition: opacity 0.3s;
      }

      .notes-auto-save.visible {
        opacity: 1;
      }

      .notes-clear {
        background: #ff6b6b;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      .notes-clear:hover {
        background: #ee5a52;
      }

      /* 다크모드 지원 */
      [data-theme="dark"] .personal-notes-container {
        background: #374151;
        border-color: #4a5568;
      }

      [data-theme="dark"] .notes-textarea {
        background: #2d3748;
        border-color: #4a5568;
        color: #e2e8f0;
      }
    `;
    document.head.appendChild(style);
  }

  attachNotesListeners(container) {
    const header = container.querySelector(".notes-header");
    const content = container.querySelector(".notes-content");
    const toggle = container.querySelector(".notes-toggle");
    const textarea = container.querySelector(".notes-textarea");
    const clearBtn = container.querySelector(".notes-clear");
    const autoSaveIndicator = container.querySelector(".notes-auto-save");

    // 노트 접기/펼기
    header.addEventListener("click", () => {
      content.classList.toggle("collapsed");
      toggle.textContent = content.classList.contains("collapsed")
        ? "펼치기"
        : "접기";
    });

    // 자동 저장
    let saveTimeout;
    textarea.addEventListener("input", () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        this.savePersonalNote(window.location.pathname, textarea.value);
        this.showAutoSaveIndicator(autoSaveIndicator);
      }, 1000);
    });

    // 노트 지우기
    clearBtn.addEventListener("click", () => {
      if (confirm("개인 노트를 삭제하시겠습니까?")) {
        textarea.value = "";
        this.savePersonalNote(window.location.pathname, "");
      }
    });
  }

  savePersonalNote(url, content) {
    if (content.trim()) {
      this.personalNotes[url] = content;
    } else {
      delete this.personalNotes[url];
    }

    localStorage.setItem("personal_notes", JSON.stringify(this.personalNotes));
  }

  showAutoSaveIndicator(indicator) {
    indicator.classList.add("visible");
    setTimeout(() => {
      indicator.classList.remove("visible");
    }, 2000);
  }

  // 읽기 기록 추적
  initReadingHistory() {
    if (!this.settings.trackReadingHistory) return;

    this.trackCurrentPost();
    this.showReadingProgress();
  }

  trackCurrentPost() {
    const currentUrl = window.location.pathname;
    const title = document.title;

    // 포스트 페이지가 아니면 리턴
    if (!currentUrl.includes("/posts/")) return;

    // 읽기 시작 시간 기록
    const startTime = Date.now();

    // 스크롤 진행률 추적
    let maxScrollPercent = 0;
    const trackScroll = () => {
      const scrollPercent = Math.round(
        (window.scrollY /
          (document.documentElement.scrollHeight - window.innerHeight)) *
          100
      );
      maxScrollPercent = Math.max(maxScrollPercent, scrollPercent);
    };

    window.addEventListener("scroll", this.throttle(trackScroll, 100));

    // 페이지 떠날 때 기록 저장
    window.addEventListener("beforeunload", () => {
      const readingTime = Date.now() - startTime;
      this.saveReadingRecord(currentUrl, {
        title,
        readingTime,
        scrollPercent: maxScrollPercent,
        timestamp: Date.now(),
        completed: maxScrollPercent >= 80,
      });
    });
  }

  saveReadingRecord(url, record) {
    this.readingHistory[url] = record;
    localStorage.setItem(
      "reading_history",
      JSON.stringify(this.readingHistory)
    );
  }

  showReadingProgress() {
    if (!this.settings.showReadingProgress) return;

    const currentUrl = window.location.pathname;
    const record = this.readingHistory[currentUrl];

    if (record && record.scrollPercent > 0) {
      this.createProgressIndicator(record);
    }
  }

  createProgressIndicator(record) {
    const indicator = document.createElement("div");
    indicator.className = "reading-progress-indicator";
    indicator.innerHTML = `
      <div class="progress-text">
        이전에 ${record.scrollPercent}% 읽었습니다
        ${record.completed ? "(완료)" : ""}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${
          record.scrollPercent
        }%"></div>
      </div>
      <button class="progress-continue">이어서 읽기</button>
    `;

    // 포스트 상단에 삽입
    const article = document.querySelector("article, .post, .content");
    if (article) {
      article.insertBefore(indicator, article.firstChild);
    }

    this.addProgressStyles();
    this.attachProgressListeners(indicator, record);
  }

  addProgressStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .reading-progress-indicator {
        background: linear-gradient(135deg, #e3f2fd, #bbdefb);
        border: 1px solid #90caf9;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
        text-align: center;
      }

      .progress-text {
        font-size: 14px;
        color: #1565c0;
        margin-bottom: 12px;
        font-weight: 500;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background: #e0e0e0;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 12px;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(135deg, #42a5f5, #1e88e5);
        transition: width 0.3s ease;
      }

      .progress-continue {
        background: #1976d2;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      .progress-continue:hover {
        background: #1565c0;
      }
    `;
    document.head.appendChild(style);
  }

  attachProgressListeners(indicator, record) {
    const continueBtn = indicator.querySelector(".progress-continue");

    continueBtn.addEventListener("click", () => {
      const targetScroll =
        (record.scrollPercent / 100) *
        (document.documentElement.scrollHeight - window.innerHeight);

      window.scrollTo({
        top: targetScroll,
        behavior: "smooth",
      });

      indicator.style.opacity = "0";
      setTimeout(() => indicator.remove(), 300);
    });
  }

  // 설정 적용
  applySettings() {
    // 폰트 크기
    this.applyFontSize(this.settings.fontSize);

    // 집중 모드
    document.documentElement.classList.toggle(
      "focus-mode",
      this.settings.focusMode
    );

    // 야간 독서 모드
    document.documentElement.classList.toggle(
      "night-mode",
      this.settings.nightMode
    );

    // 개인 노트 기능
    if (this.settings.personalNotes) {
      this.createNotesInterface();
    }

    // 읽기 기록
    if (this.settings.trackReadingHistory) {
      this.trackCurrentPost();
      this.showReadingProgress();
    }

    // 폰트 버튼 상태 업데이트
    if (this.settingsPanel) {
      this.updateFontButtons(this.settings.fontSize);
    }
  }

  // 설정 관리
  resetSettings() {
    if (confirm("모든 설정을 기본값으로 재설정하시겠습니까?")) {
      this.settings = this.getDefaultSettings();
      this.saveSettings();
      this.applySettings();
      location.reload();
    }
  }

  exportSettings() {
    const exportData = {
      settings: this.settings,
      personalNotes: this.personalNotes,
      readingHistory: this.readingHistory,
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `blog-settings-${new Date().toISOString().split("T")[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  importSettings() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importData = JSON.parse(e.target.result);

          if (confirm("설정을 가져오시겠습니까? 현재 설정이 덮어씌워집니다.")) {
            this.settings = {
              ...this.getDefaultSettings(),
              ...importData.settings,
            };
            this.personalNotes = importData.personalNotes || {};
            this.readingHistory = importData.readingHistory || {};

            this.saveSettings();
            this.savePersonalNotes();
            this.saveReadingHistory();

            location.reload();
          }
        } catch (error) {
          alert("설정 파일을 읽는 중 오류가 발생했습니다.");
        }
      };
      reader.readAsText(file);
    });

    input.click();
  }

  // 유틸리티 메서드
  getDefaultSettings() {
    return {
      fontSize: "medium",
      readingSpeed: 200,
      personalNotes: true,
      autoSaveNotes: true,
      trackReadingHistory: true,
      showReadingProgress: true,
      focusMode: false,
      nightMode: false,
    };
  }

  loadSettings() {
    const saved = localStorage.getItem("personalization_settings");
    return saved
      ? { ...this.getDefaultSettings(), ...JSON.parse(saved) }
      : this.getDefaultSettings();
  }

  saveSettings() {
    localStorage.setItem(
      "personalization_settings",
      JSON.stringify(this.settings)
    );
  }

  loadPersonalNotes() {
    const saved = localStorage.getItem("personal_notes");
    return saved ? JSON.parse(saved) : {};
  }

  savePersonalNotes() {
    localStorage.setItem("personal_notes", JSON.stringify(this.personalNotes));
  }

  loadReadingHistory() {
    const saved = localStorage.getItem("reading_history");
    return saved ? JSON.parse(saved) : {};
  }

  saveReadingHistory() {
    localStorage.setItem(
      "reading_history",
      JSON.stringify(this.readingHistory)
    );
  }

  throttle(func, limit) {
    let inThrottle;
    return function () {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  // 디버그 정보
  getDebugInfo() {
    return {
      settings: this.settings,
      personalNotesCount: Object.keys(this.personalNotes).length,
      readingHistoryCount: Object.keys(this.readingHistory).length,
    };
  }
}

// DOM 로드 완료 후 초기화
let personalizationFeatures;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    personalizationFeatures = new PersonalizationFeatures();
  });
} else {
  personalizationFeatures = new PersonalizationFeatures();
}

// 전역 함수로 노출 (디버깅용)
window.PersonalizationFeatures = {
  instance: () => personalizationFeatures,
  getDebugInfo: () => personalizationFeatures?.getDebugInfo(),
};

console.log("[Personalization] 개인화 기능 시스템 로드 완료");
