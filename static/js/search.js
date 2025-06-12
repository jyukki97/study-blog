// ===== 고급 검색 기능 (Phase 1.1) =====

class AdvancedSearch {
  constructor() {
    this.searchInput = document.getElementById("search-input");
    this.searchResults = document.getElementById("search-results");
    this.searchOverlay = document.getElementById("search-overlay");
    this.searchFilters = null;
    this.searchSuggestions = null;

    this.searchIndex = null;
    this.fuse = null;
    this.searchHistory = this.loadSearchHistory();
    this.currentFilter = "all";
    this.debounceTimer = null;
    this.selectedSuggestionIndex = -1;

    this.init();
  }

  async init() {
    await this.loadSearchIndex();
    this.setupFuse();
    this.createSearchInterface();
    this.setupEventListeners();
    this.setupKeyboardNavigation();
  }

  // 검색 인덱스 로드
  async loadSearchIndex() {
    try {
      const response = await fetch(window.location.pathname + "searchindex.json");
      this.searchIndex = await response.json();
    } catch (error) {
      console.error("검색 인덱스를 로드하는데 실패했습니다:", error);
      this.searchIndex = [];
    }
  }

  // Fuse.js 설정
  setupFuse() {
    if (!window.Fuse) {
      console.warn("Fuse.js가 로드되지 않았습니다. 기본 검색을 사용합니다.");
      return;
    }

    const options = {
      keys: [
        { name: "title", weight: 0.7 },
        { name: "content", weight: 0.3 },
        { name: "tags", weight: 0.5 },
        { name: "categories", weight: 0.4 },
      ],
      threshold: 0.3, // 유사도 임계값 (낮을수록 엄격)
      distance: 100, // 검색 거리
      minMatchCharLength: 2,
      includeScore: true,
      includeMatches: true,
      shouldSort: true,
      findAllMatches: true,
    };

    this.fuse = new Fuse(this.searchIndex, options);
  }

