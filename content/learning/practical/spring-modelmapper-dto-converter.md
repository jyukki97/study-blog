---
title: "Spring + ModelMapper로 DTO 변환기 설계"
date: 2025-01-16
topic: "Backend"
topic_icon: "🔄"
topic_description: "Entity-DTO 자동 변환 및 매핑 전략"
tags: ["Spring", "ModelMapper", "DTO", "Design Pattern", "Performance"]
categories: ["Backend", "Spring"]
draft: true
---

## 개요

실무에서 Entity와 DTO 간 변환은 반복적이고 지루한 작업입니다. ModelMapper를 활용하면 보일러플레이트 코드를 줄이고, 유지보수성을 높일 수 있습니다. 실제 프로젝트에서 겪은 문제와 해결 방법을 공유합니다.

## 왜 DTO가 필요한가?

### Entity를 직접 노출하면 안 되는 이유

```java
// ❌ 나쁜 예: Entity를 Controller에서 직접 반환
@RestController
public class UserController {
    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.getUser(id);
    }
}

@Entity
public class User {
    @Id
    private Long id;
    private String email;
    private String password; // ← 비밀번호까지 노출!
    private String ssn; // ← 민감정보 노출!

    @OneToMany(fetch = FetchType.LAZY)
    private List<Order> orders; // ← 무한 로딩, 순환 참조 위험
}
```

**문제점:**
1. **보안**: 민감정보(password, ssn) 노출
2. **성능**: Lazy Loading으로 인한 N+1 쿼리 또는 무한 로딩
3. **순환 참조**: Order → User → Order... 무한 반복
4. **결합도**: API 스펙이 DB 스키마에 종속됨
5. **API 버전 관리**: Entity 변경 시 API 변경 강제됨

### DTO를 사용한 올바른 방법

```java
// ✅ 좋은 예: DTO로 명확한 계약 정의
@RestController
public class UserController {
    @GetMapping("/users/{id}")
    public UserResponse getUser(@PathVariable Long id) {
        User user = userService.getUser(id);
        return UserResponse.from(user);
    }
}

public class UserResponse {
    private Long id;
    private String email;
    private String nickname;
    private LocalDateTime createdAt;

    // 민감정보 제외
    // 필요한 필드만 포함
    // API 스펙과 DB 스키마 분리

    public static UserResponse from(User user) {
        UserResponse response = new UserResponse();
        response.setId(user.getId());
        response.setEmail(user.getEmail());
        response.setNickname(user.getNickname());
        response.setCreatedAt(user.getCreatedAt());
        return response;
    }
}
```

**장점:**
1. **보안**: 필요한 필드만 노출
2. **성능**: 명확한 데이터 범위 제어
3. **유지보수**: API 스펙과 DB 스키마 독립적 관리
4. **문서화**: DTO 자체가 API 스펙 문서 역할

## ModelMapper 기본 사용법

### 1. 의존성 추가

```groovy
// build.gradle
dependencies {
    implementation 'org.modelmapper:modelmapper:3.1.1'
}
```

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.modelmapper</groupId>
    <artifactId>modelmapper</artifactId>
    <version>3.1.1</version>
</dependency>
```

### 2. ModelMapper 설정

```java
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // 기본 설정
        modelMapper.getConfiguration()
            // Matching 전략: STANDARD (기본값)
            .setMatchingStrategy(MatchingStrategies.STANDARD)

            // Private 필드 접근 허용
            .setFieldAccessLevel(Configuration.AccessLevel.PRIVATE)

            // null 값은 매핑하지 않음 (기존 값 유지)
            .setSkipNullEnabled(true)

            // 애매한 매핑은 에러 발생 (명확성)
            .setAmbiguityIgnored(false)

            // 필드 매칭 활성화
            .setFieldMatchingEnabled(true);

        return modelMapper;
    }
}
```

### 3. 기본 사용 예시

```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;
    private final ModelMapper modelMapper;

    public UserResponse getUser(Long id) {
        User user = userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));

        // Entity → DTO 변환
        return modelMapper.map(user, UserResponse.class);
    }

    public User createUser(UserCreateRequest request) {
        // DTO → Entity 변환
        User user = modelMapper.map(request, User.class);
        return userRepository.save(user);
    }
}
```

## Matching 전략

ModelMapper는 3가지 매칭 전략을 제공합니다.

### 1. STANDARD (기본값)

```java
// 지능적으로 매칭, 대부분의 경우 잘 작동
modelMapper.getConfiguration()
    .setMatchingStrategy(MatchingStrategies.STANDARD);

