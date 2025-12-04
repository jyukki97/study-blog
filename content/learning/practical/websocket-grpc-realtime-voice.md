---
title: "WebSocket + gRPC 실시간 음성처리 서비스"
date: 2025-11-03
draft: true
topic: "Architecture"
topic_icon: "🏗️"
topic_description: "시스템 아키텍처 및 설계 패턴"
tags: ["WebSocket", "gRPC", "STT", "Real-time", "Architecture"]
categories: ["Development", "Learning"]
description: "STT 스트리밍 구조, backpressure 제어, 실시간 latency 관리"
---

> **학습 목표**: WebSocket과 gRPC를 활용한 실시간 음성 처리 아키텍처를 이해하고, Backpressure와 지연시간 관리 전략을 학습한다.

## 🎤 프로젝트 배경

### 요구사항

음성 인식(STT) 서비스를 웹에서 실시간으로 제공:
- ✅ 사용자 음성을 실시간으로 서버에 전송
- ✅ STT 엔진에서 음성을 텍스트로 변환
- ✅ 중간 결과(partial)와 최종 결과(final) 실시간 반환
- ✅ 지연시간 < 200ms (체감 지연 최소화)
- ✅ 동시 사용자 1,000명 이상 처리

### 기술 선택

| 구간 | 프로토콜 | 이유 |
|------|---------|------|
| **Browser ↔ Gateway** | WebSocket | 브라우저 지원, 양방향 통신 |
| **Gateway ↔ STT Engine** | gRPC Streaming | 효율적인 바이너리 프로토콜, 스트리밍 지원 |

---

## 🏗️ 전체 아키텍처

```
┌──────────────┐
│   Browser    │
│  (Web App)   │
└──────┬───────┘
       │ WebSocket
       │ Audio Chunks (16kHz PCM)
       ▼
┌──────────────────────────────┐
│   Gateway Server (Node.js)   │
│  - WebSocket Handler          │
│  - gRPC Client                │
│  - Backpressure Control       │
└──────┬───────────────────────┘
       │ gRPC Streaming
       │ StreamingRecognize
       ▼
┌──────────────────────────────┐
│    STT Engine (Python)        │
│  - gRPC Server                │
│  - Wav2Vec 2.0 / Whisper      │
│  - GPU Processing             │
└──────┬───────────────────────┘
       │
       │ STT Results
       ▼
┌──────────────┐
│   Database   │
│   (MongoDB)  │
└──────────────┘
```

---

## 🔌 WebSocket 구현

### Browser → Gateway

**클라이언트 (JavaScript)**:

```javascript
class RealtimeSTTClient {
    constructor(wsUrl) {
        this.ws = new WebSocket(wsUrl);
        this.audioContext = new AudioContext({ sampleRate: 16000 });
        this.mediaStream = null;
        this.processor = null;
    }

    async startRecording() {
        // 마이크 권한 요청
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);

        // AudioWorklet 사용 (Web Workers에서 실행)
        await this.audioContext.audioWorklet.addModule('/audio-processor.js');
        this.processor = new AudioWorkletNode(this.audioContext, 'audio-processor');

        // 오디오 청크 수신
        this.processor.port.onmessage = (event) => {
            const audioData = event.data;  // Float32Array
            this.sendAudioChunk(audioData);
        };

        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    sendAudioChunk(float32Array) {
        // Float32 → Int16 변환 (gRPC 전송용)
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(int16Array.buffer);
        }
    }

    onPartialResult(callback) {
        this.ws.onmessage = (event) => {
            const result = JSON.parse(event.data);
            if (result.is_final) {
                callback(result.text, true);
            } else {
                callback(result.text, false);  // partial result
            }
        };
    }

    stopRecording() {
        if (this.processor) {
            this.processor.disconnect();
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        this.ws.close();
    }
}

// 사용 예시
const sttClient = new RealtimeSTTClient('wss://api.example.com/stt');
await sttClient.startRecording();

sttClient.onPartialResult((text, isFinal) => {
    if (isFinal) {
        console.log('Final:', text);
        document.getElementById('final-result').textContent += text + ' ';
    } else {
        console.log('Partial:', text);
        document.getElementById('partial-result').textContent = text;
    }
});
```

