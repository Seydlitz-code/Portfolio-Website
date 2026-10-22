/**
 * 큰 파일 업로드를 메모리에 모으지 않고 R2로 바로 흘려보낸다.
 * Workers isolate 메모리는 128MB라, 55MB 동영상을 multipart로 받아 통째로 버퍼링하면 위험하다.
 * 요청 본문의 앞부분만 읽어 실제 형식을 확인하고, 나머지는 읽는 대로 R2에 쓴다.
 */
import { detectVerifiedMime } from './fileSniff';

/** 형식 판별에 필요한 앞부분 길이 (fileSniff.ts가 최대 12바이트를 본다) */
const SNIFF_BYTES = 16;

type StreamUploadResult = { ok: true; mime: string } | { ok: false; reason: 'type' | 'body' };

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * body를 R2 key에 저장한다. length는 Content-Length 값이며, 실제 길이가 다르면 저장이 실패한다.
 * 파일 내용이 allowedMimes 형식이 아니면 저장하지 않고 { ok: false, reason: 'type' }.
 */
export async function streamUploadToR2(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  length: number,
  allowedMimes: readonly string[]
): Promise<StreamUploadResult> {
  const reader = body.getReader();
  const headChunks: Uint8Array[] = [];
  let headLength = 0;
  while (headLength < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    headChunks.push(value);
    headLength += value.byteLength;
  }
  const head = joinChunks(headChunks);
  const mime = detectVerifiedMime(head.subarray(0, SNIFF_BYTES), allowedMimes);
  if (!mime) {
    await reader.cancel();
    return { ok: false, reason: 'type' };
  }

  // FixedLengthStream: R2에 길이를 미리 알려 줘야 스트림을 그대로 저장할 수 있다.
  const fixed = new FixedLengthStream(length);
  const writer = fixed.writable.getWriter();
  const pump = (async () => {
    try {
      await writer.write(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (err) {
      // 본문 읽기·쓰기가 실패하면(클라이언트가 끊는 등) R2 쪽 스트림도 오류로 끝내 put이 계속 기다리지 않게 한다.
      await writer.abort(err).catch(() => undefined);
      await reader.cancel(err).catch(() => undefined);
      throw err;
    }
  })();
  const put = bucket.put(key, fixed.readable, { httpMetadata: { contentType: mime } });

  // 두 작업이 모두 끝난 뒤에 판단해야, 실패했을 때 진행 중인 put과 delete가 엇갈리지 않는다.
  const [putResult, pumpResult] = await Promise.allSettled([put, pump]);
  if (putResult.status === 'fulfilled' && pumpResult.status === 'fulfilled') return { ok: true, mime };

  console.error('[upload] R2 저장 실패', putResult.status === 'rejected' ? putResult.reason : pumpResult);
  await reader.cancel().catch(() => undefined);
  await bucket.delete(key).catch(() => undefined);
  return { ok: false, reason: 'body' };
}
