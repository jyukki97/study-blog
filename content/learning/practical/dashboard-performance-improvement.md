---
title: "관리자 콘솔 속도 개선기"
date: 2025-01-16
topic: "Performance"
topic_icon: "⚡"
topic_description: "대시보드 로딩 시간 80% 단축 실전 최적화"
tags: ["Performance", "React", "Optimization", "Frontend", "Backend"]
categories: ["Performance", "Frontend"]
draft: true
---

## 개요

관리자 콘솔의 초기 로딩 시간이 8초를 넘어 운영팀의 불만이 쏟아졌습니다. 3개월에 걸친 최적화 작업으로 로딩 시간을 80% 단축(8.5초 → 1.7초)시킨 경험을 공유합니다.

## 초기 문제 상황

### 성능 지표 (Before)

```
초기 로딩 시간: 8.5초
Time to Interactive (TTI): 12.3초
First Contentful Paint (FCP): 3.2초
Largest Contentful Paint (LCP): 6.8초
Cumulative Layout Shift (CLS): 0.35

Bundle Size: 3.8MB (gzipped: 1.2MB)
API 응답 시간: 평균 2.3초
Database 쿼리 수: 평균 45개/요청
```

### 사용자 피드백

> "페이지 로딩이 너무 느려서 새로고침을 여러 번 하게 됩니다."
>
> "필터 변경할 때마다 몇 초씩 걸려서 업무 효율이 떨어집니다."
>
> "대시보드 열 때마다 커피 한 잔 마실 시간이에요."

## 1단계: 성능 측정 및 분석

### Chrome DevTools Performance 프로파일링

```javascript
// 성능 측정 유틸리티
class PerformanceMonitor {
    constructor() {
        this.marks = new Map();
    }

    start(name) {
        performance.mark(`${name}-start`);
        this.marks.set(name, Date.now());
    }

    end(name) {
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);

        const duration = Date.now() - this.marks.get(name);
        console.log(`⏱️ ${name}: ${duration}ms`);

        // 프로덕션에서는 모니터링 서비스로 전송
        if (process.env.NODE_ENV === 'production') {
            this.sendToMonitoring(name, duration);
        }

        return duration;
    }

    sendToMonitoring(name, duration) {
        // Google Analytics, Datadog 등으로 전송
        if (window.gtag) {
            window.gtag('event', 'timing_complete', {
                name: name,
                value: duration,
                event_category: 'Performance'
            });
        }
    }
}

const perfMonitor = new PerformanceMonitor();

// 사용 예시
function Dashboard() {
    useEffect(() => {
        perfMonitor.start('dashboard-render');

        return () => {
            perfMonitor.end('dashboard-render');
        };
    }, []);

    // ...
}
```

### Bundle Analyzer로 번들 크기 분석

```bash
# webpack-bundle-analyzer 설치
npm install --save-dev webpack-bundle-analyzer

# package.json에 스크립트 추가
{
  "scripts": {
    "analyze": "webpack-bundle-analyzer build/bundle-stats.json"
  }
}

# 분석 실행
npm run build
npm run analyze
```

**분석 결과:**
```
Total Bundle Size: 3.8MB
├─ moment.js: 720KB (19%)          ← ❌ 너무 큼!
├─ lodash: 580KB (15%)             ← ❌ 전체 import
├─ chart.js: 450KB (12%)           ← ❌ 사용하지 않는 차트 포함
├─ react-icons: 380KB (10%)        ← ❌ 모든 아이콘 import
├─ antd: 620KB (16%)               ← ⚠️  컴포넌트별 import 필요
└─ 기타: 1.05MB (28%)
```

### Lighthouse 감사

```bash
# Lighthouse CLI 설치
npm install -g lighthouse

# 감사 실행
lighthouse https://admin.example.com \
  --output html \
  --output-path ./lighthouse-report.html \
  --only-categories=performance

# 결과
Performance Score: 28/100 ❌
├─ First Contentful Paint: 3.2s
├─ Largest Contentful Paint: 6.8s
├─ Time to Interactive: 12.3s
├─ Speed Index: 7.1s
└─ Total Blocking Time: 2,340ms
```