// 예시
class Source {
    private String userName;        // ← 매칭됨
    private String userEmail;       // ← 매칭됨
    private Address userAddress;    // ← 매칭됨
}

class Destination {
    private String name;      // userName → name
    private String email;     // userEmail → email
    private Address address;  // userAddress → address
}
```

### 2. STRICT

```java
// 완전히 일치하는 이름만 매칭 (가장 안전)
modelMapper.getConfiguration()
    .setMatchingStrategy(MatchingStrategies.STRICT);

// 예시
class Source {
    private String userName;   // ← 매칭 안됨! (이름이 다름)
    private String name;       // ← 매칭됨
}

class Destination {
    private String name;       // name ← name만 매칭
}
```

### 3. LOOSE

```java
// 느슨한 매칭, 일부만 일치해도 매칭 (위험)
modelMapper.getConfiguration()
    .setMatchingStrategy(MatchingStrategies.LOOSE);

// 예시
class Source {
    private String name;           // ← 매칭됨
    private String description;    // ← 매칭됨
}

class Destination {
    private String userName;       // name → userName (위험!)
    private String desc;           // description → desc (위험!)
}

// ⚠️ 의도하지 않은 매칭 발생 가능성 높음
```

**권장사항:**
- 기본적으로 **STANDARD** 사용
- 복잡한 변환은 **명시적 TypeMap** 정의
- **LOOSE**는 피하는 것이 좋음 (예측 불가능한 동작)

## 커스텀 매핑 설정

### 1. PropertyMap을 활용한 명시적 매핑

```java
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // User → UserResponse 커스텀 매핑
        modelMapper.addMappings(new PropertyMap<User, UserResponse>() {
            @Override
            protected void configure() {
                // 필드명이 다른 경우
                map().setNickname(source.getUsername());

                // 중첩 객체 매핑
                map().setCity(source.getAddress().getCity());
                map().setStreet(source.getAddress().getStreet());

                // 계산된 값 매핑
                using(ctx -> calculateAge((LocalDate) ctx.getSource()))
                    .map(source.getBirthDate()).setAge(null);

                // 특정 필드 제외
                skip().setInternalId(null);
            }
        });

        // Order → OrderResponse 매핑
        modelMapper.addMappings(new PropertyMap<Order, OrderResponse>() {
            @Override
            protected void configure() {
                // Enum → String 변환
                using(ctx -> ((OrderStatus) ctx.getSource()).name())
                    .map(source.getStatus()).setStatusText(null);

                // Collection 매핑
                map().setItemCount(source.getItems().size());

                // 조건부 매핑
                when(ctx -> ctx.getSource() != null)
                    .map(source.getPayment().getAmount())
                    .setTotalAmount(null);
            }
        });

        return modelMapper;
    }

    private Integer calculateAge(LocalDate birthDate) {
        return Period.between(birthDate, LocalDate.now()).getYears();
    }
}
```

### 2. Converter를 활용한 복잡한 변환

```java
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // LocalDateTime → String 변환
        Converter<LocalDateTime, String> toStringDate = ctx ->
            ctx.getSource() != null ?
            ctx.getSource().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME) : null;

        modelMapper.addConverter(toStringDate);

        // Money 객체 → BigDecimal 변환
        Converter<Money, BigDecimal> moneyToBigDecimal = ctx ->
            ctx.getSource() != null ? ctx.getSource().getAmount() : null;

        modelMapper.addConverter(moneyToBigDecimal);

        // List<Tag> → String (콤마로 구분)
        Converter<List<Tag>, String> tagsToString = ctx -> {
            if (ctx.getSource() == null) return null;
            return ctx.getSource().stream()
                .map(Tag::getName)
                .collect(Collectors.joining(", "));
        };

        modelMapper.addConverter(tagsToString);

        return modelMapper;
    }
}
```

### 3. TypeMap을 활용한 세밀한 제어

```java
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // TypeMap 생성
        TypeMap<User, UserDetailResponse> typeMap =
            modelMapper.createTypeMap(User.class, UserDetailResponse.class);

        // 조건부 매핑
        typeMap.addMappings(mapper -> {
            // VIP 고객만 전화번호 노출
            mapper.when(ctx -> {
                User user = (User) ctx.getSource();
                return user.isVip();
            }).map(src -> src.getPhone(), UserDetailResponse::setPhone);

            // 활성 사용자만 이메일 노출
            mapper.when(ctx -> {
                User user = (User) ctx.getSource();
                return user.isActive();
            }).map(src -> src.getEmail(), UserDetailResponse::setEmail);
        });

        // Converter 추가
        typeMap.addMapping(
            src -> calculateMembershipDays(src.getCreatedAt()),
            UserDetailResponse::setMembershipDays
        );

        return modelMapper;
    }

    private Long calculateMembershipDays(LocalDateTime createdAt) {
        return ChronoUnit.DAYS.between(createdAt, LocalDateTime.now());
    }
}
```

## 실전 패턴

### 1. Mapper 인터페이스 패턴

```java
// Generic Mapper 인터페이스
public interface DtoMapper<E, D> {
    D toDto(E entity);
    E toEntity(D dto);
    List<D> toDtoList(List<E> entities);
    List<E> toEntityList(List<D> dtos);
}

