# Study Blog

개인 학습 블로그 프로젝트입니다. Hugo와 PaperMod 테마를 사용하여 제작되었습니다.

## 🚀 기능

- **다크/라이트 모드** - 사용자 선호도에 따른 테마 전환
- **반응형 디자인** - 모바일, 태블릿, 데스크톱 지원
- **검색 기능** - 실시간 검색 및 하이라이팅
- **프로젝트 섹션** - 진행 중인 프로젝트 관리
- **태그 시스템** - 포스트 분류 및 필터링
- **댓글 시스템** - Utterances 기반 댓글 기능
- **분석 및 통계** - Google Analytics 4 통합

## 🛠️ 기술 스택

- **정적 사이트 생성기**: Hugo
- **테마**: PaperMod
- **검색 엔진**: Fuse.js
- **댓글 시스템**: Utterances
- **분석**: Google Analytics 4
- **배포**: GitHub Pages

## 📦 설치 및 실행

1. Hugo 설치:
```bash
# macOS
brew install hugo

# Windows
choco install hugo-extended

# Linux
snap install hugo
```

2. 저장소 클론:
```bash
git clone https://github.com/[사용자명]/study-blog.git
cd study-blog
```

3. 로컬 서버 실행:
```bash
hugo server -D
```

## 📝 새 포스트 작성

```bash
hugo new posts/포스트-제목.md
```

## 🎨 커스터마이징

- `themes/PaperMod/assets/css/extended/custom.css` - 커스텀 스타일
- `layouts/partials/` - 레이아웃 수정
- `static/` - 정적 파일 (이미지, JS, CSS 등)

## 🔧 설정

`hugo.toml`에서 다음 설정을 관리할 수 있습니다:

- 사이트 메타데이터
- 메뉴 구성
- 테마 설정
- 댓글 시스템
- 분석 도구

## 📚 문서

- [Hugo 공식 문서](https://gohugo.io/documentation/)
- [PaperMod 테마 문서](https://github.com/adityatelange/hugo-PaperMod/wiki)
- [GitHub Pages 가이드](https://docs.github.com/ko/pages)

## 🤝 기여

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 📞 연락처

- GitHub: [@사용자명](https://github.com/사용자명)
- 이메일: your.email@example.com

## 🙏 감사의 말

- [Hugo](https://gohugo.io/) - 정적 사이트 생성기
- [PaperMod](https://github.com/adityatelange/hugo-PaperMod) - Hugo 테마
- [Utterances](https://utteranc.es/) - 댓글 시스템
- [Fuse.js](https://fusejs.io/) - 검색 엔진 