## 2단계: Frontend 최적화

### 2-1. 번들 크기 최적화

#### moment.js → day.js 교체

```javascript
// ❌ Before: moment.js (720KB)
import moment from 'moment';

const formatDate = (date) => moment(date).format('YYYY-MM-DD HH:mm:ss');
const isAfter = (date1, date2) => moment(date1).isAfter(date2);

// ✅ After: day.js (8KB)
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(customParseFormat);
dayjs.extend(relativeTime);

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss');
const isAfter = (date1, date2) => dayjs(date1).isAfter(date2);

// 절감: 712KB (99% 감소)
```

#### lodash Tree Shaking

```javascript
// ❌ Before: 전체 lodash import (580KB)
import _ from 'lodash';

const uniqUsers = _.uniqBy(users, 'id');
const groupedOrders = _.groupBy(orders, 'status');

// ✅ After: 필요한 함수만 import
import uniqBy from 'lodash/uniqBy';
import groupBy from 'lodash/groupBy';

const uniqUsers = uniqBy(users, 'id');
const groupedOrders = groupBy(orders, 'status');

// 절감: 560KB (96% 감소)
```

#### react-icons 최적화

```javascript
// ❌ Before: 모든 아이콘 import (380KB)
import * as FaIcons from 'react-icons/fa';

<FaIcons.FaUser />
<FaIcons.FaHome />

// ✅ After: 필요한 아이콘만 import
import { FaUser, FaHome } from 'react-icons/fa';

<FaUser />
<FaHome />

// 절감: 360KB (95% 감소)
```

#### Ant Design 컴포넌트 최적화

```javascript
// ❌ Before: 전체 Ant Design import
import { Button, Table, Modal, Form } from 'antd';
import 'antd/dist/antd.css';  // 전체 스타일 (620KB)

// ✅ After: 필요한 컴포넌트만 import
import Button from 'antd/lib/button';
import Table from 'antd/lib/table';
import Modal from 'antd/lib/modal';
import Form from 'antd/lib/form';

import 'antd/lib/button/style/css';
import 'antd/lib/table/style/css';
import 'antd/lib/modal/style/css';
import 'antd/lib/form/style/css';

// 또는 babel-plugin-import 사용
// .babelrc
{
  "plugins": [
    ["import", {
      "libraryName": "antd",
      "libraryDirectory": "lib",
      "style": "css"
    }]
  ]
}

// 절감: 420KB (68% 감소)
```

**번들 크기 최적화 결과:**
```
Before: 3.8MB
After: 1.2MB
절감: 2.6MB (68% 감소)
```

### 2-2. Code Splitting 및 Lazy Loading

```javascript
// ❌ Before: 모든 페이지 한 번에 로드
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import OrderManagement from './pages/OrderManagement';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

function App() {
    return (
        <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/orders" element={<OrderManagement />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
        </Routes>
    );
}

// ✅ After: Route 기반 Code Splitting
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const OrderManagement = lazy(() => import('./pages/OrderManagement'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
    return (
        <Routes>
            <Route
                path="/"
                element={
                    <Suspense fallback={<PageLoader />}>
                        <Dashboard />
                    </Suspense>
                }
            />
            <Route
                path="/users"
                element={
                    <Suspense fallback={<PageLoader />}>
                        <UserManagement />
                    </Suspense>
                }
            />
            {/* ... */}
        </Routes>
    );
}

// 초기 번들 크기: 1.2MB → 320KB (73% 감소)
```

#### 컴포넌트 레벨 Lazy Loading

```javascript
// 무거운 Chart 컴포넌트는 필요할 때만 로드
const HeavyChart = lazy(() => import('./components/HeavyChart'));

function Dashboard() {
    const [showChart, setShowChart] = useState(false);

    return (
        <div>
            <button onClick={() => setShowChart(true)}>
                차트 보기
            </button>

            {showChart && (
                <Suspense fallback={<ChartLoader />}>
                    <HeavyChart data={chartData} />
                </Suspense>
            )}
        </div>
    );
}
```

### 2-3. React 렌더링 최적화

#### useMemo와 useCallback 활용

