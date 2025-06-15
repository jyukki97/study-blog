document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');

    if (!searchInput || !searchResults) return;

    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.toLowerCase();
        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        // 검색 로직 구현
        const results = [];
        // 여기에 실제 검색 로직을 구현할 수 있습니다.
        
        // 결과 표시
        searchResults.innerHTML = results.map(result => `
            <li>
                <a href="${result.url}">${result.title}</a>
            </li>
        `).join('');
    });
}); 