// 구현체
@Component
@RequiredArgsConstructor
public class UserMapper implements DtoMapper<User, UserResponse> {
    private final ModelMapper modelMapper;

    @Override
    public UserResponse toDto(User entity) {
        return modelMapper.map(entity, UserResponse.class);
    }

    @Override
    public User toEntity(UserResponse dto) {
        return modelMapper.map(dto, User.class);
    }

    @Override
    public List<UserResponse> toDtoList(List<User> entities) {
        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    @Override
    public List<User> toEntityList(List<UserResponse> dtos) {
        return dtos.stream()
            .map(this::toEntity)
            .collect(Collectors.toList());
    }

    // 커스텀 매핑 메서드
    public UserDetailResponse toDetailDto(User entity) {
        UserDetailResponse dto = modelMapper.map(entity, UserDetailResponse.class);

        // 추가 로직
        dto.setOrderCount(entity.getOrders().size());
        dto.setTotalSpent(calculateTotalSpent(entity));

        return dto;
    }

    private BigDecimal calculateTotalSpent(User user) {
        return user.getOrders().stream()
            .map(Order::getTotalAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

### 2. Converter 유틸리티 패턴

```java
@Component
@RequiredArgsConstructor
public class DtoConverter {
    private final ModelMapper modelMapper;

    // Generic 변환 메서드
    public <S, D> D convert(S source, Class<D> destinationType) {
        return source != null ?
               modelMapper.map(source, destinationType) : null;
    }

    // Collection 변환 메서드
    public <S, D> List<D> convertList(List<S> source, Class<D> destinationType) {
        return source != null ?
               source.stream()
                   .map(element -> convert(element, destinationType))
                   .collect(Collectors.toList()) : null;
    }

    // Page 변환 메서드 (Spring Data)
    public <S, D> Page<D> convertPage(Page<S> source, Class<D> destinationType) {
        return source.map(element -> convert(element, destinationType));
    }

    // 부분 업데이트 (null 필드는 건너뛰기)
    public <S, D> void updateEntity(S source, D destination) {
        modelMapper.getConfiguration().setSkipNullEnabled(true);
        modelMapper.map(source, destination);
    }
}
```

### 3. Service 계층에서 활용

```java
@Service
@RequiredArgsConstructor
public class OrderService {
    private final OrderRepository orderRepository;
    private final DtoConverter dtoConverter;

    @Transactional(readOnly = true)
    public Page<OrderResponse> getOrders(Pageable pageable) {
        Page<Order> orders = orderRepository.findAll(pageable);

        // Page 변환
        return dtoConverter.convertPage(orders, OrderResponse.class);
    }

    @Transactional
    public OrderResponse createOrder(OrderCreateRequest request) {
        // DTO → Entity
        Order order = dtoConverter.convert(request, Order.class);

        // 비즈니스 로직
        order.calculateTotalAmount();
        order.setStatus(OrderStatus.PENDING);

        // 저장
        Order savedOrder = orderRepository.save(order);

        // Entity → DTO
        return dtoConverter.convert(savedOrder, OrderResponse.class);
    }

    @Transactional
    public OrderResponse updateOrder(Long id, OrderUpdateRequest request) {
        Order order = orderRepository.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));

        // 부분 업데이트 (null 값은 무시)
        dtoConverter.updateEntity(request, order);

        return dtoConverter.convert(order, OrderResponse.class);
    }
}
```

## 복잡한 시나리오 처리

### 1. 중첩 객체 매핑

```java
// Entity
@Entity
public class Order {
    @Id
    private Long id;

    @ManyToOne
    private User user;

    @OneToMany(mappedBy = "order")
    private List<OrderItem> items;

    @Embedded
    private Address deliveryAddress;
}

@Entity
public class OrderItem {
    @Id
    private Long id;

    @ManyToOne
    private Order order;

    @ManyToOne
    private Product product;

    private Integer quantity;
    private BigDecimal price;
}

// DTO
public class OrderResponse {
    private Long id;
    private String userName;          // user.name
    private String userEmail;         // user.email
    private String deliveryCity;      // deliveryAddress.city
    private String deliveryStreet;    // deliveryAddress.street
    private List<OrderItemDto> items;
    private BigDecimal totalAmount;
}

public class OrderItemDto {
    private Long productId;       // product.id
    private String productName;   // product.name
    private Integer quantity;
    private BigDecimal price;
    private BigDecimal subtotal;  // quantity * price
}

// ModelMapper 설정
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // Order → OrderResponse
        modelMapper.addMappings(new PropertyMap<Order, OrderResponse>() {
            @Override
            protected void configure() {
                // 중첩 객체 펼치기
                map(source.getUser().getName()).setUserName(null);
                map(source.getUser().getEmail()).setUserEmail(null);
                map(source.getDeliveryAddress().getCity()).setDeliveryCity(null);
                map(source.getDeliveryAddress().getStreet()).setDeliveryStreet(null);

                // Collection 자동 매핑
                map(source.getItems()).setItems(null);

                // 계산된 값
                using(ctx -> calculateTotal((Order) ctx.getSource()))
                    .map(source).setTotalAmount(null);
            }
        });

        // OrderItem → OrderItemDto
        modelMapper.addMappings(new PropertyMap<OrderItem, OrderItemDto>() {
            @Override
            protected void configure() {
                map(source.getProduct().getId()).setProductId(null);
                map(source.getProduct().getName()).setProductName(null);

                using(ctx -> {
                    OrderItem item = (OrderItem) ctx.getSource();
                    return item.getPrice().multiply(
                        BigDecimal.valueOf(item.getQuantity())
                    );
                }).map(source).setSubtotal(null);
            }
        });

        return modelMapper;
    }

    private BigDecimal calculateTotal(Order order) {
        return order.getItems().stream()
            .map(item -> item.getPrice().multiply(
                BigDecimal.valueOf(item.getQuantity())
            ))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

### 2. 상속 구조 매핑

```java
// Entity (상속)
@Entity
@Inheritance(strategy = InheritanceType.JOINED)
public abstract class Payment {
    @Id
    private Long id;
    private BigDecimal amount;
    private LocalDateTime paidAt;
}

@Entity
public class CardPayment extends Payment {
    private String cardNumber;
    private String cardType;
}

@Entity
public class BankTransferPayment extends Payment {
    private String bankName;
    private String accountNumber;
}

// DTO (상속 없이 평탄화)
public class PaymentResponse {
    private Long id;
    private BigDecimal amount;
    private LocalDateTime paidAt;
    private String paymentType;
    private Map<String, String> details;
}

// Converter
@Component
@RequiredArgsConstructor
public class PaymentMapper {
    private final ModelMapper modelMapper;

    public PaymentResponse toDto(Payment payment) {
        PaymentResponse dto = modelMapper.map(payment, PaymentResponse.class);

        // 타입별 처리
        if (payment instanceof CardPayment cardPayment) {
            dto.setPaymentType("CARD");
            dto.setDetails(Map.of(
                "cardNumber", maskCardNumber(cardPayment.getCardNumber()),
                "cardType", cardPayment.getCardType()
            ));
        } else if (payment instanceof BankTransferPayment bankPayment) {
            dto.setPaymentType("BANK_TRANSFER");
            dto.setDetails(Map.of(
                "bankName", bankPayment.getBankName(),
                "accountNumber", maskAccountNumber(bankPayment.getAccountNumber())
            ));
        }

        return dto;
    }

    private String maskCardNumber(String cardNumber) {
        return cardNumber.replaceAll("\\d(?=\\d{4})", "*");
    }

    private String maskAccountNumber(String accountNumber) {
        return accountNumber.substring(0, 3) + "****" +
               accountNumber.substring(accountNumber.length() - 3);
    }
}
```

### 3. 양방향 관계 처리

```java
// Entity (양방향 관계)
@Entity
public class Post {
    @Id
    private Long id;
    private String title;

    @OneToMany(mappedBy = "post")
    private List<Comment> comments;
}

@Entity
public class Comment {
    @Id
    private Long id;
    private String content;

    @ManyToOne
    private Post post; // ← 순환 참조 위험!
}

// DTO (순환 참조 방지)
public class PostResponse {
    private Long id;
    private String title;
    private List<CommentResponse> comments;
}

public class CommentResponse {
    private Long id;
    private String content;
    // Post는 포함하지 않음 (순환 참조 방지)
}

// ModelMapper 설정
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // 깊이 제한 설정
        modelMapper.getConfiguration()
            .setPropertyCondition(context ->
                !(context.getMapping().getLastDestinationProperty()
                    .getType().equals(Post.class))
            );

        // Comment → CommentResponse (post 필드 제외)
        TypeMap<Comment, CommentResponse> typeMap =
            modelMapper.createTypeMap(Comment.class, CommentResponse.class);

        typeMap.addMappings(mapper -> {
            mapper.skip(CommentResponse::setPost); // post 필드 건너뛰기
        });

        return modelMapper;
    }
}
```

## 성능 최적화

### 1. ModelMapper 캐싱

```java
@Configuration
public class ModelMapperConfig {

    @Bean
    public ModelMapper modelMapper() {
        ModelMapper modelMapper = new ModelMapper();

        // TypeMap 캐싱 활성화 (기본값: true)
        modelMapper.getConfiguration()
            .setPreferNestedProperties(false) // 성능 개선
            .setDeepCopyEnabled(false); // 얕은 복사로 성능 향상

        // 자주 사용하는 매핑 미리 등록 (초기화 시간 증가하지만 런타임 성능 향상)
        modelMapper.createTypeMap(User.class, UserResponse.class);
        modelMapper.createTypeMap(Order.class, OrderResponse.class);
        modelMapper.createTypeMap(Product.class, ProductResponse.class);

        return modelMapper;
    }
}
```

### 2. Batch 변환 최적화

```java
@Service
@RequiredArgsConstructor
public class OptimizedOrderService {
    private final OrderRepository orderRepository;
    private final ModelMapper modelMapper;

    // ❌ 비효율적: N+1 문제
    public List<OrderResponse> getOrdersBad() {
        List<Order> orders = orderRepository.findAll();

        return orders.stream()
            .map(order -> modelMapper.map(order, OrderResponse.class))
            .collect(Collectors.toList());
        // 각 Order마다 User, Items 조회 → N+1 쿼리 발생!
    }

    // ✅ 효율적: Fetch Join + Batch 변환
    @Transactional(readOnly = true)
    public List<OrderResponse> getOrdersGood() {
        // 한 번에 모든 연관 엔티티 조회
        List<Order> orders = orderRepository.findAllWithUserAndItems();

        // Batch 변환 (이미 모든 데이터가 메모리에 있음)
        return orders.stream()
            .map(order -> modelMapper.map(order, OrderResponse.class))
            .collect(Collectors.toList());
    }
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o " +
           "JOIN FETCH o.user " +
           "LEFT JOIN FETCH o.items i " +
           "LEFT JOIN FETCH i.product")
    List<Order> findAllWithUserAndItems();
}
```

### 3. 성능 비교

| 방법 | 100건 변환 시간 | 1000건 변환 시간 | 장점 | 단점 |
|------|---------------|-----------------|------|------|
| 수동 매핑 | 5ms | 45ms | 가장 빠름, 명확함 | 코드 많음, 유지보수 어려움 |
| ModelMapper (기본) | 15ms | 140ms | 자동화, 유지보수 쉬움 | 약간 느림, 복잡한 매핑은 설정 필요 |
| ModelMapper (최적화) | 8ms | 75ms | 균형 잡힌 성능 | 초기 설정 필요 |
| MapStruct | 5ms | 48ms | 컴파일 타임 생성, 빠름 | 초기 설정 복잡, 유연성 낮음 |

## ModelMapper vs MapStruct

### ModelMapper (Reflection 기반)

**장점:**
- ✅ 설정이 간단함
- ✅ 런타임에 유연한 매핑 가능
- ✅ 동적 변환 가능

**단점:**
- ⚠️ 런타임 성능 오버헤드 (Reflection)
- ⚠️ 컴파일 타임 타입 안정성 없음
- ⚠️ 디버깅이 어려움

### MapStruct (Code Generation 기반)

**장점:**
- ✅ 컴파일 타임에 코드 생성 (빠름)
- ✅ 타입 안정성 보장
- ✅ 디버깅 쉬움 (생성된 코드 확인 가능)

**단점:**
- ⚠️ 초기 설정 복잡
- ⚠️ 런타임 유연성 낮음
- ⚠️ 매핑 설정이 장황함

### 실무 선택 가이드

```
프로젝트 특성 평가
    ↓
    ├─ 성능이 매우 critical? (초당 10만+ 요청)
    │   └─ MapStruct 권장
    │
    ├─ 빠른 개발 속도 필요? (스타트업, MVP)
    │   └─ ModelMapper 권장
    │
    ├─ 복잡한 동적 매핑 필요?
    │   └─ ModelMapper 권장
    │
    ├─ 대규모 팀, 엄격한 타입 안정성 필요?
    │   └─ MapStruct 권장
    │
    └─ 일반적인 웹 애플리케이션?
        └─ ModelMapper로 시작, 필요시 MapStruct로 마이그레이션
```

## 테스트 전략

### 1. 매핑 검증 테스트

```java
@SpringBootTest
class UserMapperTest {