  // 고급 검색 인터페이스 생성
  createSearchInterface() {
    if (!this.searchOverlay) return;

    // 검색 필터 추가
    const filtersHTML = `
            <div id="search-filters" class="search-filters">
                <button class="filter-btn active" data-filter="all">전체</button>
                <button class="filter-btn" data-filter="posts">포스트</button>
                <button class="filter-btn" data-filter="tags">태그</button>
                <button class="filter-btn" data-filter="categories">카테고리</button>
                <button class="filter-btn" data-filter="recent">최신</button>
            </div>
        `;

    // 검색 기록 및 자동완성
    const suggestionsHTML = `
            <div id="search-suggestions" class="search-suggestions" style="display: none;">
                <div class="suggestions-header">
                    <span class="suggestions-title">검색 제안</span>
                    <button class="clear-history" title="검색 기록 삭제">🗑️</button>
                </div>
                <div class="suggestions-list"></div>
            </div>
        `;

    // 검색 결과 상단에 필터와 제안 추가
    this.searchResults.insertAdjacentHTML(
      "beforebegin",
      filtersHTML + suggestionsHTML
    );

    this.searchFilters = document.getElementById("search-filters");
    this.searchSuggestions = document.getElementById("search-suggestions");

    // 검색 통계 표시 영역 추가
    const searchStats = document.createElement("div");
    searchStats.id = "search-stats";
    searchStats.className = "search-stats";
    this.searchResults.insertAdjacentElement("beforebegin", searchStats);
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 검색 입력 이벤트
    this.searchInput?.addEventListener("input", (e) => {
      const query = e.target.value.trim();

      // 디바운싱 적용
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        if (query.length > 0) {
          this.performSearch(query);
          this.showSuggestions(query);
        } else {
          this.clearResults();
          this.hideSuggestions();
        }
      }, 300);
    });

    // 검색 필터 이벤트
    this.searchFilters?.addEventListener("click", (e) => {
      if (e.target.classList.contains("filter-btn")) {
        this.setActiveFilter(e.target.dataset.filter);
        this.performSearch(this.searchInput.value.trim());
      }
    });

    // 자동완성 클릭 이벤트
    this.searchSuggestions?.addEventListener("click", (e) => {
      if (e.target.classList.contains("suggestion-item")) {
        const suggestion = e.target.textContent;
        this.searchInput.value = suggestion;
        this.performSearch(suggestion);
        this.hideSuggestions();
      } else if (e.target.classList.contains("clear-history")) {
        this.clearSearchHistory();
      }
    });

    // 검색 오버레이 토글
    document.querySelector(".search-button")?.addEventListener("click", () => {
      this.toggleSearch();
    });

    // ESC 키로 검색 닫기
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeSearch();
        this.hideSuggestions();
      }
    });

    // 검색 오버레이 외부 클릭시 닫기
    this.searchOverlay?.addEventListener("click", (e) => {
      if (e.target === this.searchOverlay) {
        this.closeSearch();
      }
    });
  }

  // 키보드 네비게이션 설정
  setupKeyboardNavigation() {
    this.searchInput?.addEventListener("keydown", (e) => {
      const suggestions =
        this.searchSuggestions?.querySelectorAll(".suggestion-item");
      const results = this.searchResults?.querySelectorAll(
        ".search-result-item"
      );

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (
            suggestions?.length > 0 &&
            this.searchSuggestions.style.display !== "none"
          ) {
            this.navigateSuggestions(1, suggestions);
          } else if (results?.length > 0) {
            this.navigateResults(1, results);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (
            suggestions?.length > 0 &&
            this.searchSuggestions.style.display !== "none"
          ) {
            this.navigateSuggestions(-1, suggestions);
          } else if (results?.length > 0) {
            this.navigateResults(-1, results);
          }
          break;

        case "Enter":
          e.preventDefault();
          if (this.selectedSuggestionIndex >= 0 && suggestions?.length > 0) {
            const selectedSuggestion =
              suggestions[this.selectedSuggestionIndex];
            this.searchInput.value = selectedSuggestion.textContent;
            this.performSearch(selectedSuggestion.textContent);
            this.hideSuggestions();
          }
          break;

        case "Tab":
          // 탭으로 자동완성
          if (suggestions?.length > 0 && this.selectedSuggestionIndex >= 0) {
            e.preventDefault();
            const selectedSuggestion =
              suggestions[this.selectedSuggestionIndex];
            this.searchInput.value = selectedSuggestion.textContent;
          }
          break;
      }
    });
  }

  navigateSuggestions(direction, suggestions) {
    // 현재 선택 해제
    suggestions[this.selectedSuggestionIndex]?.classList.remove("selected");

    // 새 인덱스 계산
    this.selectedSuggestionIndex += direction;

    if (this.selectedSuggestionIndex < 0) {
      this.selectedSuggestionIndex = suggestions.length - 1;
    } else if (this.selectedSuggestionIndex >= suggestions.length) {
      this.selectedSuggestionIndex = 0;
    }

    // 새 선택 표시
    suggestions[this.selectedSuggestionIndex]?.classList.add("selected");
    suggestions[this.selectedSuggestionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }

  navigateResults(direction, results) {
    // 검색 결과 네비게이션 (현재는 기본 구현)
    const firstResult = results[0]?.querySelector("a");
    if (firstResult) {
      firstResult.focus();
    }
  }

  // 퍼지 검색 수행
  performSearch(query) {
    if (!query || !this.searchIndex) return;

    this.saveSearchHistory(query);

    let results;

    if (this.fuse) {
      // Fuse.js 퍼지 검색
      const fuseResults = this.fuse.search(query);
      results = fuseResults.map((result) => ({
        ...result.item,
        score: result.score,
        matches: result.matches,
      }));
    } else {
      // 기본 검색 (fallback)
      const lowerQuery = query.toLowerCase();
      results = this.searchIndex.filter((item) => {
        const title = item.title?.toLowerCase() || "";
        const content = item.content?.toLowerCase() || "";
        const tags = item.tags?.join(" ").toLowerCase() || "";
        const categories = item.categories?.join(" ").toLowerCase() || "";

        return (
          title.includes(lowerQuery) ||
          content.includes(lowerQuery) ||
          tags.includes(lowerQuery) ||
          categories.includes(lowerQuery)
        );
      });
    }

    // 필터 적용
    results = this.applyFilter(results);

    // 결과 표시
    this.displayResults(results, query);
    this.updateSearchStats(results.length, query);

    // Google Analytics 추적
    if (window.blogAnalytics) {
      window.blogAnalytics.trackSearchKeyword(query, results.length);
    }
  }

  // 필터 적용
  applyFilter(results) {
    switch (this.currentFilter) {
      case "posts":
        return results.filter(
          (item) => item.type === "post" || item.url?.includes("/posts/")
        );
      case "tags":
        return results.filter(
          (item) => item.type === "tag" || item.url?.includes("/tags/")
        );
      case "categories":
        return results.filter(
          (item) =>
            item.type === "category" || item.url?.includes("/categories/")
        );
      case "recent":
        return results
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 10);
      default:
        return results;
    }
  }

  // 검색 결과 하이라이팅과 함께 표시
  displayResults(results, query) {
    if (results.length === 0) {
      this.searchResults.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">🔍</div>
                    <h3>"${query}"에 대한 검색 결과가 없습니다</h3>
                    <p>다른 키워드로 시도해보세요.</p>
                    <div class="search-tips">
                        <strong>검색 팁:</strong>
                        <ul>
                            <li>키워드를 더 간단하게 입력해보세요</li>
                            <li>오타가 있는지 확인해보세요</li>
                            <li>동의어나 관련 용어를 사용해보세요</li>
                        </ul>
                    </div>
                </div>
            `;
      return;
    }

    const html = results
      .map((result) => {
        const highlightedTitle = this.highlightText(
          result.title || "제목 없음",
          query
        );
        const highlightedContent = this.createSmartSnippet(
          result.content || "",
          query
        );
        const resultType = this.getResultType(result);
        const date = result.date
          ? new Date(result.date).toLocaleDateString("ko-KR")
          : "";
        const tags = result.tags ? result.tags.slice(0, 3).join(", ") : "";

        return `
                <div class="search-result-item" data-type="${resultType}">
                    <div class="result-header">
                        <div class="result-type-badge">${resultType}</div>
                        ${
                          result.score
                            ? `<div class="result-score">매칭도: ${Math.round(
                                (1 - result.score) * 100
                              )}%</div>`
                            : ""
                        }
                    </div>
                    <a href="${result.url}" class="result-link">
                        <h3 class="result-title">${highlightedTitle}</h3>
                        <p class="result-content">${highlightedContent}</p>
                        <div class="result-meta">
                            ${
                              date &&
                              `<span class="result-date">📅 ${date}</span>`
                            }
                            ${
                              tags &&
                              `<span class="result-tags">🏷️ ${tags}</span>`
                            }
                        </div>
                    </a>
                </div>
            `;
      })
      .join("");

    this.searchResults.innerHTML = html;

    // 결과 애니메이션
    this.animateResults();
  }

  // 텍스트 하이라이팅 (그라데이션 효과)
  highlightText(text, query) {
    if (!query) return text;

    const regex = new RegExp(`(${query})`, "gi");
    return text.replace(
      regex,
      '<mark class="search-highlight gradient-highlight">$1</mark>'
    );
  }

  // 스마트 스니펫 생성
  createSmartSnippet(content, query) {
    if (!content) return "";

    const maxLength = 150;
    const queryWords = query.toLowerCase().split(/\s+/);

    // 키워드가 포함된 부분 찾기
    let bestMatch = "";
    let bestScore = 0;

    const sentences = content.split(/[.!?]+/);

    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      let score = 0;

      queryWords.forEach((word) => {
        if (lowerSentence.includes(word)) {
          score += word.length;
        }
      });

      if (score > bestScore && sentence.trim().length > 20) {
        bestScore = score;
        bestMatch = sentence.trim();
      }
    }

    if (bestMatch) {
      const snippet =
        bestMatch.length > maxLength
          ? bestMatch.substring(0, maxLength) + "..."
          : bestMatch;
      return this.highlightText(snippet, query);
    }

    // 기본 스니펫
    const snippet =
      content.substring(0, maxLength) +
      (content.length > maxLength ? "..." : "");
    return this.highlightText(snippet, query);
  }

  getResultType(result) {
    if (result.url?.includes("/posts/")) return "포스트";
    if (result.url?.includes("/tags/")) return "태그";
    if (result.url?.includes("/categories/")) return "카테고리";
    return "페이지";
  }

  // 검색 제안 표시
  showSuggestions(query) {
    if (!query || query.length < 2) {
      this.hideSuggestions();
      return;
    }

    const suggestions = this.generateSuggestions(query);

    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    const suggestionsHTML = suggestions
      .map(
        (suggestion) => `
            <div class="suggestion-item">
                <span class="suggestion-text">${this.highlightText(
                  suggestion.text,
                  query
                )}</span>
                <span class="suggestion-type">${suggestion.type}</span>
            </div>
        `
      )
      .join("");

    const suggestionsList =
      this.searchSuggestions?.querySelector(".suggestions-list");
    if (suggestionsList) {
      suggestionsList.innerHTML = suggestionsHTML;
      this.searchSuggestions.style.display = "block";
      this.selectedSuggestionIndex = -1;
    }
  }

  generateSuggestions(query) {
    const suggestions = [];
    const lowerQuery = query.toLowerCase();

    // 검색 기록에서 제안
    this.searchHistory.forEach((historyItem) => {
      if (
        historyItem.toLowerCase().includes(lowerQuery) &&
        historyItem !== query
      ) {
        suggestions.push({
          text: historyItem,
          type: "최근 검색",
        });
      }
    });

    // 인덱스에서 제안
    if (this.searchIndex) {
      this.searchIndex.forEach((item) => {
        // 제목에서 제안
        if (
          item.title?.toLowerCase().includes(lowerQuery) &&
          !suggestions.some((s) => s.text === item.title)
        ) {
          suggestions.push({
            text: item.title,
            type: "제목",
          });
        }

        // 태그에서 제안
        if (item.tags) {
          item.tags.forEach((tag) => {
            if (
              tag.toLowerCase().includes(lowerQuery) &&
              !suggestions.some((s) => s.text === tag)
            ) {
              suggestions.push({
                text: tag,
                type: "태그",
              });
            }
          });
        }
      });
    }

    return suggestions.slice(0, 8); // 최대 8개 제안
  }

  hideSuggestions() {
    if (this.searchSuggestions) {
      this.searchSuggestions.style.display = "none";
      this.selectedSuggestionIndex = -1;
    }
  }

  // 검색 통계 업데이트
  updateSearchStats(resultCount, query) {
    const searchStats = document.getElementById("search-stats");
    if (searchStats) {
      const filterText =
        this.currentFilter === "all"
          ? "전체"
          : this.currentFilter === "posts"
          ? "포스트"
          : this.currentFilter === "tags"
          ? "태그"
          : this.currentFilter === "categories"
          ? "카테고리"
          : "최신";

      searchStats.innerHTML = `
                <div class="stats-info">
                    "<strong>${query}</strong>" 검색 결과 <strong>${resultCount}</strong>개 (${filterText})
                </div>
            `;
    }
  }

  // 결과 애니메이션
  animateResults() {
    const resultItems = this.searchResults?.querySelectorAll(
      ".search-result-item"
    );
    if (resultItems) {
      resultItems.forEach((item, index) => {
        item.style.opacity = "0";
        item.style.transform = "translateY(20px)";

        setTimeout(() => {
          item.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          item.style.opacity = "1";
          item.style.transform = "translateY(0)";
        }, index * 50);
      });
    }
  }

  // 필터 설정
  setActiveFilter(filter) {
    this.currentFilter = filter;

    // 활성 필터 UI 업데이트
    this.searchFilters?.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    this.searchFilters
      ?.querySelector(`[data-filter="${filter}"]`)
      ?.classList.add("active");
  }

  // 검색 기록 관리
  loadSearchHistory() {
    try {
      return JSON.parse(localStorage.getItem("search_history") || "[]");
    } catch (e) {
      return [];
    }
  }

  saveSearchHistory(query) {
    if (!query || query.length < 2) return;

    // 중복 제거 및 최신 순 정렬
    this.searchHistory = this.searchHistory.filter((item) => item !== query);
    this.searchHistory.unshift(query);

    // 최대 50개만 유지
    if (this.searchHistory.length > 50) {
      this.searchHistory = this.searchHistory.slice(0, 50);
    }

    try {
      localStorage.setItem(
        "search_history",
        JSON.stringify(this.searchHistory)
      );
    } catch (e) {
      console.warn("검색 기록 저장 실패:", e);
    }
  }

  clearSearchHistory() {
    this.searchHistory = [];
    localStorage.removeItem("search_history");
    this.hideSuggestions();

    // 알림 표시
    if (window.showNotification) {
      window.showNotification("검색 기록이 삭제되었습니다.", "success");
    }
  }

  // 검색 오버레이 제어
  toggleSearch() {
    this.searchOverlay?.classList?.toggle("active");
    if (this.searchOverlay?.classList?.contains("active")) {
      this.searchInput?.focus();
    } else {
      this.hideSuggestions();
    }
  }

  closeSearch() {
    this.searchOverlay?.classList.remove("active");
    this.hideSuggestions();
  }

  clearResults() {
    if (this.searchResults) {
      this.searchResults.innerHTML = "";
    }

    const searchStats = document.getElementById("search-stats");
    if (searchStats) {
      searchStats.innerHTML = "";
    }
  }
}

// 전역 검색 함수 (다른 스크립트에서 사용 가능)
window.performSearch = function (query) {
  if (window.advancedSearch) {
    window.advancedSearch.performSearch(query);
    return (
      window.advancedSearch.searchResults?.querySelectorAll(
        ".search-result-item"
      ) || []
    );
  }
  return [];
};

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  window.advancedSearch = new AdvancedSearch();
});

// 키보드 단축키 (Ctrl+K로 검색 열기)
document.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    if (window.advancedSearch) {
      window.advancedSearch.toggleSearch();
    }
  }
});
