// SEO 최적화 시스템 (Phase 4.2)
// 구조화된 데이터, 사이트맵, Open Graph, 내부 링크 최적화

class SEOOptimizer {
  constructor() {
    this.structuredData = new StructuredDataGenerator();
    this.sitemap = new SitemapGenerator();
    this.openGraph = new OpenGraphGenerator();
    this.internalLinks = new InternalLinkOptimizer();
    this.robots = new RobotsOptimizer();

    this.init();
  }

  async init() {
    console.log("[SEO] SEO 최적화 시스템 초기화...");

    // 페이지 타입별 최적화
    if (this.isHomePage()) {
      this.optimizeHomePage();
    } else if (this.isPostPage()) {
      this.optimizePostPage();
    } else if (this.isListPage()) {
      this.optimizeListPage();
    }

    // 공통 최적화
    this.addStructuredData();
    this.optimizeMetaTags();
    this.optimizeInternalLinks();
    this.addOpenGraphMeta();
    this.improvePageSpeed();

    console.log("[SEO] 최적화 완료");
  }

  // 페이지 타입 감지
  isHomePage() {
    return (
      window.location.pathname === "/" ||
      window.location.pathname === "/index.html"
    );
  }

  isPostPage() {
    return (
      document.querySelector("article.post, .post-single") ||
      window.location.pathname.includes("/posts/")
    );
  }

  isListPage() {
    return (
      document.querySelector(".list-page, .posts-list") ||
      window.location.pathname.includes("/posts") ||
      window.location.pathname.includes("/categories") ||
      window.location.pathname.includes("/tags")
    );
  }

  // 홈페이지 최적화
  optimizeHomePage() {
    console.log("[SEO] 홈페이지 최적화 중...");

    // Website 구조화된 데이터
    this.structuredData.addWebsiteSchema();

    // Organization 스키마
    this.structuredData.addOrganizationSchema();

    // Breadcrumb 추가
    this.addBreadcrumbSchema([{ name: "Home", url: window.location.origin }]);
  }

  // 포스트 페이지 최적화
  optimizePostPage() {
    console.log("[SEO] 포스트 페이지 최적화 중...");

    // BlogPosting 구조화된 데이터
    this.structuredData.addBlogPostingSchema();

    // Article 스키마 추가
    this.structuredData.addArticleSchema();

    // FAQ 스키마 (댓글이 있는 경우)
    if (document.querySelector(".comments, .giscus")) {
      this.structuredData.addFAQSchema();
    }

    // 관련 포스트 링크 최적화
    this.optimizeRelatedPosts();

    // 읽기 시간 메타데이터
    this.addReadingTimeMetadata();
  }

  // 목록 페이지 최적화
  optimizeListPage() {
    console.log("[SEO] 목록 페이지 최적화 중...");

    // CollectionPage 스키마
    this.structuredData.addCollectionPageSchema();

    // ItemList 스키마
    this.structuredData.addItemListSchema();

    // 페이지네이션 메타데이터
    this.addPaginationMetadata();
  }