```javascript
// ❌ Before: 매번 재계산
function UserList({ users, filters }) {
    // users가 변하지 않아도 매번 필터링 실행
    const filteredUsers = users.filter(user =>
        user.name.includes(filters.name) &&
        user.status === filters.status
    );

    // 매번 새 함수 생성
    const handleUserClick = (userId) => {
        console.log('User clicked:', userId);
    };

    return (
        <div>
            {filteredUsers.map(user => (
                <UserCard
                    key={user.id}
                    user={user}
                    onClick={handleUserClick}  // 매번 새 props
                />
            ))}
        </div>
    );
}

// ✅ After: 메모이제이션
function UserList({ users, filters }) {
    // filters가 변할 때만 재계산
    const filteredUsers = useMemo(() =>
        users.filter(user =>
            user.name.includes(filters.name) &&
            user.status === filters.status
        ),
        [users, filters]
    );

    // 함수 재사용
    const handleUserClick = useCallback((userId) => {
        console.log('User clicked:', userId);
    }, []);

    return (
        <div>
            {filteredUsers.map(user => (
                <UserCard
                    key={user.id}
                    user={user}
                    onClick={handleUserClick}
                />
            ))}
        </div>
    );
}
```

#### React.memo로 불필요한 리렌더링 방지

```javascript
// ❌ Before: 부모가 리렌더링되면 모든 자식도 리렌더링
const UserCard = ({ user, onClick }) => {
    console.log('UserCard rendered:', user.id);
    return (
        <div onClick={() => onClick(user.id)}>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
        </div>
    );
};

// ✅ After: props가 변하지 않으면 리렌더링 스킵
const UserCard = React.memo(({ user, onClick }) => {
    console.log('UserCard rendered:', user.id);
    return (
        <div onClick={() => onClick(user.id)}>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
        </div>
    );
}, (prevProps, nextProps) => {
    // true 반환 시 리렌더링 스킵
    return prevProps.user.id === nextProps.user.id &&
           prevProps.user.name === nextProps.user.name &&
           prevProps.user.email === nextProps.user.email;
});
```

#### 가상화 (Virtualization)

```javascript
// ❌ Before: 10,000개 항목 전부 렌더링
function UserList({ users }) {
    return (
        <div>
            {users.map(user => (
                <UserCard key={user.id} user={user} />
            ))}
        </div>
    );
}
// 렌더링 시간: ~3000ms

// ✅ After: react-window로 가상화
import { FixedSizeList } from 'react-window';

function UserList({ users }) {
    const Row = ({ index, style }) => (
        <div style={style}>
            <UserCard user={users[index]} />
        </div>
    );

    return (
        <FixedSizeList
            height={600}
            itemCount={users.length}
            itemSize={80}
            width="100%"
        >
            {Row}
        </FixedSizeList>
    );
}
// 렌더링 시간: ~50ms (98% 개선)
```

## 3단계: Backend API 최적화

### 3-1. N+1 쿼리 문제 해결

```java
// ❌ Before: N+1 쿼리 발생
@GetMapping("/api/orders")
public List<OrderResponse> getOrders() {
    List<Order> orders = orderRepository.findAll(); // 1번 쿼리

    return orders.stream()
        .map(order -> {
            // 각 주문마다 추가 쿼리 (N번)
            User user = userRepository.findById(order.getUserId()).orElseThrow();
            List<OrderItem> items = orderItemRepository.findByOrderId(order.getId());

            return OrderResponse.builder()
                .order(order)
                .user(user)
                .items(items)
                .build();
        })
        .collect(Collectors.toList());
}

// 1,000개 주문 → 2,001번 쿼리 (1 + 1000 + 1000)
// API 응답 시간: 2.3초

// ✅ After: Fetch Join으로 한 번에 조회
@GetMapping("/api/orders")
public List<OrderResponse> getOrders() {
    // 한 번의 쿼리로 모든 데이터 조회
    List<Order> orders = orderRepository.findAllWithUserAndItems();

    return orders.stream()
        .map(OrderResponse::from)
        .collect(Collectors.toList());
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o " +
           "JOIN FETCH o.user " +
           "LEFT JOIN FETCH o.items")
    List<Order> findAllWithUserAndItems();
}

// 1,000개 주문 → 1번 쿼리
// API 응답 시간: 0.3초 (87% 개선)
```