### Gateway Server (Node.js + WebSocket)

```javascript
import WebSocket, { WebSocketServer } from 'ws';
import { createSTTClient } from './grpc-client.js';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', async (ws, req) => {
    const sessionId = generateSessionId();
    console.log(`New connection: ${sessionId}`);

    // gRPC 스트림 생성
    const grpcStream = createSTTClient();

    // gRPC → WebSocket 파이프
    grpcStream.on('data', (response) => {
        const result = {
            text: response.transcript,
            is_final: response.is_final,
            confidence: response.confidence,
        };
        ws.send(JSON.stringify(result));
    });

    grpcStream.on('error', (error) => {
        console.error('gRPC error:', error);
        ws.close(1011, 'STT engine error');
    });

    // WebSocket → gRPC 파이프
    ws.on('message', (audioData) => {
        // Backpressure 체크
        if (!grpcStream.write({
            audio_content: audioData,
            session_id: sessionId,
        })) {
            // 버퍼가 가득 참 → 클라이언트에게 속도 조절 요청
            ws.send(JSON.stringify({ type: 'slow_down' }));
        }
    });

    ws.on('close', () => {
        console.log(`Connection closed: ${sessionId}`);
        grpcStream.end();
    });
});
```

---

## 🚀 gRPC Streaming 구현

### Proto 정의

```protobuf
syntax = "proto3";

package stt;

service SpeechToText {
  rpc StreamingRecognize(stream StreamingRecognizeRequest)
      returns (stream StreamingRecognizeResponse);
}

message StreamingRecognizeRequest {
  bytes audio_content = 1;
  string session_id = 2;
  AudioConfig audio_config = 3;
}

message AudioConfig {
  int32 sample_rate = 1;  // 16000
  int32 channels = 2;      // 1 (mono)
  string encoding = 3;     // "PCM_INT16"
}

message StreamingRecognizeResponse {
  string transcript = 1;
  bool is_final = 2;
  float confidence = 3;
  int64 audio_duration_ms = 4;
}
```

### gRPC Client (Node.js)

```javascript
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const packageDefinition = protoLoader.loadSync('stt.proto');
const sttProto = grpc.loadPackageDefinition(packageDefinition).stt;

export function createSTTClient() {
    const client = new sttProto.SpeechToText(
        'localhost:50051',
        grpc.credentials.createInsecure()
    );

    const stream = client.StreamingRecognize();

    // 첫 번째 메시지에 config 포함
    stream.write({
        session_id: generateSessionId(),
        audio_config: {
            sample_rate: 16000,
            channels: 1,
            encoding: 'PCM_INT16',
        },
    });

    return stream;
}
```

### gRPC Server (Python + Wav2Vec)

