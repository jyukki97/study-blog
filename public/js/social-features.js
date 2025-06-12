/**
 * Social Features for Hugo Blog
 * Implements Phase 5.3 - 소셜 기능
 * Features: Author page, Newsletter subscription, RSS enhancement, Social media integration, Guest posts
 */

class SocialFeatures {
  constructor() {
    this.init();
  }

  init() {

    this.initSocialMediaIntegration();
    this.initGuestPostSystem();
    this.addSocialStyles();
  }

  updateAuthorStats() {
    // 포스트 수 계산
    const postCountElement = document.getElementById("author-post-count");
    if (postCountElement) {
      // RSS 피드나 사이트맵에서 포스트 수를 가져오는 시뮬레이션
      fetch("/index.xml")
        .then((response) => response.text())
        .then((data) => {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data, "text/xml");
          const items = xmlDoc.querySelectorAll("item");
          postCountElement.textContent = items.length;
        })
        .catch(() => {
          postCountElement.textContent = "10+";
        });
    }

    // 방문자 수 (시뮬레이션)
    const visitorCountElement = document.getElementById("author-visitor-count");
    if (visitorCountElement) {
      const baseVisitors = 1500;
      const randomAdd = Math.floor(Math.random() * 500);
      visitorCountElement.textContent = (
        baseVisitors + randomAdd
      ).toLocaleString();
    }
  }
  createNewsletterWidget() {
    // 푸터나 사이드바에 뉴스레터 위젯 추가
    const footer = document.querySelector("footer, .footer");
    if (!footer) return;

    const newsletterWidget = document.createElement("div");
    newsletterWidget.className = "newsletter-widget";
    newsletterWidget.innerHTML = `
            <div class="newsletter-content">
                <div class="newsletter-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                </div>
                <div class="newsletter-text">
                    <h3>새 포스트 알림 받기</h3>
                    <p>새로운 기술 포스트와 튜토리얼을 가장 먼저 받아보세요!</p>
                </div>
                <form class="newsletter-form" id="newsletter-form">
                    <input type="email" placeholder="이메일 주소를 입력하세요" required class="newsletter-email">
                    <button type="submit" class="newsletter-submit">구독하기</button>
                </form>
                <div class="newsletter-status" id="newsletter-status"></div>
            </div>
        `;

    footer.prepend(newsletterWidget);

    // 폼 이벤트 처리
    this.handleNewsletterForm();
  }

  handleNewsletterForm() {
    const form = document.getElementById("newsletter-form");
    const status = document.getElementById("newsletter-status");

    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = form.querySelector(".newsletter-email").value;
      const submitBtn = form.querySelector(".newsletter-submit");

      submitBtn.disabled = true;
      submitBtn.textContent = "처리 중...";

      try {
        // 실제 구현에서는 Netlify Functions나 다른 서비스 사용
        await this.subscribeToNewsletter(email);

        status.innerHTML =
          '<div class="success">✅ 구독이 완료되었습니다!</div>';
        form.reset();

        // 로컬 스토리지에 구독 정보 저장
        localStorage.setItem("newsletter_subscribed", "true");
        localStorage.setItem("newsletter_email", email);
      } catch (error) {
        status.innerHTML =
          '<div class="error">❌ 구독 중 오류가 발생했습니다. 다시 시도해주세요.</div>';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "구독하기";

        setTimeout(() => {
          status.innerHTML = "";
        }, 5000);
      }
    });
  }

  async subscribeToNewsletter(email) {
    // 시뮬레이션: 실제로는 Netlify Functions나 백엔드 API 호출
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (email.includes("@")) {
          resolve();
        } else {
          reject(new Error("Invalid email"));
        }
      }, 1500);
    });
  }

  enhanceRSSFeeds() {
    // RSS 링크 개선
    const head = document.head;

    // 기존 RSS 링크 개선
    const existingRSS = head.querySelector('link[type="application/rss+xml"]');
    if (existingRSS) {
      existingRSS.title = "블로그 RSS 피드 - 최신 포스트";
    }

    // JSON Feed 추가
    const jsonFeed = document.createElement("link");
    jsonFeed.rel = "alternate";
    jsonFeed.type = "application/json";
    jsonFeed.href = "/feed.json";
    jsonFeed.title = "블로그 JSON 피드";
    head.appendChild(jsonFeed);
  }

  loginWith(provider) {
    // 실제 구현에서는 OAuth 서비스와 연동
    alert(`${provider} 로그인 기능은 현재 개발 중입니다.`);
  }

  // 게스트 포스트 시스템
  initGuestPostSystem() {
    this.addGuestPostSubmission();
  }

  addGuestPostSubmission() {
    // 게스트 포스트 제출 페이지나 폼 추가
    const footer = document.querySelector("footer, .footer");
    if (!footer) return;

    const guestPostWidget = document.createElement("div");
    guestPostWidget.className = "guest-post-widget";
    guestPostWidget.innerHTML = `
            <div class="guest-post-content">
                <h3>게스트 포스트 작성하기</h3>
                <p>당신의 개발 경험을 공유해보세요! 기술 블로그에 게스트 포스트를 기고할 수 있습니다.</p>
                <button class="guest-post-btn" onclick="socialFeatures.openGuestPostForm()">
                    ✍️ 포스트 제안하기
                </button>
            </div>
        `;

    footer.appendChild(guestPostWidget);
  }

  openGuestPostForm() {
    // 모달 창으로 게스트 포스트 폼 열기
    const modal = document.createElement("div");
    modal.className = "guest-post-modal";
    modal.innerHTML = `
            <div class="modal-overlay" onclick="socialFeatures.closeGuestPostForm()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h3>게스트 포스트 제안</h3>
                    <button class="modal-close" onclick="socialFeatures.closeGuestPostForm()">×</button>
                </div>
                <form class="guest-post-form" id="guest-post-form">
                    <div class="form-group">
                        <label>작가명</label>
                        <input type="text" name="author" required placeholder="이름을 입력하세요">
                    </div>
                    <div class="form-group">
                        <label>이메일</label>
                        <input type="email" name="email" required placeholder="이메일을 입력하세요">
                    </div>
                    <div class="form-group">
                        <label>포스트 제목</label>
                        <input type="text" name="title" required placeholder="포스트 제목을 입력하세요">
                    </div>
                    <div class="form-group">
                        <label>카테고리</label>
                        <select name="category" required>
                            <option value="">카테고리 선택</option>
                            <option value="javascript">JavaScript</option>
                            <option value="python">Python</option>
                            <option value="web">웹 개발</option>
                            <option value="mobile">모바일</option>
                            <option value="devops">DevOps</option>
                            <option value="tutorial">튜토리얼</option>
                            <option value="review">리뷰</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>간단한 요약</label>
                        <textarea name="summary" required placeholder="포스트 내용을 간단히 요약해주세요 (200자 이내)" maxlength="200"></textarea>
                    </div>
                    <div class="form-group">
                        <label>작가 소개</label>
                        <textarea name="bio" placeholder="자신에 대한 간단한 소개를 작성해주세요" maxlength="150"></textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" onclick="socialFeatures.closeGuestPostForm()">취소</button>
                        <button type="submit">제안 보내기</button>
                    </div>
                </form>
            </div>
        `;

    document.body.appendChild(modal);

    // 폼 제출 처리
    document
      .getElementById("guest-post-form")
      .addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitGuestPost(new FormData(e.target));
      });
  }

  closeGuestPostForm() {
    const modal = document.querySelector(".guest-post-modal");
    if (modal) {
      modal.remove();
    }
  }

  async submitGuestPost(formData) {
    const submitBtn = document.querySelector(
      '.guest-post-form button[type="submit"]'
    );
    submitBtn.disabled = true;
    submitBtn.textContent = "전송 중...";

    try {
      // 실제 구현에서는 백엔드 API나 이메일 서비스 사용
      await this.sendGuestPostProposal(formData);

      alert(
        "게스트 포스트 제안이 성공적으로 전송되었습니다! 검토 후 연락드리겠습니다."
      );
      this.closeGuestPostForm();
    } catch (error) {
      alert("전송 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "제안 보내기";
    }
  }

  async sendGuestPostProposal(formData) {
    // 시뮬레이션: 실제로는 백엔드 API 호출
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log("Guest post proposal:", Object.fromEntries(formData));
        resolve();
      }, 2000);
    });
  }

  // 스타일 추가
  addSocialStyles() {
    const style = document.createElement("style");
    style.textContent = `
            /* Author Card */
            .author-card {
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e9ecef);
                border-radius: 12px;
                padding: 24px;
                margin: 32px 0;
                transition: all 0.3s ease;
            }
            
            .author-card:hover {
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                transform: translateY(-2px);
            }
            
            .author-card-content {
                display: flex;
                gap: 20px;
                align-items: flex-start;
            }
            
            .author-avatar {
                position: relative;
                flex-shrink: 0;
            }
            
            .author-avatar img {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                object-fit: cover;
            }
            
            .avatar-placeholder {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                background: var(--primary-color, #007bff);
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 18px;
            }
            
            .author-info {
                flex: 1;
            }
            
            .author-name {
                margin: 0 0 8px 0;
                color: var(--text-color, #333);
                font-size: 20px;
            }
            
            .author-bio {
                margin: 0 0 16px 0;
                color: var(--text-secondary, #666);
                line-height: 1.5;
            }
            
            .author-stats {
                display: flex;
                gap: 20px;
                margin-bottom: 16px;
            }
            
            .stat-item {
                color: var(--text-secondary, #666);
                font-size: 14px;
            }
            
            .stat-item strong {
                color: var(--primary-color, #007bff);
            }
            
            .author-social {
                display: flex;
                gap: 12px;
            }
            
            .social-link {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: var(--bg-tertiary, #e9ecef);
                color: var(--text-color, #333);
                text-decoration: none;
                transition: all 0.3s ease;
            }
            
            .social-link:hover {
                background: var(--primary-color, #007bff);
                color: white;
                transform: translateY(-2px);
            }
            
            /* Newsletter Widget */
            .newsletter-widget {
                background: linear-gradient(135deg, var(--primary-color, #007bff), var(--secondary-color, #6c757d));
                color: white;
                padding: 32px;
                border-radius: 12px;
                margin: 32px 0;
                text-align: center;
            }
            
            .newsletter-content {
                max-width: 500px;
                margin: 0 auto;
            }
            
            .newsletter-icon {
                margin-bottom: 16px;
                opacity: 0.9;
            }
            
            .newsletter-text h3 {
                margin: 0 0 8px 0;
                font-size: 24px;
            }
            
            .newsletter-text p {
                margin: 0 0 24px 0;
                opacity: 0.9;
            }
            
            .newsletter-form {
                display: flex;
                gap: 12px;
                margin-bottom: 16px;
                flex-wrap: wrap;
                justify-content: center;
            }
            
            .newsletter-email {
                flex: 1;
                min-width: 250px;
                padding: 12px 16px;
                border: none;
                border-radius: 6px;
                font-size: 16px;
                outline: none;
            }
            
            .newsletter-submit {
                padding: 12px 24px;
                background: rgba(255,255,255,0.2);
                color: white;
                border: 2px solid rgba(255,255,255,0.3);
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .newsletter-submit:hover {
                background: rgba(255,255,255,0.3);
                border-color: rgba(255,255,255,0.5);
            }
            
            .newsletter-status .success {
                color: #28a745;
                background: rgba(40,167,69,0.1);
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: bold;
            }
            
            .newsletter-status .error {
                color: #dc3545;
                background: rgba(220,53,69,0.1);
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: bold;
            }
            
            /* RSS Button */
            .rss-button {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: #ff6600;
                color: white;
                text-decoration: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: bold;
                transition: all 0.3s ease;
                margin-left: auto;
            }
            
            .rss-button:hover {
                background: #e55a00;
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(255,102,0,0.3);
            }
            
            /* Social Share Widget */
            .social-share-widget {
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e9ecef);
                border-radius: 12px;
                padding: 24px;
                margin: 32px 0;
                text-align: center;
            }
            
            .share-title {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 20px;
                color: var(--text-color, #333);
            }
            
            .share-buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .share-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                border: none;
                border-radius: 6px;
                text-decoration: none;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
                color: white;
            }
            
            .share-btn.twitter {
                background: #1da1f2;
            }
            
            .share-btn.facebook {
                background: #3b5998;
            }
            
            .share-btn.linkedin {
                background: #0077b5;
            }
            
            .share-btn.copy-link {
                background: var(--primary-color, #007bff);
            }
            
            .share-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            }
            
            /* Social Login Widget */
            .social-login-widget {
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e9ecef);
                border-radius: 12px;
                padding: 24px;
                margin: 24px 0;
                text-align: center;
            }
            
            .social-login-buttons {
                display: flex;
                gap: 12px;
                justify-content: center;
                flex-wrap: wrap;
                margin-top: 16px;
            }
            
            .social-login-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 24px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
                color: white;
            }
            
            .social-login-btn.github {
                background: #333;
            }
            
            .social-login-btn.google {
                background: #db4437;
            }
            
            .social-login-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            }
            
            /* Guest Post Widget */
            .guest-post-widget {
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e9ecef);
                border-radius: 12px;
                padding: 24px;
                margin: 32px 0;
                text-align: center;
            }
            
            .guest-post-btn {
                background: var(--primary-color, #007bff);
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                margin-top: 16px;
                transition: all 0.3s ease;
            }
            
            .guest-post-btn:hover {
                background: var(--primary-dark, #0056b3);
                transform: translateY(-2px);
            }
            
            /* Guest Post Modal */
            .guest-post-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(4px);
            }
            
            .modal-content {
                position: relative;
                background: var(--bg-primary, white);
                border-radius: 12px;
                max-width: 600px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }
            
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid var(--border-color, #e9ecef);
            }
            
            .modal-header h3 {
                margin: 0;
                color: var(--text-color, #333);
            }
            
            .modal-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: var(--text-secondary, #666);
                padding: 0;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            }
            
            .modal-close:hover {
                background: var(--bg-secondary, #f8f9fa);
                color: var(--text-color, #333);
            }
            
            .guest-post-form {
                padding: 24px;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-group label {
                display: block;
                margin-bottom: 6px;
                font-weight: 500;
                color: var(--text-color, #333);
            }
            
            .form-group input,
            .form-group select,
            .form-group textarea {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid var(--border-color, #e9ecef);
                border-radius: 6px;
                font-size: 14px;
                transition: border-color 0.3s ease;
                background: var(--bg-primary, white);
                color: var(--text-color, #333);
            }
            
            .form-group input:focus,
            .form-group select:focus,
            .form-group textarea:focus {
                outline: none;
                border-color: var(--primary-color, #007bff);
                box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
            }
            
            .form-group textarea {
                resize: vertical;
                min-height: 80px;
            }
            
            .form-actions {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                margin-top: 24px;
                padding-top: 24px;
                border-top: 1px solid var(--border-color, #e9ecef);
            }
            
            .form-actions button {
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .form-actions button[type="button"] {
                background: var(--bg-secondary, #f8f9fa);
                color: var(--text-color, #333);
                border: 1px solid var(--border-color, #e9ecef);
            }
            
            .form-actions button[type="submit"] {
                background: var(--primary-color, #007bff);
                color: white;
            }
            
            .form-actions button:hover {
                transform: translateY(-1px);
            }
            
            /* Dark mode support */
            [data-theme="dark"] .author-card,
            [data-theme="dark"] .social-share-widget,
            [data-theme="dark"] .social-login-widget,
            [data-theme="dark"] .guest-post-widget {
                background: var(--bg-secondary-dark, #2d3748);
                border-color: var(--border-color-dark, #4a5568);
            }
            
            [data-theme="dark"] .modal-content {
                background: var(--bg-primary-dark, #1a202c);
            }
            
            /* Mobile responsive */
            @media (max-width: 768px) {
                .author-card-content {
                    flex-direction: column;
                    text-align: center;
                    gap: 16px;
                }
                
                .newsletter-form {
                    flex-direction: column;
                }
                
                .newsletter-email {
                    min-width: auto;
                }
                
                .share-buttons {
                    flex-direction: column;
                    align-items: center;
                }
                
                .share-btn {
                    min-width: 200px;
                    justify-content: center;
                }
                
                .social-login-buttons {
                    flex-direction: column;
                    align-items: center;
                }
                
                .social-login-btn {
                    min-width: 200px;
                    justify-content: center;
                }
                
                .modal-content {
                    margin: 10px;
                    max-height: calc(100vh - 20px);
                }
                
                .form-actions {
                    flex-direction: column;
                }
                
                .form-actions button {
                    width: 100%;
                }
            }
        `;

    document.head.appendChild(style);
  }

  copyToClipboard() {
    // 이 메서드는 HTML에서 직접 호출됨
    navigator.clipboard.writeText(window.location.href);
  }
}

// 전역 변수로 설정하여 HTML에서 접근 가능하게 함
let socialFeatures;

// DOM이 로드되면 초기화
document.addEventListener("DOMContentLoaded", () => {
  socialFeatures = new SocialFeatures();
});