### 3-2. 페이지네이션 최적화

```java
// ❌ Before: 전체 데이터 조회 후 메모리에서 페이징
@GetMapping("/api/users")
public List<UserResponse> getUsers(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size) {

    List<User> allUsers = userRepository.findAll(); // 100만 건 조회!

    return allUsers.stream()
        .skip(page * size)
        .limit(size)
        .map(UserResponse::from)
        .collect(Collectors.toList());
}

// ✅ After: DB 레벨 페이징
@GetMapping("/api/users")
public Page<UserResponse> getUsers(
        @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
        Pageable pageable) {

    Page<User> users = userRepository.findAll(pageable);

    return users.map(UserResponse::from);
}

// 쿼리: SELECT * FROM users ORDER BY created_at DESC LIMIT 20 OFFSET 0
// 응답 시간: 2.1초 → 0.08초 (96% 개선)
```

### 3-3. 캐싱 전략

```java
// Redis 캐싱 적용
@Service
@RequiredArgsConstructor
public class DashboardService {
    private final OrderRepository orderRepository;
    private final RedisTemplate<String, Object> redisTemplate;

    // ❌ Before: 매번 DB 조회
    public DashboardStats getStats() {
        return DashboardStats.builder()
            .totalOrders(orderRepository.count())
            .todayOrders(orderRepository.countByCreatedAtAfter(LocalDate.now()))
            .revenue(orderRepository.sumTotalAmount())
            .build();
    }
    // 응답 시간: 450ms

    // ✅ After: Redis 캐싱 (5분 TTL)
    @Cacheable(value = "dashboard:stats", unless = "#result == null")
    public DashboardStats getStats() {
        return DashboardStats.builder()
            .totalOrders(orderRepository.count())
            .todayOrders(orderRepository.countByCreatedAtAfter(LocalDate.now()))
            .revenue(orderRepository.sumTotalAmount())
            .build();
    }
    // 첫 요청: 450ms, 이후 요청: 8ms (98% 개선)
}

// Spring Cache 설정
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(5))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer()
                )
            );

        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(config)
            .build();
    }
}
```

### 3-4. 데이터베이스 인덱스 추가

```sql
-- 문제: 주문 검색 쿼리가 느림
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE user_id = 12345
  AND status = 'COMPLETED'
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 20;

-- 결과: Seq Scan on orders (cost=0.00..150382.45 rows=1234 width=287) (actual time=2341.234..2341.567 rows=15 loops=1)
-- 실행 시간: 2.3초 ❌

-- 해결: 복합 인덱스 추가
CREATE INDEX idx_orders_user_status_created
ON orders (user_id, status, created_at DESC);

-- 다시 실행
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE user_id = 12345
  AND status = 'COMPLETED'
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 20;

-- 결과: Index Scan using idx_orders_user_status_created on orders (cost=0.43..12.67 rows=15 width=287) (actual time=0.045..0.068 rows=15 loops=1)
-- 실행 시간: 0.07초 ✅ (97% 개선)
```

### 3-5. 쿼리 최적화

```java
// ❌ Before: 여러 번 조회
@GetMapping("/api/dashboard/summary")
public DashboardSummary getSummary() {
    Long totalUsers = userRepository.count();
    Long activeUsers = userRepository.countByStatus("ACTIVE");
    Long totalOrders = orderRepository.count();
    BigDecimal revenue = orderRepository.sumTotalAmount();
    Long pendingOrders = orderRepository.countByStatus("PENDING");

    return new DashboardSummary(totalUsers, activeUsers, totalOrders, revenue, pendingOrders);
}
// 5번 쿼리, 응답 시간: 850ms

// ✅ After: 단일 쿼리로 통합
@GetMapping("/api/dashboard/summary")
public DashboardSummary getSummary() {
    return dashboardRepository.getSummary();
}

@Repository
public interface DashboardRepository extends JpaRepository<Dashboard, Long> {

    @Query("""
        SELECT new com.example.dto.DashboardSummary(
            (SELECT COUNT(u) FROM User u),
            (SELECT COUNT(u) FROM User u WHERE u.status = 'ACTIVE'),
            (SELECT COUNT(o) FROM Order o),
            (SELECT COALESCE(SUM(o.totalAmount), 0) FROM Order o),
            (SELECT COUNT(o) FROM Order o WHERE o.status = 'PENDING')
        )
        """)
    DashboardSummary getSummary();
}
// 1번 쿼리, 응답 시간: 120ms (86% 개선)
```