    @Autowired
    private ModelMapper modelMapper;

    @Test
    @DisplayName("User → UserResponse 매핑 검증")
    void testUserToUserResponse() {
        // Given
        User user = User.builder()
            .id(1L)
            .email("test@example.com")
            .username("testuser")
            .birthDate(LocalDate.of(1990, 1, 1))
            .createdAt(LocalDateTime.now())
            .build();

        // When
        UserResponse response = modelMapper.map(user, UserResponse.class);

        // Then
        assertNotNull(response);
        assertEquals(user.getId(), response.getId());
        assertEquals(user.getEmail(), response.getEmail());
        assertEquals(user.getUsername(), response.getNickname());
        assertEquals(34, response.getAge()); // 계산된 값 검증
        assertNotNull(response.getCreatedAt());
    }

    @Test
    @DisplayName("null 필드는 매핑하지 않음")
    void testSkipNullMapping() {
        // Given
        User source = User.builder()
            .id(1L)
            .email("test@example.com")
            .build();

        UserResponse destination = new UserResponse();
        destination.setNickname("existing-nickname");

        // When
        modelMapper.map(source, destination);

        // Then
        assertEquals(1L, destination.getId());
        assertEquals("test@example.com", destination.getEmail());
        assertEquals("existing-nickname", destination.getNickname()); // 유지됨
    }