```python
import grpc
from concurrent import futures
import stt_pb2
import stt_pb2_grpc
from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
import torch
import numpy as np

class STTService(stt_pb2_grpc.SpeechToTextServicer):
    def __init__(self):
        self.processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
        self.model = Wav2Vec2ForCTC.from_pretrained("facebook/wav2vec2-base-960h")
        self.model.eval()
        if torch.cuda.is_available():
            self.model = self.model.cuda()

    def StreamingRecognize(self, request_iterator, context):
        audio_buffer = bytearray()
        chunk_duration_ms = 200  # 200ms 단위로 처리

        for request in request_iterator:
            audio_buffer.extend(request.audio_content)

            # 충분한 데이터가 모이면 처리
            required_bytes = int(16000 * 2 * chunk_duration_ms / 1000)
            if len(audio_buffer) >= required_bytes:
                chunk = audio_buffer[:required_bytes]
                audio_buffer = audio_buffer[required_bytes:]

                # Int16 → Float32 변환
                audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

                # STT 추론
                inputs = self.processor(audio_np, sampling_rate=16000, return_tensors="pt")
                with torch.no_grad():
                    logits = self.model(inputs.input_values.cuda()).logits

                predicted_ids = torch.argmax(logits, dim=-1)
                transcription = self.processor.batch_decode(predicted_ids)[0]

                # Partial result 전송
                yield stt_pb2.StreamingRecognizeResponse(
                    transcript=transcription,
                    is_final=False,
                    confidence=0.8,
                )

        # 남은 데이터 처리 (Final result)
        if len(audio_buffer) > 0:
            audio_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
            inputs = self.processor(audio_np, sampling_rate=16000, return_tensors="pt")
            with torch.no_grad():
                logits = self.model(inputs.input_values.cuda()).logits
            predicted_ids = torch.argmax(logits, dim=-1)
            transcription = self.processor.batch_decode(predicted_ids)[0]

            yield stt_pb2.StreamingRecognizeResponse(
                transcript=transcription,
                is_final=True,
                confidence=0.95,
            )

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    stt_pb2_grpc.add_SpeechToTextServicer_to_server(STTService(), server)
    server.add_insecure_port('[::]:50051')
    server.start()
    print("gRPC server started on port 50051")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()
```

---

## ⚖️ Backpressure 제어

### 문제 상황

**Browser → Gateway는 빠르지만, Gateway → STT Engine이 느린 경우**:
- GPU 처리 속도 < 오디오 유입 속도
- 메모리 버퍼 폭발 → OOM

### 해결 방법

#### 1. Flow Control (gRPC)

```javascript
// Gateway에서 gRPC write 결과 확인
let canSend = true;

ws.on('message', (audioData) => {
    if (!canSend) {
        // 버퍼가 가득 참 → 드롭하거나 큐잉
        console.warn('Backpressure detected, dropping frame');
        return;
    }

    canSend = grpcStream.write({
        audio_content: audioData,
    });

    if (!canSend) {
        // drain 이벤트 대기
        grpcStream.once('drain', () => {
            canSend = true;
        });
    }
});
```

#### 2. Adaptive Sampling

```javascript
// 클라이언트에서 전송 속도 조절
class AdaptiveSTTClient {
    constructor() {
        this.sendInterval = 100;  // 초기 100ms
        this.lastSlowDownTime = 0;
    }

    onSlowDown() {
        // 서버에서 slow_down 메시지 수신 시
        this.sendInterval = Math.min(this.sendInterval * 1.5, 500);
        console.log(`Slowing down to ${this.sendInterval}ms interval`);
    }

    onNormal() {
        // 정상 상태로 복구
        this.sendInterval = Math.max(this.sendInterval * 0.9, 100);
    }
}
```

#### 3. Buffer Limiting

```javascript
const MAX_BUFFER_SIZE = 1024 * 1024;  // 1MB

let bufferSize = 0;

ws.on('message', (audioData) => {
    bufferSize += audioData.length;

    if (bufferSize > MAX_BUFFER_SIZE) {
        console.error('Buffer overflow! Closing connection.');
        ws.close(1008, 'Buffer overflow');
        return;
    }

    grpcStream.write({
        audio_content: audioData,
    }, () => {
        bufferSize -= audioData.length;  // 전송 완료 시 감소
    });
});
```

---

## ⏱️ Latency 최적화

### 측정 지표

| 구간 | 목표 | 측정 방법 |
|------|------|----------|
| **Browser → Gateway** | < 20ms | WebSocket RTT |
| **Gateway → STT Engine** | < 50ms | gRPC 왕복 시간 |
| **STT Inference** | < 100ms | GPU 처리 시간 |
| **Total E2E** | < 200ms | 사용자 음성 → 결과 표시 |

### 최적화 전략

#### 1. Chunk Size 조정