## 4단계: 추가 최적화

### 4-1. 이미지 최적화

```javascript
// ❌ Before: 원본 이미지 사용
<img src="/images/user-avatar.jpg" />  // 2.5MB

// ✅ After: WebP + srcset + lazy loading
<picture>
    <source
        type="image/webp"
        srcset="
            /images/user-avatar-small.webp 300w,
            /images/user-avatar-medium.webp 600w,
            /images/user-avatar-large.webp 1200w
        "
        sizes="(max-width: 600px) 300px, (max-width: 1200px) 600px, 1200px"
    />
    <img
        src="/images/user-avatar.jpg"
        alt="User Avatar"
        loading="lazy"
    />
</picture>
// 이미지 크기: 2.5MB → 85KB (97% 감소)
```

### 4-2. 폰트 최적화

```css
/* ❌ Before: 전체 폰트 로드 */
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100;300;400;500;700;900&display=swap');
/* 다운로드 크기: 1.2MB */

/* ✅ After: 필요한 weight만 로드 + subset */
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap&subset=korean');
/* 다운로드 크기: 180KB (85% 감소) */

/* font-display: swap으로 FOIT 방지 */
@font-face {
    font-family: 'Noto Sans KR';
    font-display: swap;
    /* ... */
}
```

### 4-3. Gzip/Brotli 압축

```nginx
# nginx 설정
http {
    # Gzip 압축
    gzip on;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;

    # Brotli 압축 (더 효율적)
    brotli on;
    brotli_comp_level 6;
    brotli_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;
}

# 압축 효과
# main.js (압축 전): 1.2MB
# main.js (Gzip): 320KB (73% 감소)
# main.js (Brotli): 280KB (77% 감소)
```

### 4-4. Service Worker 캐싱

```javascript
// public/service-worker.js
const CACHE_NAME = 'dashboard-v1.0.0';
const urlsToCache = [
    '/',
    '/static/css/main.css',
    '/static/js/main.js',
    '/static/images/logo.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // 캐시에 있으면 캐시 반환, 없으면 네트워크 요청
                return response || fetch(event.request);
            })
    );
});

// 재방문 시 로딩 시간: 1.7초 → 0.3초 (82% 개선)
```

## 최종 성과 측정

### Before vs After

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 초기 로딩 시간 | 8.5초 | 1.7초 | 80% ⬇️ |
| Time to Interactive | 12.3초 | 2.4초 | 80% ⬇️ |
| First Contentful Paint | 3.2초 | 0.8초 | 75% ⬇️ |
| Largest Contentful Paint | 6.8초 | 1.5초 | 78% ⬇️ |
| Cumulative Layout Shift | 0.35 | 0.02 | 94% ⬇️ |
| Bundle Size (gzipped) | 1.2MB | 280KB | 77% ⬇️ |
| API 평균 응답 시간 | 2.3초 | 0.15초 | 93% ⬇️ |
| Lighthouse Score | 28 | 92 | 229% ⬆️ |

### 사용자 만족도

```
Before:
- CSAT (고객 만족도): 42%
- 페이지 이탈률: 38%
- 평균 세션 시간: 2분 15초

After:
- CSAT: 87% (107% 증가)
- 페이지 이탈률: 12% (68% 감소)
- 평균 세션 시간: 8분 30초 (278% 증가)
```

### 비즈니스 임팩트

