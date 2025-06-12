/**
 * ===== 고급 테마 토글 시스템 (Phase 2.1) =====
 * 
 * 기능:
 * - 향상된 테마 토글 버튼 (시각적 애니메이션)
 * - 부드러운 테마 전환 애니메이션
 * - 시스템 테마 자동 감지
 * - 3단계 테마 순환 (Light → Dark → Auto)
 * - 키보드 단축키 지원
 * - 접근성 개선 (ARIA, 툴팁, 고대비)
 * - 상태 저장 (localStorage)
 * - 터치 제스처 지원
 * - 성능 최적화 (FOUC 방지)
 * - 프로그래매틱 API
 */

class AdvancedThemeToggle {
    constructor() {
        this.themes = ['light', 'dark', 'auto'];
        this.currentTheme = this.getStoredTheme() || 'auto';
        this.systemTheme = this.getSystemTheme();
        this.isTransitioning = false;
        this.touchStartX = 0;
        this.touchStartY = 0;
        
        this.init();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.setupSystemThemeListener();
        this.setupTouchGestures();
        this.setupAccessibility();
    }

    init() {
        this.preventFOUC();
        this.createAdvancedToggleButton();
        this.applyTheme(this.currentTheme);
        this.updateToggleButton();
        this.trackThemeUsage();
    }

    // FOUC (Flash of Unstyled Content) 방지
    preventFOUC() {
        const meta = document.createElement('meta');
        meta.name = 'theme-transition';
        meta.content = 'none';
        document.head.appendChild(meta);
        
        // 페이지 로드 완료 후 전환 효과 활성화
        window.addEventListener('load', () => {
            setTimeout(() => {
                meta.remove();
                document.documentElement.style.transition = 'color-scheme 0.3s ease';
            }, 100);
        });
    }

    // 고급 토글 버튼 생성
    createAdvancedToggleButton() {
        const existingButton = document.querySelector('#theme-toggle');
        if (!existingButton) return;

        // 기존 버튼을 고급 버튼으로 교체
        const advancedButton = document.createElement('button');
        advancedButton.id = 'theme-toggle';
        advancedButton.className = 'advanced-theme-toggle';
        advancedButton.setAttribute('aria-label', '테마 변경');
        advancedButton.setAttribute('title', '테마 변경 (Ctrl+Shift+T)');
        
        advancedButton.innerHTML = `
            <div class="toggle-track">
                <div class="toggle-thumb">
                    <div class="theme-icon light-icon">☀️</div>
                    <div class="theme-icon dark-icon">🌙</div>
                    <div class="theme-icon auto-icon">🔄</div>
                </div>
                <div class="toggle-background">
                    <div class="sun-rays"></div>
                    <div class="moon-crater"></div>
                    <div class="auto-symbol"></div>
                </div>
            </div>
            <span class="theme-label" aria-live="polite">${this.getThemeLabel(this.currentTheme)}</span>
        `;

        existingButton.parentNode.replaceChild(advancedButton, existingButton);
        this.toggleButton = advancedButton;

        // 호버 효과 추가
        this.addHoverEffects();
    }

    addHoverEffects() {
        if (!this.toggleButton) return;

        this.toggleButton.addEventListener('mouseenter', () => {
            this.toggleButton.classList.add('hover-effect');
            this.showTooltip();
        });

        this.toggleButton.addEventListener('mouseleave', () => {
            this.toggleButton.classList.remove('hover-effect');
            this.hideTooltip();
        });
    }