  // 구조화된 데이터 추가
  addStructuredData() {
    const schemas = this.structuredData.getAllSchemas();

    schemas.forEach((schema) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(schema);
      document.head.appendChild(script);
    });
  }

  // 메타 태그 최적화
  optimizeMetaTags() {
    // 기본 메타 태그 개선
    this.ensureMetaTag("description");
    this.ensureMetaTag("keywords");
    this.ensureMetaTag("author");

    // 캐노니컬 URL 확인
    this.ensureCanonicalUrl();

    // robots 메타 태그
    this.addRobotsMetaTag();

    // 언어 정보
    this.addLanguageMetaTags();

    // 뷰포트 최적화
    this.optimizeViewportMeta();
  }

  // 내부 링크 최적화
  optimizeInternalLinks() {
    this.internalLinks.analyzeAndOptimize();
  }

  // Open Graph 메타 추가
  addOpenGraphMeta() {
    this.openGraph.generateAndAdd();
  }

  // 페이지 속도 개선
  improvePageSpeed() {
    // DNS 프리페치
    this.addDnsPrefetch();

    // 리소스 힌트
    this.addResourceHints();

    // 중요 CSS 인라인화
    this.inlineCriticalCSS();

    // 이미지 최적화
    this.optimizeImages();
  }

  // 유틸리티 메서드들
  ensureMetaTag(name) {
    let meta = document.querySelector(`meta[name="${name}"]`);

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      document.head.appendChild(meta);
    }

    // 내용이 비어있으면 자동 생성
    if (!meta.content) {
      meta.content = this.generateMetaContent(name);
    }
  }

  generateMetaContent(name) {
    switch (name) {
      case "description":
        return this.generateDescription();
      case "keywords":
        return this.generateKeywords();
      case "author":
        return this.getAuthorName();
      default:
        return "";
    }
  }

  generateDescription() {
    // 포스트의 경우 요약 추출
    if (this.isPostPage()) {
      const content = document.querySelector("article, .post-content");
      if (content) {
        const text = content.textContent.trim();
        const firstParagraph = text.split("\n")[0];
        return firstParagraph.substring(0, 160);
      }
    }

    // 홈페이지의 경우
    return "jyukki의 개발 블로그 - 웹 개발, 프로그래밍, 기술 트렌드에 대한 인사이트를 공유합니다.";
  }

  generateKeywords() {
    const tags = Array.from(
      document.querySelectorAll(".tags a, .post-tags a")
    ).map((tag) => tag.textContent.trim());

    const defaultKeywords = [
      "개발",
      "프로그래밍",
      "웹개발",
      "JavaScript",
      "React",
      "Vue",
    ];

    return [...tags, ...defaultKeywords].slice(0, 10).join(", ");
  }

  getAuthorName() {
    return document.querySelector('meta[name="author"]')?.content || "jyukki";
  }

  ensureCanonicalUrl() {
    let canonical = document.querySelector('link[rel="canonical"]');

    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }

    canonical.href = window.location.href.split("?")[0].split("#")[0];
  }

  addRobotsMetaTag() {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content =
      "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
    document.head.appendChild(robots);
  }

  addLanguageMetaTags() {
    // hreflang 추가
    const hreflang = document.createElement("link");
    hreflang.rel = "alternate";
    hreflang.hreflang = "ko";
    hreflang.href = window.location.href;
    document.head.appendChild(hreflang);

    // 언어 메타
    if (!document.querySelector('meta[http-equiv="content-language"]')) {
      const lang = document.createElement("meta");
      lang.httpEquiv = "content-language";
      lang.content = "ko-KR";
      document.head.appendChild(lang);
    }
  }

  optimizeViewportMeta() {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !viewport.content.includes("width=device-width")) {
      viewport.content =
        "width=device-width, initial-scale=1, shrink-to-fit=no";
    }
  }

  addDnsPrefetch() {
    const domains = [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "www.google-analytics.com",
      "www.googletagmanager.com",
    ];

    domains.forEach((domain) => {
      const link = document.createElement("link");
      link.rel = "dns-prefetch";
      link.href = `//` + domain;
      document.head.appendChild(link);
    });
  }

  addResourceHints() {
    // 중요 리소스 프리로드 - 실제 사이트에서 사용하는 파일들
    const criticalResources = [
      { href: "/css/design-improvements.css", as: "style" },
      { href: "/js/blog-analytics.js", as: "script" },
    ];

    criticalResources.forEach((resource) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.href = resource.href;
      link.as = resource.as;
      document.head.appendChild(link);
    });
  }

  inlineCriticalCSS() {
    // 중요 CSS 스타일을 head에 인라인으로 추가
    const criticalCSS = `
            body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;line-height:1.6}
            .header{background:#b19cd9;color:white;padding:1rem}
            .main{max-width:1200px;margin:0 auto;padding:2rem}
            @media(max-width:768px){.main{padding:1rem}}
        `;

    const style = document.createElement("style");
    style.textContent = criticalCSS;
    document.head.appendChild(style);
  }

  optimizeImages() {
    const images = document.querySelectorAll("img");

    images.forEach((img) => {
      // loading="lazy" 추가
      if (!img.hasAttribute("loading")) {
        img.loading = "lazy";
      }

      // alt 텍스트 확인
      if (!img.alt) {
        const title = img.title || img.src.split("/").pop().split(".")[0];
        img.alt = title.replace(/[-_]/g, " ");
      }

      // 크기 속성 추가 (CLS 방지)
      if (!img.width && !img.height && img.naturalWidth) {
        img.width = img.naturalWidth;
        img.height = img.naturalHeight;
      }
    });
  }

  // 브레드크럼 스키마 추가
  addBreadcrumbSchema(breadcrumbs) {
    const schema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  // 관련 포스트 최적화
  optimizeRelatedPosts() {
    const relatedPosts = document.querySelectorAll(
      ".related-post a, .post-card a"
    );

    relatedPosts.forEach((link) => {
      // 내부 링크 속성 추가
      if (link.hostname === window.location.hostname) {
        link.rel = "related";
      }

      // 제목이 없으면 추가
      if (!link.title && link.textContent) {
        link.title = link.textContent.trim();
      }
    });
  }

  // 읽기 시간 메타데이터
  addReadingTimeMetadata() {
    const content = document.querySelector("article, .post-content");
    if (!content) return;

    const text = content.textContent.trim();
    const wordsPerMinute = 200;
    const words = text.split(/\s+/).length;
    const readingTime = Math.ceil(words / wordsPerMinute);

    // 메타 태그 추가
    const meta = document.createElement("meta");
    meta.name = "reading-time";
    meta.content = `${readingTime} minutes`;
    document.head.appendChild(meta);
  }

  // 페이지네이션 메타데이터
  addPaginationMetadata() {
    const prevLink = document.querySelector(".pagination .prev, .page-prev");
    const nextLink = document.querySelector(".pagination .next, .page-next");

    if (prevLink) {
      const prev = document.createElement("link");
      prev.rel = "prev";
      prev.href = prevLink.href;
      document.head.appendChild(prev);
    }

    if (nextLink) {
      const next = document.createElement("link");
      next.rel = "next";
      next.href = nextLink.href;
      document.head.appendChild(next);
    }
  }
}