    @Test
    @DisplayName("중첩 객체 매핑 검증")
    void testNestedObjectMapping() {
        // Given
        Address address = new Address("Seoul", "Gangnam-gu", "123-45");
        User user = User.builder()
            .id(1L)
            .address(address)
            .build();

        // When
        UserDetailResponse response = modelMapper.map(user, UserDetailResponse.class);

        // Then
        assertEquals("Seoul", response.getCity());
        assertEquals("Gangnam-gu", response.getDistrict());
        assertEquals("123-45", response.getZipCode());
    }
}
```

### 2. 성능 테스트

```java
@SpringBootTest
class ModelMapperPerformanceTest {

    @Autowired
    private ModelMapper modelMapper;

    @Test
    @DisplayName("대량 데이터 변환 성능 테스트")
    void testBulkConversionPerformance() {
        // Given
        List<User> users = IntStream.range(0, 1000)
            .mapToObj(i -> createUser(i))
            .collect(Collectors.toList());

        // When
        long start = System.currentTimeMillis();

        List<UserResponse> responses = users.stream()
            .map(user -> modelMapper.map(user, UserResponse.class))
            .collect(Collectors.toList());

        long duration = System.currentTimeMillis() - start;

        // Then
        assertEquals(1000, responses.size());
        assertTrue(duration < 200, "변환 시간이 200ms를 초과했습니다: " + duration + "ms");

        System.out.println("1000건 변환 시간: " + duration + "ms");
        System.out.println("평균 변환 시간: " + (duration / 1000.0) + "ms");
    }