    showTooltip() {
        const tooltip = document.createElement('div');
        tooltip.className = 'theme-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-content">
                <strong>테마 변경</strong>
                <div class="tooltip-shortcuts">
                    <span>Ctrl+Shift+T</span> 또는 <span>Alt+T</span>
                </div>
                <div class="tooltip-cycle">
                    Light → Dark → Auto
                </div>
            </div>
        `;
        
        this.toggleButton.appendChild(tooltip);
        
        // 애니메이션으로 표시
        setTimeout(() => tooltip.classList.add('visible'), 10);
    }

    hideTooltip() {
        const tooltip = this.toggleButton?.querySelector('.theme-tooltip');
        if (tooltip) {
            tooltip.classList.remove('visible');
            setTimeout(() => tooltip.remove(), 200);
        }
    }

    // 이벤트 리스너 설정
    setupEventListeners() {
        this.toggleButton?.addEventListener('click', (e) => {
            e.preventDefault();
            this.cycleTheme();
        });

        // 버튼 포커스 관리
        this.toggleButton?.addEventListener('focus', () => {
            this.toggleButton.classList.add('focused');
        });

        this.toggleButton?.addEventListener('blur', () => {
            this.toggleButton.classList.remove('focused');
        });
    }

    // 키보드 단축키 설정
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+T 또는 Alt+T로 테마 토글
            if ((e.ctrlKey && e.shiftKey && e.key === 'T') || 
                (e.altKey && e.key === 't')) {
                e.preventDefault();
                this.cycleTheme();
                this.showKeyboardFeedback();
            }

            // T 키만으로도 토글 (검색창이 포커스되지 않은 경우)
            if (e.key === 't' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                const activeElement = document.activeElement;
                if (activeElement.tagName !== 'INPUT' && 
                    activeElement.tagName !== 'TEXTAREA' && 
                    !activeElement.contentEditable) {
                    e.preventDefault();
                    this.cycleTheme();
                }
            }
        });
    }

    showKeyboardFeedback() {
        const feedback = document.createElement('div');
        feedback.className = 'keyboard-feedback';
        feedback.innerHTML = `
            <div class="feedback-content">
                <span class="feedback-icon">⌨️</span>
                <span class="feedback-text">테마가 ${this.getThemeLabel(this.currentTheme)}(으)로 변경되었습니다</span>
            </div>
        `;
        
        document.body.appendChild(feedback);
        
        setTimeout(() => feedback.classList.add('visible'), 10);
        setTimeout(() => {
            feedback.classList.remove('visible');
            setTimeout(() => feedback.remove(), 300);
        }, 2000);
    }

    // 시스템 테마 감지 및 리스너
    setupSystemThemeListener() {
        if (typeof window !== 'undefined' && window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            mediaQuery.addEventListener('change', (e) => {
                this.systemTheme = e.matches ? 'dark' : 'light';
                
                if (this.currentTheme === 'auto') {
                    this.applyTheme('auto');
                }
                
                // 시스템 테마 변경 알림
                this.showSystemThemeChangeNotification();
            });
        }
    }

    showSystemThemeChangeNotification() {
        if (this.currentTheme !== 'auto') return;

        const notification = document.createElement('div');
        notification.className = 'system-theme-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">🔄</span>
                <span class="notification-text">시스템 테마가 변경되어 자동으로 적용되었습니다</span>
                <button class="notification-close">×</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('visible'), 10);
        
        // 자동 숨김
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
        
        // 수동 닫기
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
        });
    }

    // 터치 제스처 지원
    setupTouchGestures() {
        let touchSwipeEnabled = false;
        
        // 설정에서 터치 제스처 활성화 확인
        try {
            touchSwipeEnabled = localStorage.getItem('theme-touch-gesture') !== 'false';
        } catch (e) {
            touchSwipeEnabled = true;
        }

        if (!touchSwipeEnabled) return;

        document.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) { // 두 손가락 제스처
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 2) {
                const touchEndX = e.changedTouches[0].clientX;
                const touchEndY = e.changedTouches[0].clientY;
                
                const deltaX = touchEndX - this.touchStartX;
                const deltaY = touchEndY - this.touchStartY;
                
                // 수평 스와이프 감지 (최소 100px, 수직 움직임 < 50px)
                if (Math.abs(deltaX) > 100 && Math.abs(deltaY) < 50) {
                    this.cycleTheme();
                    this.showTouchFeedback(deltaX > 0 ? 'right' : 'left');
                }
            }
        }, { passive: true });
    }

    showTouchFeedback(direction) {
        const feedback = document.createElement('div');
        feedback.className = `touch-feedback ${direction}`;
        feedback.innerHTML = `
            <div class="feedback-gesture">
                ${direction === 'right' ? '👈' : '👉'}
            </div>
            <div class="feedback-text">테마 변경: ${this.getThemeLabel(this.currentTheme)}</div>
        `;
        
        document.body.appendChild(feedback);
        
        setTimeout(() => feedback.classList.add('visible'), 10);
        setTimeout(() => {
            feedback.classList.remove('visible');
            setTimeout(() => feedback.remove(), 300);
        }, 1500);
    }

    // 접근성 개선
    setupAccessibility() {
        // 고대비 모드 감지
        if (window.matchMedia) {
            const highContrastQuery = window.matchMedia('(prefers-contrast: high)');
            highContrastQuery.addEventListener('change', (e) => {
                document.documentElement.classList.toggle('high-contrast', e.matches);
            });
            
            if (highContrastQuery.matches) {
                document.documentElement.classList.add('high-contrast');
            }
        }

        // 감소된 모션 설정 감지
        if (window.matchMedia) {
            const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            reducedMotionQuery.addEventListener('change', (e) => {
                document.documentElement.classList.toggle('reduced-motion', e.matches);
            });
            
            if (reducedMotionQuery.matches) {
                document.documentElement.classList.add('reduced-motion');
            }
        }

        // 스크린 리더 지원
        this.announceThemeChange();
    }

    announceThemeChange() {
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'sr-only theme-announcement';
        document.body.appendChild(announcement);
        
        this.announcementElement = announcement;
    }

    // 테마 순환
    cycleTheme() {
        if (this.isTransitioning) return;
        
        this.isTransitioning = true;
        
        const currentIndex = this.themes.indexOf(this.currentTheme);
        const nextIndex = (currentIndex + 1) % this.themes.length;
        const nextTheme = this.themes[nextIndex];
        
        this.setTheme(nextTheme);
        
        // 전환 애니메이션 완료 후 플래그 리셋
        setTimeout(() => {
            this.isTransitioning = false;
        }, 300);
    }

    // 테마 설정
    setTheme(theme) {
        if (!this.themes.includes(theme)) {
            console.warn(`Invalid theme: ${theme}`);
            return;
        }
        
        this.currentTheme = theme;
        this.setStoredTheme(theme);
        this.applyTheme(theme);
        this.updateToggleButton();
        this.trackThemeChange(theme);
        this.announceThemeToScreenReader(theme);
        
        // Google Analytics 추적
        if (typeof trackThemeChange !== 'undefined') {
            trackThemeChange(theme);
        }
    }

    // 테마 적용
    applyTheme(theme) {
        const effectiveTheme = theme === 'auto' ? this.systemTheme : theme;
        
        // 부드러운 전환을 위한 준비
        document.documentElement.classList.add('theme-transitioning');
        
        // 테마 속성 설정
        document.documentElement.setAttribute('data-theme', effectiveTheme);
        document.documentElement.style.colorScheme = effectiveTheme;
        
        // CSS 변수 업데이트 (필요한 경우)
        this.updateCSSVariables(effectiveTheme);
        
        // 전환 완료 후 클래스 제거
        setTimeout(() => {
            document.documentElement.classList.remove('theme-transitioning');
        }, 300);
    }

    updateCSSVariables(theme) {
        const root = document.documentElement;
        
        if (theme === 'dark') {
            root.style.setProperty('--primary-rgb', '100, 210, 255');
            root.style.setProperty('--theme-transition-duration', '0.3s');
        } else {
            root.style.setProperty('--primary-rgb', '0, 102, 204');
            root.style.setProperty('--theme-transition-duration', '0.3s');
        }
    }

    // 토글 버튼 업데이트
    updateToggleButton() {
        if (!this.toggleButton) return;
        
        const thumb = this.toggleButton.querySelector('.toggle-thumb');
        const label = this.toggleButton.querySelector('.theme-label');
        
        if (thumb) {
            thumb.className = `toggle-thumb ${this.currentTheme}-theme`;
        }
        
        if (label) {
            label.textContent = this.getThemeLabel(this.currentTheme);
        }
        
        // ARIA 속성 업데이트
        this.toggleButton.setAttribute('aria-label', 
            `현재 테마: ${this.getThemeLabel(this.currentTheme)}. 클릭하여 변경`);
    }

    announceThemeToScreenReader(theme) {
        if (this.announcementElement) {
            this.announcementElement.textContent = 
                `테마가 ${this.getThemeLabel(theme)}로 변경되었습니다.`;
        }
    }

    // 유틸리티 메서드들
    getStoredTheme() {
        try {
            return localStorage.getItem('pref-theme');
        } catch (e) {
            return null;
        }
    }

    setStoredTheme(theme) {
        try {
            localStorage.setItem('pref-theme', theme);
        } catch (e) {
            console.warn('테마 설정 저장 실패:', e);
        }
    }

    getSystemTheme() {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
    }

    getThemeLabel(theme) {
        const labels = {
            light: '라이트 모드',
            dark: '다크 모드',
            auto: '시스템 설정'
        };
        return labels[theme] || '알 수 없음';
    }

    // 사용 통계 추적
    trackThemeUsage() {
        try {
            const usage = JSON.parse(localStorage.getItem('theme-usage') || '{}');
            const today = new Date().toDateString();
            
            if (!usage[today]) {
                usage[today] = { light: 0, dark: 0, auto: 0 };
            }
            
            const effectiveTheme = this.currentTheme === 'auto' ? this.systemTheme : this.currentTheme;
            usage[today][effectiveTheme]++;
            
            // 최근 30일 데이터만 유지
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            Object.keys(usage).forEach(date => {
                if (new Date(date) < thirtyDaysAgo) {
                    delete usage[date];
                }
            });
            
            localStorage.setItem('theme-usage', JSON.stringify(usage));
        } catch (e) {
            console.warn('테마 사용 통계 저장 실패:', e);
        }
    }

    trackThemeChange(theme) {
        try {
            const changes = JSON.parse(localStorage.getItem('theme-changes') || '[]');
            changes.push({
                theme,
                timestamp: Date.now(),
                from: this.currentTheme,
                method: 'manual' // 수동 변경
            });
            
            // 최근 100개 변경사항만 유지
            if (changes.length > 100) {
                changes.splice(0, changes.length - 100);
            }
            
            localStorage.setItem('theme-changes', JSON.stringify(changes));
        } catch (e) {
            console.warn('테마 변경 추적 실패:', e);
        }
    }

    // 프로그래매틱 API
    getThemeStats() {
        try {
            const usage = JSON.parse(localStorage.getItem('theme-usage') || '{}');
            const changes = JSON.parse(localStorage.getItem('theme-changes') || '[]');
            
            return {
                currentTheme: this.currentTheme,
                systemTheme: this.systemTheme,
                usage,
                changes,
                totalChanges: changes.length
            };
        } catch (e) {
            return null;
        }
    }

    setThemePreference(preference) {
        try {
            localStorage.setItem('theme-touch-gesture', preference.touchGesture ? 'true' : 'false');
            localStorage.setItem('theme-auto-switch', preference.autoSwitch ? 'true' : 'false');
            localStorage.setItem('theme-reduced-motion', preference.reducedMotion ? 'true' : 'false');
        } catch (e) {
            console.warn('테마 설정 저장 실패:', e);
        }
    }

    exportThemeData() {
        const data = {
            currentTheme: this.currentTheme,
            systemTheme: this.systemTheme,
            stats: this.getThemeStats(),
            preferences: {
                touchGesture: localStorage.getItem('theme-touch-gesture') !== 'false',
                autoSwitch: localStorage.getItem('theme-auto-switch') !== 'false',
                reducedMotion: localStorage.getItem('theme-reduced-motion') === 'true'
            },
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `theme-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// 전역 API 노출
window.AdvancedThemeToggle = AdvancedThemeToggle;

// 테마 제어 함수들 (개발자 도구에서 사용 가능)
window.setTheme = (theme) => {
    if (window.advancedThemeToggle) {
        window.advancedThemeToggle.setTheme(theme);
    }
};

window.getThemeStats = () => {
    if (window.advancedThemeToggle) {
        return window.advancedThemeToggle.getThemeStats();
    }
};

window.exportThemeData = () => {
    if (window.advancedThemeToggle) {
        window.advancedThemeToggle.exportThemeData();
    }
};

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    window.advancedThemeToggle = new AdvancedThemeToggle();
});
        : "light";
    }
    return "light";
  }

  getEffectiveTheme() {
    return this.currentTheme === "auto" ? this.systemTheme : this.currentTheme;
  }

  applyTheme(theme) {
    const effectiveTheme = theme === "auto" ? this.systemTheme : theme;
    const body = document.body;

    // 테마 클래스 적용
    body.classList.remove("light", "dark");
    body.classList.add(effectiveTheme);

    // 메타 테마 컬러 업데이트
    this.updateMetaThemeColor(effectiveTheme);

    // 커스텀 이벤트 발송
    this.dispatchThemeChangeEvent(theme, effectiveTheme);

    // 접근성 속성 업데이트
    this.updateA11yAttributes(effectiveTheme);
  }

  updateMetaThemeColor(theme) {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const color = theme === "dark" ? "#1d1e20" : "#ffffff";
      metaThemeColor.setAttribute("content", color);
    }
  }

  updateA11yAttributes(theme) {
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      const label =
        theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
  }

  dispatchThemeChangeEvent(theme, effectiveTheme) {
    const event = new CustomEvent("themechange", {
      detail: {
        theme: theme,
        effectiveTheme: effectiveTheme,
        timestamp: Date.now(),
      },
    });
    document.dispatchEvent(event);
  }

  toggleTheme() {
    // 사이클: light → dark → auto → light
    const currentIndex = this.themes.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % this.themes.length;
    this.currentTheme = this.themes[nextIndex];

    this.setStoredTheme(this.currentTheme);
    this.applyTheme(this.currentTheme);
    this.updateToggleButton();
    this.showTransitionEffect();

    // 성능 최적화: 테마 변경 로깅
    if (window.gtag) {
      window.gtag("event", "theme_change", {
        event_category: "UI",
        event_label: this.currentTheme,
        value: 1,
      });
    }
  }

  updateToggleButton() {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    const effectiveTheme = this.getEffectiveTheme();

    // 시각적 상태 업데이트
    toggle.classList.remove("theme-light", "theme-dark", "theme-auto");
    toggle.classList.add(`theme-${this.currentTheme}`);

    // 아이콘 업데이트
    this.updateToggleIcon(toggle, effectiveTheme);

    // 접근성 업데이트
    this.updateA11yAttributes(effectiveTheme);
  }

  updateToggleIcon(toggle, theme) {
    const sunIcon = toggle.querySelector("#sun");
    const moonIcon = toggle.querySelector("#moon");

    if (sunIcon && moonIcon) {
      if (theme === "dark") {
        sunIcon.style.display = "none";
        moonIcon.style.display = "block";
      } else {
        sunIcon.style.display = "block";
        moonIcon.style.display = "none";
      }
    }
  }

  showTransitionEffect() {
    // 부드러운 전환 효과
    const transition = document.createElement("div");
    transition.className = "theme-transition";
    document.body.appendChild(transition);

    // 애니메이션 트리거
    requestAnimationFrame(() => {
      transition.classList.add("active");

      setTimeout(() => {
        transition.classList.remove("active");
        setTimeout(() => {
          document.body.removeChild(transition);
        }, 400);
      }, 100);
    });
  }

  setupEventListeners() {
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleTheme();
      });

      // 터치 제스처 지원
      let touchStartY = 0;
      toggle.addEventListener(
        "touchstart",
        (e) => {
          touchStartY = e.touches[0].clientY;
        },
        { passive: true }
      );

      toggle.addEventListener(
        "touchend",
        (e) => {
          const touchEndY = e.changedTouches[0].clientY;
          const deltaY = touchStartY - touchEndY;

          // 위로 스와이프하면 테마 토글
          if (Math.abs(deltaY) > 30 && deltaY > 0) {
            e.preventDefault();
            this.toggleTheme();
          }
        },
        { passive: false }
      );
    }
  }

  setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Ctrl/Cmd + Shift + T로 테마 토글
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        this.toggleTheme();
      }

      // Alt + T로도 토글 가능
      if (e.altKey && e.key === "t") {
        e.preventDefault();
        this.toggleTheme();
      }
    });
  }

  setupSystemThemeListener() {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleSystemThemeChange = (e) => {
        this.systemTheme = e.matches ? "dark" : "light";

        // auto 모드일 때만 시스템 테마 변경에 반응
        if (this.currentTheme === "auto") {
          this.applyTheme(this.currentTheme);
          this.updateToggleButton();
        }
      };

      // 최신 브라우저
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleSystemThemeChange);
      } else {
        // 구형 브라우저 지원
        mediaQuery.addListener(handleSystemThemeChange);
      }
    }
  }

  preventFlash() {
    // FOUC (Flash of Unstyled Content) 방지
    document.documentElement.style.visibility = "visible";

    // 초기 로딩 시 깜빡임 방지
    const style = document.createElement("style");
    style.textContent = `
            * {
                transition: none !important;
            }
        `;
    document.head.appendChild(style);

    // 짧은 지연 후 전환 효과 활성화
    setTimeout(() => {
      document.head.removeChild(style);
    }, 100);
  }

  // 프로그래매틱 API
  setTheme(theme) {
    if (this.themes.includes(theme)) {
      this.currentTheme = theme;
      this.setStoredTheme(theme);
      this.applyTheme(theme);
      this.updateToggleButton();
    }
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  getEffectiveThemeInfo() {
    return {
      selected: this.currentTheme,
      effective: this.getEffectiveTheme(),
      system: this.systemTheme,
    };
  }
}

// 초기화
document.addEventListener("DOMContentLoaded", () => {
  // 기존 PaperMod 테마 토글 스크립트와 충돌 방지
  const existingToggle = document.getElementById("theme-toggle");
  if (existingToggle) {
    // 전역 인스턴스 생성
    window.themeToggle = new EnhancedThemeToggle();

    // 개발자 도구에서 사용할 수 있도록 전역 함수 등록
    window.setTheme = (theme) => window.themeToggle.setTheme(theme);
    window.getThemeInfo = () => window.themeToggle.getEffectiveThemeInfo();
  }
});

// 빠른 테마 적용 (페이지 로드 전)
(function () {
  const getStoredTheme = () => {
    try {
      return localStorage.getItem("pref-theme");
    } catch (e) {
      return null;
    }
  };

  const getSystemTheme = () => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  };

  const theme = getStoredTheme() || "auto";
  const effectiveTheme = theme === "auto" ? getSystemTheme() : theme;

  if (document.body) {
    document.body.classList.add(effectiveTheme);
  }
})();