// 구조화된 데이터 생성기
class StructuredDataGenerator {
  constructor() {
    this.schemas = [];
  }

  addWebsiteSchema() {
    const schema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: document.title.split(" | ")[1] || "jyukki's Blog",
      url: window.location.origin,
      description: this.getMetaContent("description"),
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${window.location.origin}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
      author: {
        "@type": "Person",
        name: "jyukki",
        url: window.location.origin,
      },
    };

    this.schemas.push(schema);
  }

  addOrganizationSchema() {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "jyukki's Blog",
      url: window.location.origin,
      logo: `${window.location.origin}/android-chrome-512x512.png`,
      sameAs: [
        // 소셜 미디어 링크 추가 가능
      ],
    };

    this.schemas.push(schema);
  }

  addBlogPostingSchema() {
    const title =
      document.querySelector("h1")?.textContent?.trim() || document.title;
    const content = document.querySelector("article, .post-content");
    const datePublished = this.extractDate();
    const author = this.getMetaContent("author") || "jyukki";

    if (!content) return;

    const schema = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      description: this.getMetaContent("description"),
      image: this.extractFeaturedImage(),
      author: {
        "@type": "Person",
        name: author,
        url: window.location.origin,
      },
      publisher: {
        "@type": "Organization",
        name: "jyukki's Blog",
        logo: {
          "@type": "ImageObject",
          url: `${window.location.origin}/android-chrome-512x512.png`,
        },
      },
      datePublished: datePublished,
      dateModified: datePublished,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": window.location.href,
      },
      articleBody: content.textContent.trim(),
      wordCount: content.textContent.trim().split(/\s+/).length,
      timeRequired: this.calculateReadingTime(content.textContent),
      keywords: this.extractKeywords(),
      articleSection: this.extractCategory(),
      inLanguage: "ko-KR",
    };

    this.schemas.push(schema);
  }

  addArticleSchema() {
    // Article 스키마는 BlogPosting과 유사하지만 더 일반적
    const schema = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: document.querySelector("h1")?.textContent?.trim(),
      description: this.getMetaContent("description"),
      image: this.extractFeaturedImage(),
      author: {
        "@type": "Person",
        name: this.getMetaContent("author") || "jyukki",
      },
      datePublished: this.extractDate(),
      publisher: {
        "@type": "Organization",
        name: "jyukki's Blog",
      },
    };

    this.schemas.push(schema);
  }

  addFAQSchema() {
    // 댓글을 FAQ로 구조화
    const comments = document.querySelectorAll(
      ".giscus-comment, .utterances-comment"
    );
    if (comments.length === 0) return;

    const faqItems = Array.from(comments)
      .slice(0, 5)
      .map((comment) => {
        const question = comment
          .querySelector(".comment-question, .comment-body")
          ?.textContent?.trim();
        const answer = comment
          .querySelector(".comment-answer, .comment-reply")
          ?.textContent?.trim();

        if (question && answer) {
          return {
            "@type": "Question",
            name: question,
            acceptedAnswer: {
              "@type": "Answer",
              text: answer,
            },
          };
        }
      })
      .filter(Boolean);

    if (faqItems.length > 0) {
      const schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqItems,
      };

      this.schemas.push(schema);
    }
  }

  addCollectionPageSchema() {
    const schema = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: document.title,
      description: this.getMetaContent("description"),
      url: window.location.href,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: this.countListItems(),
        itemListElement: this.extractListItems(),
      },
    };

    this.schemas.push(schema);
  }

  addItemListSchema() {
    const items = this.extractListItems();

    if (items.length > 0) {
      const schema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        numberOfItems: items.length,
        itemListElement: items,
      };

      this.schemas.push(schema);
    }
  }

  // 유틸리티 메서드들
  getMetaContent(name) {
    return document.querySelector(`meta[name="${name}"]`)?.content || "";
  }

  extractDate() {
    // 다양한 방법으로 날짜 추출
    const dateElement = document.querySelector(
      "time[datetime], .post-date, .date"
    );
    if (dateElement) {
      const datetime =
        dateElement.getAttribute("datetime") || dateElement.textContent;
      return new Date(datetime).toISOString();
    }

    // URL에서 날짜 추출 시도
    const urlDate = window.location.pathname.match(
      /\/(\d{4})\/(\d{2})\/(\d{2})\//
    );
    if (urlDate) {
      return new Date(
        `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`
      ).toISOString();
    }

    return new Date().toISOString();
  }

  extractFeaturedImage() {
    // Open Graph 이미지
    const ogImage = document.querySelector(
      'meta[property="og:image"]'
    )?.content;
    if (ogImage) return ogImage;

    // 첫 번째 이미지
    const firstImage = document.querySelector("article img, .post-content img");
    if (firstImage) return firstImage.src;

    // 기본 이미지
    return `${window.location.origin}/android-chrome-512x512.png`;
  }

  extractKeywords() {
    const keywords = this.getMetaContent("keywords");
    if (keywords) return keywords.split(",").map((k) => k.trim());

    // 태그에서 추출
    const tags = Array.from(
      document.querySelectorAll(".tags a, .post-tags a")
    ).map((tag) => tag.textContent.trim());

    return tags;
  }

  extractCategory() {
    const category = document.querySelector(".category a, .post-category a");
    return category ? category.textContent.trim() : "";
  }

  calculateReadingTime(text) {
    const wordsPerMinute = 200;
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.ceil(words / wordsPerMinute);
    return `PT${minutes}M`;
  }

  countListItems() {
    return document.querySelectorAll(".post-list li, .posts-list .post-item")
      .length;
  }

  extractListItems() {
    const items = document.querySelectorAll(
      ".post-list li, .posts-list .post-item"
    );

    return Array.from(items).map((item, index) => {
      const link = item.querySelector("a");
      const title = link ? link.textContent.trim() : item.textContent.trim();
      const url = link ? link.href : window.location.href;

      return {
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "BlogPosting",
          name: title,
          url: url,
        },
      };
    });
  }

  getAllSchemas() {
    return this.schemas;
  }
}