    private User createUser(int index) {
        return User.builder()
            .id((long) index)
            .email("user" + index + "@example.com")
            .username("user" + index)
            .build();
    }
}
```

## 실전 팁

### 1. Entity → DTO는 Service에서, DTO → Entity는 주의

```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;
    private final ModelMapper modelMapper;

    // ✅ 좋은 예: Entity → DTO 변환
    @Transactional(readOnly = true)
    public UserResponse getUser(Long id) {
        User user = userRepository.findById(id).orElseThrow();
        return modelMapper.map(user, UserResponse.class);
    }

    // ⚠️ 주의: DTO → Entity 직접 변환은 위험
    @Transactional
    public User createUserBad(UserCreateRequest request) {
        // 위험: ID, createdAt 등 자동 생성 필드도 매핑될 수 있음
        User user = modelMapper.map(request, User.class);
        return userRepository.save(user);
    }

    // ✅ 안전: 명시적 빌더 사용
    @Transactional
    public User createUserGood(UserCreateRequest request) {
        User user = User.builder()
            .email(request.getEmail())
            .username(request.getUsername())
            .build();

        user.initialize(); // 비즈니스 로직
        return userRepository.save(user);
    }

    // ✅ 안전: 부분 업데이트만 ModelMapper 사용
    @Transactional
    public User updateUser(Long id, UserUpdateRequest request) {
        User user = userRepository.findById(id).orElseThrow();

        // null 필드는 건너뛰고 업데이트
        modelMapper.map(request, user);

        return user;
    }
}
```

### 2. DTO 검증은 Controller에서

```java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @PostMapping
    public ResponseEntity<UserResponse> createUser(
            @Valid @RequestBody UserCreateRequest request) { // ← @Valid 검증

        User user = userService.createUser(request);
        UserResponse response = UserResponse.from(user);

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
}