```
운영 효율성:
- 주문 처리 시간: 45초 → 8초 (82% 단축)
- 일일 처리 가능 주문 수: 500건 → 2,800건 (460% 증가)

비용 절감:
- 서버 리소스 사용량: 65% → 28% (57% 감소)
- 월간 클라우드 비용: $8,500 → $3,200 (62% 절감)
- 연간 절감액: $63,600
```

## 성능 모니터링 체계

### Real User Monitoring (RUM)

```javascript
// performance-monitoring.js
import { useEffect } from 'react';

export function usePerformanceMonitoring() {
    useEffect(() => {
        // Core Web Vitals 측정
        if ('web-vital' in window) {
            import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
                getCLS(sendToAnalytics);
                getFID(sendToAnalytics);
                getFCP(sendToAnalytics);
                getLCP(sendToAnalytics);
                getTTFB(sendToAnalytics);
            });
        }

        // Navigation Timing API
        window.addEventListener('load', () => {
            const perfData = window.performance.timing;
            const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
            const connectTime = perfData.responseEnd - perfData.requestStart;
            const renderTime = perfData.domComplete - perfData.domLoading;

            sendToAnalytics({
                name: 'page_load',
                value: pageLoadTime,
                connect_time: connectTime,
                render_time: renderTime
            });
        });
    }, []);
}

function sendToAnalytics(metric) {
    // Google Analytics, Datadog, New Relic 등으로 전송
    if (window.gtag) {
        window.gtag('event', metric.name, {
            value: Math.round(metric.value),
            metric_id: metric.id,
            metric_value: metric.value,
            metric_delta: metric.delta
        });
    }
}
```

### 성능 알람 설정

```yaml
# Prometheus Alert Rules
groups:
  - name: dashboard_performance
    rules:
      # API 응답 시간 알람
      - alert: APIResponseTimeSlow
        expr: http_request_duration_seconds{job="dashboard-api"} > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API response time is slow"
          description: "{{ $labels.endpoint }} is taking {{ $value }}s to respond"

      # Frontend 로딩 시간 알람
      - alert: PageLoadTimeSlow
        expr: page_load_time_seconds > 3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Page load time is slow"
          description: "Page is taking {{ $value }}s to load"
```

## 체크리스트

### Frontend 최적화
- [ ] Bundle 크기 분석 (webpack-bundle-analyzer)
- [ ] Tree Shaking 적용
- [ ] Code Splitting (Route 기반)
- [ ] Lazy Loading (컴포넌트)
- [ ] React.memo, useMemo, useCallback 활용
- [ ] 가상화 (react-window, react-virtualized)
- [ ] 이미지 최적화 (WebP, lazy loading)
- [ ] 폰트 최적화
- [ ] Service Worker 캐싱

### Backend 최적화
- [ ] N+1 쿼리 제거
- [ ] 페이지네이션 적용
- [ ] Redis 캐싱
- [ ] 데이터베이스 인덱스 추가
- [ ] 쿼리 최적화
- [ ] API 응답 압축 (Gzip/Brotli)
- [ ] Connection Pool 튜닝

### 모니터링
- [ ] Lighthouse 정기 감사
- [ ] Real User Monitoring (RUM)
- [ ] 성능 알람 설정
- [ ] 성능 대시보드 구축

## 결론

### 핵심 교훈

1. **측정부터 시작**: 추측이 아닌 데이터 기반 최적화
2. **점진적 개선**: Big Bang 대신 단계적 접근
3. **지속적 모니터링**: 최적화는 일회성이 아닌 지속적 과정
4. **사용자 경험 우선**: 기술 스펙보다 실제 사용자 체감 속도

### 우선순위 가이드

```
High Priority (즉시 실행):
1. Bundle 크기 최적화 (가장 큰 impact)
2. N+1 쿼리 제거
3. Code Splitting

Medium Priority (2주 내):
4. React 렌더링 최적화
5. 데이터베이스 인덱스
6. Redis 캐싱

Low Priority (여유 있을 때):
7. 이미지/폰트 최적화
8. Service Worker
9. 고급 캐싱 전략
```

성능 최적화는 사용자 경험과 비즈니스 가치에 직결되는 투자입니다. 작은 개선도 쌓이면 큰 차이를 만듭니다. 측정하고, 개선하고, 다시 측정하세요.