// Open Graph 생성기
class OpenGraphGenerator {
  generateAndAdd() {
    const ogTags = [
      { property: "og:type", content: this.getPageType() },
      { property: "og:title", content: this.getTitle() },
      { property: "og:description", content: this.getDescription() },
      { property: "og:url", content: window.location.href },
      { property: "og:image", content: this.getImage() },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "jyukki's Blog" },
      { property: "og:locale", content: "ko_KR" },
    ];

    // Twitter Cards
    const twitterTags = [
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: this.getTitle() },
      { name: "twitter:description", content: this.getDescription() },
      { name: "twitter:image", content: this.getImage() },
    ];

    // 기존 태그 제거 후 새로 추가
    this.removeExistingOGTags();

    [...ogTags, ...twitterTags].forEach((tag) => {
      const meta = document.createElement("meta");
      if (tag.property) meta.property = tag.property;
      if (tag.name) meta.name = tag.name;
      meta.content = tag.content;
      document.head.appendChild(meta);
    });
  }

  getPageType() {
    if (this.isPostPage()) return "article";
    if (this.isHomePage()) return "website";
    return "website";
  }

  getTitle() {
    return document.title || "jyukki's Blog";
  }

  getDescription() {
    return (
      document.querySelector('meta[name="description"]')?.content ||
      "jyukki의 개발 블로그 - 웹 개발과 프로그래밍에 대한 인사이트를 공유합니다."
    );
  }

  getImage() {
    // 포스트의 첫 번째 이미지
    const firstImage = document.querySelector("article img, .post-content img");
    if (firstImage && firstImage.src.startsWith("http")) {
      return firstImage.src;
    }

    // 기본 OG 이미지
    return `${window.location.origin}/images/og-default.jpg`;
  }

  removeExistingOGTags() {
    const existing = document.querySelectorAll(
      'meta[property^="og:"], meta[name^="twitter:"]'
    );
    existing.forEach((tag) => tag.remove());
  }

  isPostPage() {
    return window.location.pathname.includes("/posts/");
  }

  isHomePage() {
    return window.location.pathname === "/";
  }
}