public class UserCreateRequest {
    @NotBlank(message = "이메일은 필수입니다")
    @Email(message = "유효한 이메일 형식이 아닙니다")
    private String email;

    @NotBlank(message = "사용자명은 필수입니다")
    @Size(min = 3, max = 20, message = "사용자명은 3~20자여야 합니다")
    private String username;

    @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z\\d]{8,}$",
             message = "비밀번호는 최소 8자, 문자와 숫자를 포함해야 합니다")
    private String password;
}
```

### 3. Profile별 DTO 분리

```java
// 목록 조회용 DTO (최소 필드)
public class UserListResponse {
    private Long id;
    private String nickname;
    private String profileImageUrl;
}

// 상세 조회용 DTO (전체 필드)
public class UserDetailResponse {
    private Long id;
    private String email;
    private String nickname;
    private String profileImageUrl;
    private LocalDate birthDate;
    private Integer age;
    private Address address;
    private List<OrderSummary> recentOrders;
    private MembershipInfo membership;
}

// 수정용 DTO (변경 가능 필드만)
public class UserUpdateRequest {
    private String nickname;
    private String profileImageUrl;
    private Address address;
    // ID, email, createdAt 등은 제외
}
```

## 결론

### 핵심 정리

1. **Entity 직접 노출 금지**: 보안, 성능, 유지보수 문제
2. **ModelMapper 활용**: 반복적인 매핑 코드 자동화
3. **명시적 설정**: 복잡한 매핑은 PropertyMap으로 명확히 정의
4. **성능 최적화**: Fetch Join + Batch 변환으로 N+1 문제 방지
5. **DTO 목적별 분리**: List, Detail, Create, Update용 DTO 각각 정의

### 추천 사용 패턴

```java
// 1. ModelMapper Bean 설정
@Configuration
public class ModelMapperConfig {
    @Bean
    public ModelMapper modelMapper() {
        // 기본 설정 + 커스텀 매핑
    }
}

// 2. Mapper 인터페이스 정의
@Component
public class UserMapper implements DtoMapper<User, UserResponse> {
    // 재사용 가능한 변환 메서드
}

// 3. Service에서 활용
@Service
public class UserService {
    public UserResponse getUser(Long id) {
        User user = repository.findById(id).orElseThrow();
        return userMapper.toDto(user);
    }
}

// 4. 테스트 작성
@Test
void testMapping() {
    // 매핑 정확성 검증
}
```

ModelMapper는 올바르게 사용하면 생산성과 유지보수성을 크게 향상시킬 수 있습니다. 기본 설정을 이해하고, 프로젝트 특성에 맞게 커스터마이징하세요.