```python
# 작은 청크 = 낮은 지연, 낮은 정확도
CHUNK_DURATION_MS = 200  # 200ms

# 큰 청크 = 높은 지연, 높은 정확도
CHUNK_DURATION_MS = 1000  # 1초

# 최적값 찾기 (실험적 튜닝)
CHUNK_DURATION_MS = 300  # 300ms (절충안)
```

#### 2. GPU Batching

```python
class BatchedSTTEngine:
    def __init__(self, batch_size=4, max_wait_ms=50):
        self.batch_size = batch_size
        self.max_wait_ms = max_wait_ms
        self.queue = []

    async def process_stream(self, audio_chunk):
        self.queue.append(audio_chunk)

        # 배치 크기 도달 or 타임아웃
        if len(self.queue) >= self.batch_size or self.is_timeout():
            batch = self.queue[:self.batch_size]
            self.queue = self.queue[self.batch_size:]

            # 배치 처리 (GPU 효율 증가)
            results = self.model.batch_infer(batch)
            return results
```

#### 3. Warm-up & Keep-alive

```python
# 모델 warm-up (첫 요청 지연 제거)
def warm_up_model():
    dummy_audio = np.zeros(16000, dtype=np.float32)  # 1초 무음
    inputs = processor(dummy_audio, sampling_rate=16000, return_tensors="pt")
    with torch.no_grad():
        model(inputs.input_values.cuda())
    print("Model warmed up!")

warm_up_model()

# gRPC Keep-alive
server = grpc.server(
    futures.ThreadPoolExecutor(max_workers=10),
    options=[
        ('grpc.keepalive_time_ms', 10000),
        ('grpc.keepalive_timeout_ms', 5000),
    ]
)
```

---

## 📊 모니터링

### Prometheus Metrics

```javascript
import { Counter, Histogram } from 'prom-client';

const audioChunksReceived = new Counter({
    name: 'stt_audio_chunks_received_total',
    help: 'Total audio chunks received from clients',
});

const sttLatency = new Histogram({
    name: 'stt_latency_seconds',
    help: 'STT processing latency',
    buckets: [0.05, 0.1, 0.2, 0.5, 1.0],
});

ws.on('message', (audioData) => {
    audioChunksReceived.inc();

    const startTime = Date.now();
    grpcStream.write({ audio_content: audioData }, () => {
        sttLatency.observe((Date.now() - startTime) / 1000);
    });
});
```

### Grafana Dashboard

- **WebSocket Connections**: 동시 연결 수
- **Audio Throughput**: 초당 처리된 오디오 데이터 (MB/s)
- **STT Latency**: P50, P95, P99 지연시간
- **Error Rate**: WebSocket/gRPC 에러율

---

## 💡 배운 교훈

### 1. Partial Results의 중요성

초기에는 최종 결과만 전송했지만, 사용자 경험이 나빴습니다.
- ✅ Partial results로 즉각적인 피드백 제공
- ✅ 사용자가 중간 결과를 보고 발화 조정 가능

### 2. Backpressure를 무시하면 안 된다

초기 버전에서 backpressure를 처리하지 않아 메모리 누수 발생.
- ✅ gRPC `write()` 반환값 확인 필수
- ✅ Buffer 크기 제한 필요

### 3. GPU Batching의 효과

개별 요청 처리 대비 **5배 처리량 증가**.
- Throughput: 10 req/s → 50 req/s
- Latency 증가: 50ms (허용 범위)

---

## 📋 학습 체크리스트

- [ ] WebSocket 양방향 통신 이해
- [ ] gRPC Streaming 구현 가능
- [ ] Backpressure 제어 방법 3가지 이상
- [ ] Latency 최적화 전략 적용 가능
- [ ] Prometheus로 실시간 모니터링 구성

---

## 🔗 참고 자료

- [gRPC Streaming Guide](https://grpc.io/docs/languages/node/basics/#server-side-streaming-rpc)
- [WebSocket API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Wav2Vec 2.0 Paper](https://arxiv.org/abs/2006.11477)

---

> **다음 학습**: Vue.js → React 전환 경험 및 상태관리 패턴