// 내부 링크 최적화기
class InternalLinkOptimizer {
  analyzeAndOptimize() {
    const internalLinks = this.findInternalLinks();

    internalLinks.forEach((link) => {
      this.optimizeLink(link);
    });

    // 링크 분석 보고서 생성 (개발 모드)
    if (window.location.search.includes("debug=seo")) {
      this.generateLinkReport(internalLinks);
    }
  }

  findInternalLinks() {
    const links = Array.from(document.querySelectorAll("a[href]"));
    return links.filter(
      (link) =>
        link.hostname === window.location.hostname || link.href.startsWith("/")
    );
  }

  optimizeLink(link) {
    // 제목 속성 추가
    if (!link.title && link.textContent.trim()) {
      link.title = link.textContent.trim();
    }

    // 앵커 텍스트 최적화
    this.optimizeAnchorText(link);

    // rel 속성 최적화
    this.optimizeRelAttribute(link);

    // 클릭 추적 추가
    this.addClickTracking(link);
  }

  optimizeAnchorText(link) {
    const text = link.textContent.trim();

    // 의미없는 텍스트 감지
    const badTexts = [
      "여기",
      "클릭",
      "더보기",
      "here",
      "click here",
      "read more",
    ];

    if (badTexts.includes(text.toLowerCase())) {
      // 주변 컨텍스트에서 더 나은 텍스트 찾기
      const context = this.findContextualText(link);
      if (context) {
        console.warn(`[SEO] 앵커 텍스트 개선 제안: "${text}" → "${context}"`);
      }
    }
  }

  findContextualText(link) {
    // 앞뒤 텍스트에서 의미있는 내용 찾기
    const parent = link.parentElement;
    const beforeText = parent.textContent.substring(
      0,
      parent.textContent.indexOf(link.textContent)
    );
    const afterText = parent.textContent.substring(
      parent.textContent.indexOf(link.textContent) + link.textContent.length
    );

    // 간단한 컨텍스트 추출 로직
    const words = [
      ...beforeText.split(/\s+/).slice(-3),
      ...afterText.split(/\s+/).slice(0, 3),
    ];
    return words
      .filter((word) => word.length > 2)
      .join(" ")
      .substring(0, 50);
  }

  optimizeRelAttribute(link) {
    // 외부 링크가 아닌 경우 rel 제거
    if (link.hostname === window.location.hostname) {
      link.removeAttribute("rel");
    }
  }

  addClickTracking(link) {
    link.addEventListener("click", () => {
      if (window.gtag) {
        gtag("event", "internal_link_click", {
          event_category: "Navigation",
          event_label: link.href,
          value: 1,
        });
      }
    });
  }

  generateLinkReport(links) {
    const report = {
      totalLinks: links.length,
      linksWithoutTitle: links.filter((l) => !l.title).length,
      linksWithBadAnchorText: links.filter((l) =>
        ["여기", "클릭", "더보기"].includes(l.textContent.trim().toLowerCase())
      ).length,
      uniqueTargets: new Set(links.map((l) => l.href)).size,
    };

    console.group("[SEO] 내부 링크 분석 보고서");
    console.log("총 내부 링크:", report.totalLinks);
    console.log("제목 없는 링크:", report.linksWithoutTitle);
    console.log("개선 필요한 앵커 텍스트:", report.linksWithBadAnchorText);
    console.log("고유 대상 페이지:", report.uniqueTargets);
    console.groupEnd();
  }
}

// Robots.txt 최적화기
class RobotsOptimizer {
  generateOptimalRobots() {
    // robots.txt 내용 제안
    const robotsContent = `
User-agent: *
Allow: /

# Sitemaps
Sitemap: ${window.location.origin}/sitemap.xml
Sitemap: ${window.location.origin}/sitemap-posts.xml
Sitemap: ${window.location.origin}/sitemap-pages.xml

# 크롤링 속도 제한
Crawl-delay: 1

# 불필요한 경로 차단
Disallow: /admin/
Disallow: /private/
Disallow: /*.json$
Disallow: /*?print=1
Disallow: /*?share=*

# 특정 봇 최적화
User-agent: Googlebot
Allow: /
Crawl-delay: 0

User-agent: Bingbot
Allow: /
Crawl-delay: 1
        `.trim();

    console.log("[SEO] 권장 robots.txt 내용:");
    console.log(robotsContent);

    return robotsContent;
  }
}

// 사이트맵 생성기
class SitemapGenerator {
  generateSitemap() {
    // 동적 사이트맵 생성 (개발용)
    const urls = this.collectUrls();

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `
  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>
`
  )
  .join("")}
</urlset>`;

    console.log("[SEO] 동적 사이트맵 생성 완료");
    return sitemap;
  }

  collectUrls() {
    const urls = [];

    // 홈페이지
    urls.push({
      loc: window.location.origin,
      lastmod: new Date().toISOString().split("T")[0],
      changefreq: "daily",
      priority: "1.0",
    });

    // 포스트 목록
    urls.push({
      loc: `${window.location.origin}/posts/`,
      lastmod: new Date().toISOString().split("T")[0],
      changefreq: "weekly",
      priority: "0.8",
    });

    // 카테고리
    urls.push({
      loc: `${window.location.origin}/categories/`,
      lastmod: new Date().toISOString().split("T")[0],
      changefreq: "weekly",
      priority: "0.7",
    });

    // 개별 포스트 (페이지에서 찾을 수 있는 링크들)
    const postLinks = document.querySelectorAll('a[href*="/posts/"]');
    postLinks.forEach((link) => {
      if (link.hostname === window.location.hostname) {
        urls.push({
          loc: link.href,
          lastmod: new Date().toISOString().split("T")[0],
          changefreq: "monthly",
          priority: "0.6",
        });
      }
    });

    return urls;
  }
}

// 전역 초기화
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.seoOptimizer = new SEOOptimizer();
  });
} else {
  window.seoOptimizer = new SEOOptimizer();
}

// 개발자 도구 API
window.SEOAPI = {
  analyze: () => window.seoOptimizer,
  generateRobots: () => new RobotsOptimizer().generateOptimalRobots(),
  generateSitemap: () => new SitemapGenerator().generateSitemap(),
  checkStructuredData: () => {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    return Array.from(scripts).map((script) => JSON.parse(script.textContent));
  },
};

console.log("[SEO] SEO 최적화 시스템 로드 완료");
